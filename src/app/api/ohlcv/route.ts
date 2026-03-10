/**
 * OHLCV API Endpoint
 *
 * GET /api/ohlcv - Get candlestick data
 * POST /api/ohlcv - Sync historical data
 *
 * Priority: Database (if fresh) → Exchange API fallback
 * Supports: Binance, Bybit, OKX
 */

import { NextRequest, NextResponse } from 'next/server';
import { OhlcvService, MultiExchangeFetcher, ExchangeId } from '@/lib/ohlcv-service';

// Timeframe mappings
const TIMEFRAME_MAP: Record<string, string> = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '8h': '8h', '12h': '12h',
  '1d': '1d', '3d': '3d', '1w': '1w', '1M': '1M',
};

// Timeframe durations in milliseconds
const TIMEFRAME_DURATIONS: Record<string, number> = {
  '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '30m': 1800000,
  '1h': 3600000, '2h': 7200000, '4h': 14400000, '6h': 21600000, '8h': 28800000, '12h': 43200000,
  '1d': 86400000, '3d': 259200000, '1w': 604800000, '1M': 2592000000,
};

// Supported exchanges
const SUPPORTED_EXCHANGES: ExchangeId[] = ['binance', 'bybit', 'okx'];

// Maximum age for cached data (in ms) - 2x the timeframe
const getMaxDataAge = (timeframe: string): number => {
  const duration = TIMEFRAME_DURATIONS[timeframe] || 3600000;
  return duration * 2;
};

interface BinanceKline {
  0: number;  // Open time
  1: string;  // Open
  2: string;  // High
  3: string;  // Low
  4: string;  // Close
  5: string;  // Volume
  6: number;  // Close time
  7: string;  // Quote asset volume
  8: number;  // Number of trades
  9: string;  // Taker buy base asset volume
  10: string; // Taker buy quote asset volume
  11: string; // Ignore
}

/**
 * GET /api/ohlcv
 * Fetch candlestick data from database or exchange API
 * Auto-refreshes stale data from database
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol') || 'BTCUSDT';
    const interval = searchParams.get('interval') || '1h';
    const limit = Math.min(parseInt(searchParams.get('limit') || '500'), 1500);
    const exchange = (searchParams.get('exchange') || 'binance') as ExchangeId;
    const marketType = searchParams.get('marketType') || 'futures';
    const forceFetch = searchParams.get('forceFetch') === 'true';

    const binanceInterval = TIMEFRAME_MAP[interval] || '1h';
    const maxDataAge = getMaxDataAge(interval);

    // Try to get from database first (unless force fetch)
    if (!forceFetch) {
      try {
        const dbCandles = await OhlcvService.getCandles({
          symbol,
          exchange,
          marketType,
          timeframe: binanceInterval,
          limit,
        });

        if (dbCandles.length > 0) {
          // Check if data is fresh enough
          const lastCandleTime = dbCandles[dbCandles.length - 1].openTime.getTime();
          const now = Date.now();
          const dataAge = now - lastCandleTime;
          
          // If data is fresh, return it
          if (dataAge <= maxDataAge) {
            const ohlcv = dbCandles.map((c) => [
              c.openTime.getTime(),
              c.open,
              c.high,
              c.low,
              c.close,
              c.volume,
            ]);

            return NextResponse.json({
              success: true,
              source: 'database',
              symbol,
              interval: binanceInterval,
              exchange,
              marketType,
              count: ohlcv.length,
              ohlcv,
            });
          }
          
          // Data is stale - log and fall through to API
          console.log(`[OHLCV] Database data is stale (age: ${Math.round(dataAge/60000)}min, max: ${Math.round(maxDataAge/60000)}min), fetching fresh data`);
        }
      } catch (dbError) {
        console.warn('Database query failed, falling back to API:', dbError);
      }
    }

    // Fallback to exchange API
    if (!SUPPORTED_EXCHANGES.includes(exchange)) {
      return NextResponse.json({
        success: false,
        error: `Exchange '${exchange}' not supported. Use: ${SUPPORTED_EXCHANGES.join(', ')}`,
        ohlcv: [],
      }, { status: 400 });
    }

    try {
      const candles = await MultiExchangeFetcher.fetchKlines({
        exchange,
        symbol,
        interval: binanceInterval,
        limit,
        marketType: marketType as 'spot' | 'futures',
      });

      const ohlcv = candles.map((c) => [
        c.openTime.getTime(),
        c.open,
        c.high,
        c.low,
        c.close,
        c.volume,
      ]);

      // Store in database in background
      storeCandlesInBackground(candles).catch(console.error);

      return NextResponse.json({
        success: true,
        source: 'api',
        symbol,
        interval: binanceInterval,
        exchange,
        marketType,
        count: ohlcv.length,
        ohlcv,
      });

    } catch (apiError) {
      console.error(`Failed to fetch from ${exchange}:`, apiError);

      return NextResponse.json({
        success: false,
        error: apiError instanceof Error ? apiError.message : 'Failed to fetch data',
        ohlcv: [],
      }, { status: 500 });
    }

  } catch (error) {
    console.error('OHLCV API error:', error);

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch OHLCV data',
      ohlcv: [],
    }, { status: 500 });
  }
}

/**
 * POST /api/ohlcv
 * Sync historical data from exchange
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      action,
      symbol = 'BTCUSDT',
      interval = '1h',
      marketType = 'futures',
      daysBack = 30,
      exchange = 'binance',
    } = body;

    if (action === 'sync') {
      // Validate exchange
      if (!SUPPORTED_EXCHANGES.includes(exchange)) {
        return NextResponse.json({
          success: false,
          error: `Exchange '${exchange}' not supported. Use: ${SUPPORTED_EXCHANGES.join(', ')}`,
        }, { status: 400 });
      }

      // Start sync in background
      MultiExchangeFetcher.syncHistory({
        exchange,
        symbol,
        interval: TIMEFRAME_MAP[interval] || interval,
        marketType,
        daysBack,
      }).catch(console.error);

      return NextResponse.json({
        success: true,
        message: 'Sync started in background',
        symbol,
        interval,
        exchange,
        marketType,
        daysBack,
      });
    }

    if (action === 'status') {
      const status = await OhlcvService.getSyncStatus({
        exchange,
        symbol,
        marketType,
        timeframe: interval,
      });

      const count = await OhlcvService.countCandles({
        symbol,
        exchange,
        timeframe: interval,
      });

      return NextResponse.json({
        success: true,
        symbol,
        interval,
        exchange,
        marketType,
        status,
        totalCandles: count,
      });
    }

    if (action === 'cleanup') {
      const daysOld = body.daysOld || 365;
      const before = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

      const deleted = await OhlcvService.deleteOldCandles({ before });

      return NextResponse.json({
        success: true,
        message: `Deleted ${deleted} old candles`,
        deleted,
        before: before.toISOString(),
      });
    }

    return NextResponse.json({
      success: false,
      error: 'Unknown action. Use: sync, status, or cleanup',
    }, { status: 400 });

  } catch (error) {
    console.error('OHLCV POST error:', error);

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process request',
    }, { status: 500 });
  }
}

/**
 * Store candles in database in background
 */
async function storeCandlesInBackground(candles: any[]): Promise<void> {
  try {
    await OhlcvService.storeCandles(candles);
  } catch (error) {
    console.error('Failed to store candles in background:', error);
  }
}
