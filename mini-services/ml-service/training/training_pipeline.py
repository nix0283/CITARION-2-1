"""
Training Pipeline - Production-ready model training pipeline.
Orchestrates data fetching, feature engineering, model training, and evaluation.
"""

import asyncio
import os
import json
import logging
from datetime import datetime
from typing import List, Optional, Dict, Any, Tuple
from dataclasses import dataclass, field
import numpy as np
import pandas as pd
from pathlib import Path

# Import local modules
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from training.data_fetcher import DataFetcher, fetch_multiple_symbols
from training.feature_engineer import FeatureEngineer, FeatureEngineerExtended, FeatureConfig
from models.price_predictor import PricePredictorModel
from models.signal_classifier import SignalClassifierModel
from models.regime_detector import RegimeDetectorModel

logger = logging.getLogger(__name__)


@dataclass
class TrainingConfig:
    """Training pipeline configuration"""
    # Data settings
    symbols: List[str] = field(default_factory=lambda: ["BTCUSDT", "ETHUSDT"])
    exchange: str = "binance"
    timeframe: str = "1h"
    days: int = 365
    
    # Feature settings
    sequence_length: int = 60
    prediction_horizons: List[int] = field(default_factory=lambda: [1, 5, 15, 60])
    
    # Training settings
    epochs: int = 100
    batch_size: int = 32
    validation_split: float = 0.2
    early_stopping_patience: int = 10
    
    # Model settings
    hidden_units: int = 128
    num_layers: int = 2
    dropout: float = 0.2
    
    # Output settings
    output_dir: str = "models"
    model_name: str = "production"
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbols": self.symbols,
            "exchange": self.exchange,
            "timeframe": self.timeframe,
            "days": self.days,
            "sequence_length": self.sequence_length,
            "prediction_horizons": self.prediction_horizons,
            "epochs": self.epochs,
            "batch_size": self.batch_size,
            "validation_split": self.validation_split,
            "early_stopping_patience": self.early_stopping_patience,
            "hidden_units": self.hidden_units,
            "num_layers": self.num_layers,
            "dropout": self.dropout,
            "output_dir": self.output_dir,
            "model_name": self.model_name,
        }


class TrainingPipeline:
    """
    Production-ready training pipeline for ML models.
    
    Features:
    - Multi-symbol data fetching
    - Comprehensive feature engineering
    - Model training with validation
    - Model persistence
    - Training metrics tracking
    """
    
    def __init__(self, config: Optional[TrainingConfig] = None):
        self.config = config or TrainingConfig()
        self.feature_config = FeatureConfig(
            sequence_length=self.config.sequence_length,
            prediction_horizons=self.config.prediction_horizons
        )
        self.feature_engineer = FeatureEngineerExtended(self.feature_config)
        
        # Create output directory
        self.output_path = Path(self.config.output_dir)
        self.output_path.mkdir(parents=True, exist_ok=True)
        
        # Training state
        self.training_history: Dict[str, Any] = {}
        self.models: Dict[str, Any] = {}
        self.feature_columns: List[str] = []
    
    async def fetch_data(self) -> Dict[str, pd.DataFrame]:
        """Fetch OHLCV data for all configured symbols"""
        logger.info(f"Fetching data for {len(self.config.symbols)} symbols...")
        
        data = await fetch_multiple_symbols(
            symbols=self.config.symbols,
            exchange=self.config.exchange,
            timeframe=self.config.timeframe,
            days=self.config.days
        )
        
        # Log results
        for symbol, df in data.items():
            logger.info(f"  {symbol}: {len(df)} candles")
        
        return data
    
    def prepare_training_data(
        self, 
        data: Dict[str, pd.DataFrame]
    ) -> Tuple[np.ndarray, np.ndarray, List[str]]:
        """
        Prepare training data from fetched OHLCV data.
        
        Returns:
            Tuple of (X, y, feature_columns)
        """
        all_X = []
        all_y = []
        feature_columns = None
        
        for symbol, df in data.items():
            logger.info(f"Processing {symbol}...")
            
            # Create features
            features_df = self.feature_engineer.create_features(df)
            
            # Create targets
            features_df = self.feature_engineer.create_targets(features_df)
            
            # Drop rows with NaN targets
            features_df = features_df.dropna()
            
            # Get feature columns
            if feature_columns is None:
                feature_columns = [
                    col for col in features_df.columns 
                    if col not in ['open', 'high', 'low', 'close', 'volume'] 
                    and not col.startswith('target')
                    and not col.startswith('direction')
                    and not col.startswith('future')
                    and not col.startswith('mfe')
                    and not col.startswith('mae')
                ]
            
            # Prepare sequences
            X, y = self.feature_engineer.prepare_sequences(
                features_df,
                feature_columns=feature_columns,
                target_column='target_1m',
                sequence_length=self.config.sequence_length
            )
            
            all_X.append(X)
            all_y.append(y)
            
            logger.info(f"  Sequences: {X.shape}")
        
        # Combine all symbols
        X = np.concatenate(all_X, axis=0)
        y = np.concatenate(all_y, axis=0)
        
        logger.info(f"Total training samples: {X.shape[0]}")
        logger.info(f"Features: {X.shape[2]}")
        
        return X, y, feature_columns
    
    def train_price_predictor(
        self, 
        X: np.ndarray, 
        y: np.ndarray
    ) -> PricePredictorModel:
        """Train price prediction model"""
        logger.info("Training Price Predictor...")
        
        model = PricePredictorModel(
            sequence_length=self.config.sequence_length,
            features=X.shape[2],
            hidden_units=self.config.hidden_units,
            num_layers=self.config.num_layers,
            dropout=self.config.dropout,
            prediction_horizons=self.config.prediction_horizons
        )
        
        history = model.train(
            X, y,
            validation_split=self.config.validation_split,
            epochs=self.config.epochs,
            batch_size=self.config.batch_size,
            early_stopping_patience=self.config.early_stopping_patience
        )
        
        self.training_history["price_predictor"] = history
        self.models["price_predictor"] = model
        
        return model
    
    def train_signal_classifier(
        self, 
        X: np.ndarray, 
        y: np.ndarray
    ) -> SignalClassifierModel:
        """Train signal classification model"""
        logger.info("Training Signal Classifier...")
        
        # Convert regression target to classification
        y_class = np.zeros(len(y))
        y_class[y > 0.001] = 1  # BUY
        y_class[y < -0.001] = 2  # SELL
        # 0 = HOLD
        
        # Use last timestep features for classification
        X_flat = X[:, -1, :]  # (samples, features)
        
        model = SignalClassifierModel()
        history = model.train(X_flat, y_class)
        
        self.training_history["signal_classifier"] = history
        self.models["signal_classifier"] = model
        
        return model
    
    def train_regime_detector(
        self, 
        data: Dict[str, pd.DataFrame]
    ) -> RegimeDetectorModel:
        """Train regime detection model"""
        logger.info("Training Regime Detector...")
        
        # Combine all data
        all_features = []
        
        for symbol, df in data.items():
            features_df = self.feature_engineer.create_features(df)
            
            # Select relevant features for regime detection
            regime_features = features_df[[
                'returns', 'volatility_20', 'volume_change',
                'momentum_10', 'adx', 'trend_strength'
            ]].dropna()
            
            all_features.append(regime_features.values)
        
        X = np.concatenate(all_features, axis=0)
        
        model = RegimeDetectorModel()
        history = model.train(X)
        
        self.training_history["regime_detector"] = history
        self.models["regime_detector"] = model
        
        return model
    
    def save_models(self, name: Optional[str] = None) -> Dict[str, str]:
        """Save all trained models"""
        name = name or self.config.model_name
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        saved_paths = {}
        
        for model_name, model in self.models.items():
            model_dir = self.output_path / f"{name}_{model_name}_{timestamp}"
            model_dir.mkdir(parents=True, exist_ok=True)
            
            # Save model
            if hasattr(model, 'save'):
                model.save(str(model_dir))
            
            saved_paths[model_name] = str(model_dir)
            logger.info(f"Saved {model_name} to {model_dir}")
        
        # Save training config
        config_path = self.output_path / f"{name}_config_{timestamp}.json"
        with open(config_path, 'w') as f:
            json.dump(self.config.to_dict(), f, indent=2)
        
        # Save feature columns
        if hasattr(self, 'feature_columns'):
            features_path = self.output_path / f"{name}_features_{timestamp}.json"
            with open(features_path, 'w') as f:
                json.dump(self.feature_columns, f, indent=2)
        
        return saved_paths
    
    def load_models(self, path: str) -> bool:
        """Load trained models from disk"""
        try:
            model_path = Path(path)
            
            # Load price predictor
            if (model_path / "price_predictor").exists():
                self.models["price_predictor"] = PricePredictorModel()
                self.models["price_predictor"].load(str(model_path / "price_predictor"))
            
            # Load signal classifier
            if (model_path / "signal_classifier").exists():
                self.models["signal_classifier"] = SignalClassifierModel()
                self.models["signal_classifier"].load(str(model_path / "signal_classifier"))
            
            # Load regime detector
            if (model_path / "regime_detector").exists():
                self.models["regime_detector"] = RegimeDetectorModel()
                self.models["regime_detector"].load(str(model_path / "regime_detector"))
            
            logger.info(f"Loaded models from {path}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to load models: {e}")
            return False
    
    async def run_full_training(self) -> Dict[str, Any]:
        """
        Run complete training pipeline.
        
        Returns:
            Training results and metrics
        """
        logger.info("Starting full training pipeline...")
        start_time = datetime.now()
        
        try:
            # 1. Fetch data
            data = await self.fetch_data()
            
            # 2. Prepare training data
            X, y, self.feature_columns = self.prepare_training_data(data)
            
            # 3. Train models
            self.train_price_predictor(X, y)
            self.train_signal_classifier(X, y)
            self.train_regime_detector(data)
            
            # 4. Save models
            saved_paths = self.save_models()
            
            # Calculate training duration
            duration = (datetime.now() - start_time).total_seconds()
            
            results = {
                "status": "success",
                "duration_seconds": duration,
                "samples": X.shape[0],
                "features": X.shape[2],
                "symbols": list(data.keys()),
                "training_history": self.training_history,
                "saved_paths": saved_paths,
            }
            
            logger.info(f"Training completed in {duration:.2f}s")
            
            return results
            
        except Exception as e:
            logger.error(f"Training failed: {e}")
            return {
                "status": "error",
                "error": str(e),
                "duration_seconds": (datetime.now() - start_time).total_seconds()
            }
    
    def get_model_metrics(self) -> Dict[str, Dict[str, Any]]:
        """Get metrics for all trained models"""
        metrics = {}
        
        for name, model in self.models.items():
            if hasattr(model, 'get_metrics'):
                metrics[name] = model.get_metrics()
        
        return metrics


async def train_models(
    symbols: List[str] = None,
    exchange: str = "binance",
    timeframe: str = "1h",
    days: int = 365,
    epochs: int = 100,
    output_dir: str = "models"
) -> Dict[str, Any]:
    """
    Convenience function to train models with default settings.
    
    Usage:
        results = await train_models(
            symbols=["BTCUSDT", "ETHUSDT"],
            days=180,
            epochs=50
        )
    """
    config = TrainingConfig(
        symbols=symbols or ["BTCUSDT", "ETHUSDT"],
        exchange=exchange,
        timeframe=timeframe,
        days=days,
        epochs=epochs,
        output_dir=output_dir
    )
    
    pipeline = TrainingPipeline(config)
    return await pipeline.run_full_training()


def train_models_sync(**kwargs) -> Dict[str, Any]:
    """Synchronous wrapper for training"""
    return asyncio.run(train_models(**kwargs))


# CLI entry point
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Train ML models for CITARION")
    parser.add_argument("--symbols", nargs="+", default=["BTCUSDT", "ETHUSDT"],
                        help="Trading symbols to train on")
    parser.add_argument("--exchange", default="binance", help="Exchange to fetch data from")
    parser.add_argument("--timeframe", default="1h", help="Candle timeframe")
    parser.add_argument("--days", type=int, default=365, help="Days of historical data")
    parser.add_argument("--epochs", type=int, default=100, help="Training epochs")
    parser.add_argument("--output", default="models", help="Output directory")
    
    args = parser.parse_args()
    
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Run training
    results = train_models_sync(
        symbols=args.symbols,
        exchange=args.exchange,
        timeframe=args.timeframe,
        days=args.days,
        epochs=args.epochs,
        output_dir=args.output
    )
    
    print("\n" + "="*50)
    print("Training Results:")
    print(f"  Status: {results.get('status')}")
    print(f"  Duration: {results.get('duration_seconds', 0):.2f}s")
    print(f"  Samples: {results.get('samples', 0)}")
    print(f"  Features: {results.get('features', 0)}")
    print(f"  Symbols: {results.get('symbols', [])}")
    
    if results.get('saved_paths'):
        print("\nSaved Models:")
        for model, path in results['saved_paths'].items():
            print(f"  {model}: {path}")
