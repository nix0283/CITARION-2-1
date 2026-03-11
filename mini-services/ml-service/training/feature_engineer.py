"""
Feature Engineering - Creates features for ML models from OHLCV data.
Production-ready implementation with comprehensive technical indicators.
"""

import numpy as np
import pandas as pd
from typing import List, Tuple, Optional, Dict, Any
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class FeatureConfig:
    """Configuration for feature engineering"""
    sequence_length: int = 60
    prediction_horizons: List[int] = None  # [1, 5, 15, 60] minutes
    
    def __post_init__(self):
        if self.prediction_horizons is None:
            self.prediction_horizons = [1, 5, 15, 60]


class TechnicalIndicators:
    """Technical indicator calculations"""
    
    @staticmethod
    def sma(data: pd.Series, period: int) -> pd.Series:
        """Simple Moving Average"""
        return data.rolling(window=period).mean()
    
    @staticmethod
    def ema(data: pd.Series, period: int) -> pd.Series:
        """Exponential Moving Average"""
        return data.ewm(span=period, adjust=False).mean()
    
    @staticmethod
    def rsi(close: pd.Series, period: int = 14) -> pd.Series:
        """Relative Strength Index"""
        delta = close.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        return 100 - (100 / (1 + rs))
    
    @staticmethod
    def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> Tuple[pd.Series, pd.Series, pd.Series]:
        """MACD indicator"""
        ema_fast = close.ewm(span=fast, adjust=False).mean()
        ema_slow = close.ewm(span=slow, adjust=False).mean()
        macd_line = ema_fast - ema_slow
        signal_line = macd_line.ewm(span=signal, adjust=False).mean()
        histogram = macd_line - signal_line
        return macd_line, signal_line, histogram
    
    @staticmethod
    def bollinger_bands(close: pd.Series, period: int = 20, std_dev: float = 2) -> Tuple[pd.Series, pd.Series, pd.Series]:
        """Bollinger Bands"""
        middle = close.rolling(window=period).mean()
        std = close.rolling(window=period).std()
        upper = middle + std_dev * std
        lower = middle - std_dev * std
        return upper, middle, lower
    
    @staticmethod
    def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
        """Average True Range"""
        tr1 = high - low
        tr2 = abs(high - close.shift())
        tr3 = abs(low - close.shift())
        tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
        return tr.rolling(window=period).mean()
    
    @staticmethod
    def stochastic(high: pd.Series, low: pd.Series, close: pd.Series, k_period: int = 14, d_period: int = 3) -> Tuple[pd.Series, pd.Series]:
        """Stochastic Oscillator"""
        lowest_low = low.rolling(window=k_period).min()
        highest_high = high.rolling(window=k_period).max()
        k = 100 * (close - lowest_low) / (highest_high - lowest_low)
        d = k.rolling(window=d_period).mean()
        return k, d
    
    @staticmethod
    def williams_r(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
        """Williams %R"""
        highest_high = high.rolling(window=period).max()
        lowest_low = low.rolling(window=period).min()
        return -100 * (highest_high - close) / (highest_high - lowest_low)
    
    @staticmethod
    def cci(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 20) -> pd.Series:
        """Commodity Channel Index"""
        tp = (high + low + close) / 3
        sma = tp.rolling(window=period).mean()
        mad = tp.rolling(window=period).apply(lambda x: np.abs(x - x.mean()).mean())
        return (tp - sma) / (0.015 * mad)
    
    @staticmethod
    def momentum(close: pd.Series, period: int = 10) -> pd.Series:
        """Momentum"""
        return close - close.shift(period)
    
    @staticmethod
    def roc(close: pd.Series, period: int = 10) -> pd.Series:
        """Rate of Change"""
        return 100 * (close - close.shift(period)) / close.shift(period)
    
    @staticmethod
    def obv(close: pd.Series, volume: pd.Series) -> pd.Series:
        """On-Balance Volume"""
        obv = pd.Series(index=close.index, dtype=float)
        obv.iloc[0] = volume.iloc[0]
        
        for i in range(1, len(close)):
            if close.iloc[i] > close.iloc[i-1]:
                obv.iloc[i] = obv.iloc[i-1] + volume.iloc[i]
            elif close.iloc[i] < close.iloc[i-1]:
                obv.iloc[i] = obv.iloc[i-1] - volume.iloc[i]
            else:
                obv.iloc[i] = obv.iloc[i-1]
        
        return obv
    
    @staticmethod
    def vwap(high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series) -> pd.Series:
        """Volume Weighted Average Price"""
        typical_price = (high + low + close) / 3
        return (typical_price * volume).cumsum() / volume.cumsum()
    
    @staticmethod
    def adx(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> Tuple[pd.Series, pd.Series, pd.Series]:
        """Average Directional Index"""
        plus_dm = high.diff()
        minus_dm = low.diff()
        
        plus_dm[plus_dm < 0] = 0
        minus_dm[minus_dm > 0] = 0
        
        tr = TechnicalIndicators.atr(high, low, close, 1) * period  # Approximate ATR for TR sum
        
        plus_di = 100 * (plus_dm.rolling(window=period).mean() / tr.rolling(window=period).mean())
        minus_di = 100 * (abs(minus_dm).rolling(window=period).mean() / tr.rolling(window=period).mean())
        
        dx = 100 * abs(plus_di - minus_di) / (plus_di + minus_di)
        adx = dx.rolling(window=period).mean()
        
        return adx, plus_di, minus_di


class FeatureEngineer:
    """
    Production-ready feature engineering for ML models.
    
    Creates comprehensive features from OHLCV data including:
    - Price-based features (returns, momentum)
    - Volume features
    - Volatility features
    - Technical indicators
    - Lagged features
    """
    
    def __init__(self, config: Optional[FeatureConfig] = None):
        self.config = config or FeatureConfig()
        self.indicators = TechnicalIndicators()
    
    def create_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Create all features from OHLCV DataFrame.
        
        Args:
            df: DataFrame with columns [open, high, low, close, volume]
        
        Returns:
            DataFrame with engineered features
        """
        df = df.copy()
        
        # Basic features
        df = self._add_price_features(df)
        df = self._add_volume_features(df)
        df = self._add_volatility_features(df)
        
        # Technical indicators
        df = self._add_moving_averages(df)
        df = self._add_oscillators(df)
        df = self._add_trend_indicators(df)
        
        # Lagged features
        df = self._add_lagged_features(df)
        
        # Time features
        df = self._add_time_features(df)
        
        # Clean up
        df = df.replace([np.inf, -np.inf], np.nan)
        df = df.dropna()
        
        return df
    
    def _add_price_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add price-based features"""
        close = df['close']
        high = df['high']
        low = df['low']
        open_ = df['open']
        
        # Returns
        df['returns'] = close.pct_change()
        df['log_returns'] = np.log(close / close.shift(1))
        
        # Cumulative returns
        df['cum_returns_5'] = close.pct_change(5)
        df['cum_returns_10'] = close.pct_change(10)
        df['cum_returns_20'] = close.pct_change(20)
        
        # Price position
        df['close_to_open'] = close / open_ - 1
        df['high_to_low'] = high / low - 1
        df['close_to_high'] = close / high
        df['close_to_low'] = close / low
        
        # Price gaps
        df['gap'] = open_ / close.shift(1) - 1
        
        # Momentum
        df['momentum_5'] = self.indicators.momentum(close, 5)
        df['momentum_10'] = self.indicators.momentum(close, 10)
        df['roc_5'] = self.indicators.roc(close, 5)
        df['roc_10'] = self.indicators.roc(close, 10)
        
        return df
    
    def _add_volume_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add volume-based features"""
        volume = df['volume']
        close = df['close']
        high = df['high']
        low = df['low']
        
        # Volume changes
        df['volume_change'] = volume.pct_change()
        df['volume_ma_5'] = volume.rolling(window=5).mean()
        df['volume_ma_20'] = volume.rolling(window=20).mean()
        df['volume_ratio'] = volume / df['volume_ma_20']
        
        # OBV
        df['obv'] = self.indicators.obv(close, volume)
        df['obv_ma'] = df['obv'].rolling(window=20).mean()
        
        # VWAP
        df['vwap'] = self.indicators.vwap(high, low, close, volume)
        df['close_to_vwap'] = close / df['vwap'] - 1
        
        # Volume pressure
        df['volume_price_trend'] = volume * df['returns']
        df['volume_force'] = volume * (close - open_)
        
        return df
    
    def _add_volatility_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add volatility features"""
        close = df['close']
        high = df['high']
        low = df['low']
        returns = df['returns']
        
        # Historical volatility
        df['volatility_5'] = returns.rolling(window=5).std()
        df['volatility_20'] = returns.rolling(window=20).std()
        df['volatility_60'] = returns.rolling(window=60).std()
        
        # ATR
        df['atr_14'] = self.indicators.atr(high, low, close, 14)
        df['atr_ratio'] = df['atr_14'] / close
        
        # Parkinson volatility
        df['parkinson_vol'] = np.sqrt(
            (np.log(high / low) ** 2).rolling(window=20).mean() / (4 * np.log(2))
        )
        
        # Garman-Klass volatility
        df['garman_klass_vol'] = np.sqrt(
            (0.5 * np.log(high / low) ** 2 - 
             (2 * np.log(2) - 1) * np.log(close / df['open']) ** 2)
            .rolling(window=20).mean()
        )
        
        # Volatility regime
        df['volatility_regime'] = df['volatility_20'].rolling(window=60).rank(pct=True)
        
        return df
    
    def _add_moving_averages(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add moving average features"""
        close = df['close']
        
        # Simple Moving Averages
        for period in [7, 14, 20, 50, 100, 200]:
            df[f'sma_{period}'] = self.indicators.sma(close, period)
            df[f'close_to_sma_{period}'] = close / df[f'sma_{period}'] - 1
        
        # Exponential Moving Averages
        for period in [7, 14, 20, 50, 100, 200]:
            df[f'ema_{period}'] = self.indicators.ema(close, period)
            df[f'close_to_ema_{period}'] = close / df[f'ema_{period}'] - 1
        
        # MA crossovers
        df['sma_7_20_cross'] = (df['sma_7'] > df['sma_20']).astype(int)
        df['sma_20_50_cross'] = (df['sma_20'] > df['sma_50']).astype(int)
        df['ema_7_20_cross'] = (df['ema_7'] > df['ema_20']).astype(int)
        
        # MACD
        macd, signal, hist = self.indicators.macd(close)
        df['macd'] = macd
        df['macd_signal'] = signal
        df['macd_histogram'] = hist
        df['macd_cross'] = (macd > signal).astype(int)
        
        # Bollinger Bands
        upper, middle, lower = self.indicators.bollinger_bands(close)
        df['bb_upper'] = upper
        df['bb_middle'] = middle
        df['bb_lower'] = lower
        df['bb_width'] = (upper - lower) / middle
        df['bb_position'] = (close - lower) / (upper - lower)
        df['bb_squeeze'] = df['bb_width'].rolling(window=20).rank(pct=True)
        
        return df
    
    def _add_oscillators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add oscillator indicators"""
        close = df['close']
        high = df['high']
        low = df['low']
        
        # RSI
        for period in [7, 14, 21]:
            df[f'rsi_{period}'] = self.indicators.rsi(close, period)
        
        df['rsi_overbought'] = (df['rsi_14'] > 70).astype(int)
        df['rsi_oversold'] = (df['rsi_14'] < 30).astype(int)
        
        # Stochastic
        k, d = self.indicators.stochastic(high, low, close)
        df['stoch_k'] = k
        df['stoch_d'] = d
        df['stoch_cross'] = (k > d).astype(int)
        
        # Williams %R
        df['williams_r'] = self.indicators.williams_r(high, low, close)
        
        # CCI
        df['cci'] = self.indicators.cci(high, low, close)
        
        return df
    
    def _add_trend_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add trend indicators"""
        close = df['close']
        high = df['high']
        low = df['low']
        
        # ADX
        adx, plus_di, minus_di = self.indicators.adx(high, low, close)
        df['adx'] = adx
        df['plus_di'] = plus_di
        df['minus_di'] = minus_di
        df['di_cross'] = (plus_di > minus_di).astype(int)
        df['trend_strength'] = adx * df['di_cross'].replace(0, -1)
        
        return df
    
    def _add_lagged_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add lagged features"""
        # Key features to lag
        lag_features = [
            'returns', 'volume_change', 'volatility_20',
            'rsi_14', 'macd', 'bb_position', 'adx'
        ]
        
        # Add lags
        for feature in lag_features:
            if feature in df.columns:
                for lag in [1, 2, 3, 5, 10]:
                    df[f'{feature}_lag_{lag}'] = df[feature].shift(lag)
        
        return df
    
    def _add_time_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add time-based features"""
        if isinstance(df.index, pd.DatetimeIndex):
            df['hour'] = df.index.hour
            df['day_of_week'] = df.index.dayofweek
            df['day_of_month'] = df.index.day
            df['month'] = df.index.month
            
            # Cyclical encoding
            df['hour_sin'] = np.sin(2 * np.pi * df['hour'] / 24)
            df['hour_cos'] = np.cos(2 * np.pi * df['hour'] / 24)
            df['dow_sin'] = np.sin(2 * np.pi * df['day_of_week'] / 7)
            df['dow_cos'] = np.cos(2 * np.pi * df['day_of_week'] / 7)
        
        return df
    
    def create_targets(
        self, 
        df: pd.DataFrame,
        horizons: Optional[List[int]] = None
    ) -> pd.DataFrame:
        """
        Create prediction targets.
        
        Args:
            df: DataFrame with OHLCV data
            horizons: Prediction horizons in candles (default: [1, 5, 15, 60])
        
        Returns:
            DataFrame with target columns
        """
        horizons = horizons or self.config.prediction_horizons
        df = df.copy()
        
        close = df['close']
        
        for horizon in horizons:
            # Price change percentage
            df[f'target_{horizon}m'] = close.shift(-horizon) / close - 1
            
            # Direction (binary)
            df[f'direction_{horizon}m'] = (df[f'target_{horizon}m'] > 0).astype(int)
            
            # High/low in horizon
            df[f'future_high_{horizon}m'] = df['high'].rolling(window=horizon).max().shift(-horizon)
            df[f'future_low_{horizon}m'] = df['low'].rolling(window=horizon).min().shift(-horizon)
            
            # Max favorable excursion
            df[f'mfe_{horizon}m'] = (df[f'future_high_{horizon}m'] - close) / close
            
            # Max adverse excursion
            df[f'mae_{horizon}m'] = (close - df[f'future_low_{horizon}m']) / close
        
        return df
    
    def prepare_sequences(
        self, 
        df: pd.DataFrame,
        feature_columns: List[str],
        target_column: str = 'target_1m',
        sequence_length: Optional[int] = None
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Prepare sequences for LSTM/Transformer models.
        
        Args:
            df: DataFrame with features and targets
            feature_columns: List of feature column names
            target_column: Target column name
            sequence_length: Sequence length (default: from config)
        
        Returns:
            Tuple of (X, y) arrays
        """
        sequence_length = sequence_length or self.config.sequence_length
        
        # Get feature matrix
        features = df[feature_columns].values
        targets = df[target_column].values
        
        # Create sequences
        X, y = [], []
        
        for i in range(sequence_length, len(features) - max(self.config.prediction_horizons)):
            X.append(features[i - sequence_length:i])
            y.append(targets[i])
        
        return np.array(X), np.array(y)
    
    def get_feature_columns(self) -> List[str]:
        """Get list of all feature columns"""
        # This returns a comprehensive list of features
        # The actual columns depend on what's available in the data
        return [
            # Price features
            'returns', 'log_returns', 'cum_returns_5', 'cum_returns_10', 'cum_returns_20',
            'close_to_open', 'high_to_low', 'close_to_high', 'close_to_low', 'gap',
            'momentum_5', 'momentum_10', 'roc_5', 'roc_10',
            
            # Volume features
            'volume_change', 'volume_ratio', 'obv', 'close_to_vwap',
            'volume_price_trend', 'volume_force',
            
            # Volatility features
            'volatility_5', 'volatility_20', 'volatility_60',
            'atr_ratio', 'parkinson_vol', 'garman_klass_vol', 'volatility_regime',
            
            # Moving averages
            'close_to_sma_7', 'close_to_sma_20', 'close_to_sma_50',
            'close_to_ema_7', 'close_to_ema_20', 'close_to_ema_50',
            'sma_7_20_cross', 'sma_20_50_cross', 'ema_7_20_cross',
            
            # MACD
            'macd', 'macd_signal', 'macd_histogram', 'macd_cross',
            
            # Bollinger Bands
            'bb_width', 'bb_position', 'bb_squeeze',
            
            # Oscillators
            'rsi_7', 'rsi_14', 'rsi_21', 'rsi_overbought', 'rsi_oversold',
            'stoch_k', 'stoch_d', 'stoch_cross', 'williams_r', 'cci',
            
            # Trend
            'adx', 'trend_strength', 'di_cross',
            
            # Time features
            'hour_sin', 'hour_cos', 'dow_sin', 'dow_cos',
        ]


def engineer_features(
    df: pd.DataFrame,
    config: Optional[FeatureConfig] = None
) -> pd.DataFrame:
    """Convenience function for feature engineering"""
    engineer = FeatureEngineer(config)
    return engineer.create_features(df)


class FeatureEngineerExtended(FeatureEngineer):
    """
    Extended FeatureEngineer with additional methods for training.
    """
    
    def create_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Create all features from OHLCV DataFrame.
        
        Args:
            df: DataFrame with columns [open, high, low, close, volume]
        
        Returns:
            DataFrame with engineered features
        """
        df = df.copy()
        
        # Ensure proper column names
        df.columns = [col.lower() for col in df.columns]
        
        # Basic features
        df = self._add_price_features(df)
        df = self._add_volume_features(df)
        df = self._add_volatility_features(df)
        
        # Technical indicators
        df = self._add_moving_averages(df)
        df = self._add_oscillators(df)
        df = self._add_trend_indicators(df)
        
        # Lagged features
        df = self._add_lagged_features(df)
        
        # Time features
        df = self._add_time_features(df)
        
        # Clean up
        df = df.replace([np.inf, -np.inf], np.nan)
        
        return df
    
    def create_targets(
        self, 
        df: pd.DataFrame,
        horizons: Optional[List[int]] = None
    ) -> pd.DataFrame:
        """
        Create prediction targets.
        
        Args:
            df: DataFrame with OHLCV data
            horizons: Prediction horizons in candles (default: [1, 5, 15, 60])
        
        Returns:
            DataFrame with target columns
        """
        horizons = horizons or self.config.prediction_horizons
        df = df.copy()
        
        close = df['close']
        
        for horizon in horizons:
            # Price change percentage
            df[f'target_{horizon}m'] = close.shift(-horizon) / close - 1
            
            # Direction (binary)
            df[f'direction_{horizon}m'] = (df[f'target_{horizon}m'] > 0).astype(int)
        
        return df
    
    def prepare_sequences(
        self, 
        df: pd.DataFrame,
        feature_columns: List[str],
        target_column: str = 'target_1m',
        sequence_length: Optional[int] = None
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Prepare sequences for LSTM/Transformer models.
        
        Args:
            df: DataFrame with features and targets
            feature_columns: List of feature column names
            target_column: Target column name
            sequence_length: Sequence length (default: from config)
        
        Returns:
            Tuple of (X, y) arrays
        """
        sequence_length = sequence_length or self.config.sequence_length
        
        # Filter available columns
        available_features = [col for col in feature_columns if col in df.columns]
        
        # Get feature matrix
        features = df[available_features].values
        targets = df[target_column].values
        
        # Fill NaN values
        features = np.nan_to_num(features, nan=0.0)
        targets = np.nan_to_num(targets, nan=0.0)
        
        # Create sequences
        X, y = [], []
        
        max_horizon = max(self.config.prediction_horizons)
        
        for i in range(sequence_length, len(features) - max_horizon):
            X.append(features[i - sequence_length:i])
            y.append(targets[i])
        
        return np.array(X), np.array(y)


def engineer_features_extended(
    df: pd.DataFrame,
    config: Optional[FeatureConfig] = None
) -> pd.DataFrame:
    """Convenience function for extended feature engineering"""
    engineer = FeatureEngineerExtended(config)
    return engineer.create_features(df)


if __name__ == "__main__":
    # Test feature engineering
    from data_fetcher import fetch_training_data
    
    # Fetch data
    df = fetch_training_data("BTCUSDT", "binance", "1h", 30)
    
    # Engineer features
    features_df = engineer_features_extended(df)
    
    print(f"Features created: {len(features_df.columns)}")
    print(f"Feature columns: {list(features_df.columns)[:20]}...")
    print(f"Shape: {features_df.shape}")
