"""
Data Fetcher - Fetches OHLCV data from exchanges for model training.
Production-ready implementation with rate limiting and error handling.
"""

import asyncio
import aiohttp
import pandas as pd
import numpy as np
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ExchangeConfig:
    """Exchange API configuration"""
    name: str
    base_url: str
    klines_endpoint: str
    rate_limit: float  # requests per second
    symbol_format: str  # "BTCUSDT" or "BTC-USDT"


# Exchange configurations for OHLCV data fetching
EXCHANGES = {
    "binance": ExchangeConfig(
        name="binance",
        base_url="https://fapi.binance.com",
        klines_endpoint="/fapi/v1/klines",
        rate_limit=20,
        symbol_format="BTCUSDT"
    ),
    "bybit": ExchangeConfig(
        name="bybit",
        base_url="https://api.bybit.com",
        klines_endpoint="/v5/market/kline",
        rate_limit=10,
        symbol_format="BTCUSDT"
    ),
    "okx": ExchangeConfig(
        name="okx",
        base_url="https://www.okx.com",
        klines_endpoint="/api/v5/market/candles",
        rate_limit=10,
        symbol_format="BTC-USDT-SWAP"
    ),
}


class DataFetcher:
    """
    Production-ready OHLCV data fetcher.
    
    Features:
    - Multi-exchange support (Binance, Bybit, OKX)
    - Rate limiting
    - Automatic retries
    - Data validation
    - Caching support
    """
    
    def __init__(self, exchange: str = "binance"):
        self.exchange = EXCHANGES.get(exchange)
        if not self.exchange:
            raise ValueError(f"Unsupported exchange: {exchange}")
        
        self.session: Optional[aiohttp.ClientSession] = None
        self._last_request_time = 0
        self._request_interval = 1.0 / self.exchange.rate_limit
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def _rate_limit(self):
        """Apply rate limiting"""
        current_time = asyncio.get_event_loop().time()
        elapsed = current_time - self._last_request_time
        if elapsed < self._request_interval:
            await asyncio.sleep(self._request_interval - elapsed)
        self._last_request_time = asyncio.get_event_loop().time()
    
    async def _fetch_with_retry(
        self, 
        url: str, 
        params: Dict[str, Any], 
        max_retries: int = 3
    ) -> Optional[Any]:
        """Fetch with automatic retries"""
        for attempt in range(max_retries):
            try:
                await self._rate_limit()
                
                async with self.session.get(url, params=params, timeout=30) as response:
                    if response.status == 200:
                        return await response.json()
                    elif response.status == 429:
                        # Rate limited - wait longer
                        await asyncio.sleep(60)
                        continue
                    else:
                        logger.warning(f"HTTP {response.status}: {await response.text()}")
                        
            except aiohttp.ClientError as e:
                logger.warning(f"Request failed (attempt {attempt + 1}): {e}")
                await asyncio.sleep(2 ** attempt)  # Exponential backoff
        
        return None
    
    def _format_symbol(self, symbol: str) -> str:
        """Format symbol for the exchange"""
        if self.exchange.name == "okx":
            # Convert BTCUSDT -> BTC-USDT-SWAP
            return symbol.replace("USDT", "-USDT-SWAP")
        return symbol
    
    def _format_timeframe(self, timeframe: str) -> str:
        """Format timeframe for the exchange"""
        mapping = {
            "binance": {
                "1m": "1m", "5m": "5m", "15m": "15m", 
                "1h": "1h", "4h": "4h", "1d": "1d"
            },
            "bybit": {
                "1m": "1", "5m": "5", "15m": "15", 
                "1h": "60", "4h": "240", "1d": "D"
            },
            "okx": {
                "1m": "1m", "5m": "5m", "15m": "15m", 
                "1h": "1H", "4h": "4H", "1d": "1D"
            }
        }
        return mapping.get(self.exchange.name, {}).get(timeframe, timeframe)
    
    async def fetch_klines(
        self,
        symbol: str,
        timeframe: str = "1h",
        limit: int = 1000,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None
    ) -> pd.DataFrame:
        """
        Fetch OHLCV candlestick data.
        
        Args:
            symbol: Trading pair (e.g., "BTCUSDT")
            timeframe: Candle timeframe (1m, 5m, 15m, 1h, 4h, 1d)
            limit: Number of candles to fetch
            start_time: Start datetime
            end_time: End datetime
        
        Returns:
            DataFrame with columns: open, high, low, close, volume, timestamp
        """
        formatted_symbol = self._format_symbol(symbol)
        formatted_timeframe = self._format_timeframe(timeframe)
        
        if self.exchange.name == "binance":
            params = {
                "symbol": formatted_symbol,
                "interval": formatted_timeframe,
                "limit": limit,
            }
            if start_time:
                params["startTime"] = int(start_time.timestamp() * 1000)
            if end_time:
                params["endTime"] = int(end_time.timestamp() * 1000)
            
            url = f"{self.exchange.base_url}{self.exchange.klines_endpoint}"
            data = await self._fetch_with_retry(url, params)
            
            if not data:
                raise ValueError(f"Failed to fetch data for {symbol}")
            
            df = pd.DataFrame(data, columns=[
                'timestamp', 'open', 'high', 'low', 'close', 'volume',
                'close_time', 'quote_volume', 'trades', 'taker_buy_volume',
                'taker_buy_quote_volume', 'ignore'
            ])
            
        elif self.exchange.name == "bybit":
            params = {
                "category": "linear",
                "symbol": formatted_symbol,
                "interval": formatted_timeframe,
                "limit": limit,
            }
            if start_time:
                params["start"] = int(start_time.timestamp() * 1000)
            if end_time:
                params["end"] = int(end_time.timestamp() * 1000)
            
            url = f"{self.exchange.base_url}{self.exchange.klines_endpoint}"
            data = await self._fetch_with_retry(url, params)
            
            if not data or "result" not in data:
                raise ValueError(f"Failed to fetch data for {symbol}")
            
            # Bybit returns data in reverse order (newest first)
            klines = data["result"]["list"][::-1]
            df = pd.DataFrame(klines, columns=[
                'timestamp', 'open', 'high', 'low', 'close', 'volume', 'turnover'
            ])
            
        elif self.exchange.name == "okx":
            params = {
                "instId": formatted_symbol,
                "bar": formatted_timeframe,
                "limit": limit,
            }
            if start_time:
                params["before"] = int(start_time.timestamp() * 1000)
            if end_time:
                params["after"] = int(end_time.timestamp() * 1000)
            
            url = f"{self.exchange.base_url}{self.exchange.klines_endpoint}"
            data = await self._fetch_with_retry(url, params)
            
            if not data or "data" not in data:
                raise ValueError(f"Failed to fetch data for {symbol}")
            
            # OKX returns data in reverse order
            klines = data["data"][::-1]
            df = pd.DataFrame(klines, columns=[
                'timestamp', 'open', 'high', 'low', 'close', 'volume',
                'quote_volume', 'volume_ccy', 'volume_ccy_quote', 'confirm'
            ])
        
        # Standardize DataFrame
        df = self._standardize_dataframe(df)
        
        logger.info(f"Fetched {len(df)} candles for {symbol} {timeframe}")
        return df
    
    def _standardize_dataframe(self, df: pd.DataFrame) -> pd.DataFrame:
        """Standardize DataFrame format across exchanges"""
        # Convert to numeric
        for col in ['open', 'high', 'low', 'close', 'volume']:
            df[col] = pd.to_numeric(df[col], errors='coerce')
        
        # Convert timestamp
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        
        # Set timestamp as index
        df.set_index('timestamp', inplace=True)
        
        # Select only needed columns
        df = df[['open', 'high', 'low', 'close', 'volume']]
        
        # Remove any NaN values
        df.dropna(inplace=True)
        
        return df
    
    async def fetch_historical_data(
        self,
        symbol: str,
        timeframe: str = "1h",
        days: int = 365,
        chunk_size: int = 1000
    ) -> pd.DataFrame:
        """
        Fetch historical data for training.
        
        Fetches data in chunks to get more history than API limits allow.
        """
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(days=days)
        
        all_data = []
        current_end = end_time
        
        while current_end > start_time:
            try:
                df = await self.fetch_klines(
                    symbol=symbol,
                    timeframe=timeframe,
                    limit=chunk_size,
                    end_time=current_end
                )
                
                if df.empty:
                    break
                
                all_data.append(df)
                
                # Move back in time
                current_end = df.index[0] - timedelta(milliseconds=1)
                
                # Small delay between requests
                await asyncio.sleep(0.1)
                
            except Exception as e:
                logger.error(f"Error fetching chunk: {e}")
                break
        
        if not all_data:
            raise ValueError(f"No data fetched for {symbol}")
        
        # Combine all chunks
        combined = pd.concat(all_data)
        combined = combined[~combined.index.duplicated(keep='first')]
        combined.sort_index(inplace=True)
        
        # Filter to requested date range
        combined = combined[combined.index >= start_time]
        
        logger.info(f"Fetched {len(combined)} total candles for {symbol}")
        return combined


async def fetch_multiple_symbols(
    symbols: List[str],
    exchange: str = "binance",
    timeframe: str = "1h",
    days: int = 365
) -> Dict[str, pd.DataFrame]:
    """
    Fetch data for multiple symbols concurrently.
    """
    results = {}
    
    async with DataFetcher(exchange) as fetcher:
        tasks = [
            fetcher.fetch_historical_data(symbol, timeframe, days)
            for symbol in symbols
        ]
        
        data_list = await asyncio.gather(*tasks, return_exceptions=True)
        
        for symbol, data in zip(symbols, data_list):
            if isinstance(data, Exception):
                logger.error(f"Failed to fetch {symbol}: {data}")
            else:
                results[symbol] = data
    
    return results


# Convenience function for synchronous usage
def fetch_training_data(
    symbol: str = "BTCUSDT",
    exchange: str = "binance",
    timeframe: str = "1h",
    days: int = 365
) -> pd.DataFrame:
    """Synchronous wrapper for data fetching"""
    async def _fetch():
        async with DataFetcher(exchange) as fetcher:
            return await fetcher.fetch_historical_data(symbol, timeframe, days)
    
    return asyncio.run(_fetch())


if __name__ == "__main__":
    # Test data fetcher
    df = fetch_training_data("BTCUSDT", "binance", "1h", 30)
    print(f"Fetched {len(df)} candles")
    print(df.head())
