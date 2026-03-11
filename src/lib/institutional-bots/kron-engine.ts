/**
 * KronBot Engine - Trend Following Bot
 * 
 * Strategy: Multi-Indicator Trend Following with MACD and ADX
 * Algorithm: Identifies and follows established trends with momentum confirmation
 * 
 * Key Features:
 * - MACD for trend direction and momentum
 * - ADX for trend strength
 * - Moving average crossovers
 * - Volume confirmation
 * - Dynamic trailing stops
 */

import { BaseBotEngine, BotConfig, MarketData, Signal, IndicatorValues, RiskCheckResult, BotEngineResult } from './types';

export interface KronConfig extends BotConfig {
  maFastLength: number; // Fast MA period
  maSlowLength: number; // Slow MA period
  signalLineLength: number; // MACD signal line period
  adxThreshold: number; // ADX threshold for trend confirmation
  adxSmoothing: number; // ADX smoothing period
  trailingStopPercent: number; // Trailing stop percentage
  volumeConfirmThreshold: number; // Volume ratio threshold
  useMultipleTimeframes: boolean; // Enable MTF analysis
}

export interface TrendState {
  direction: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS';
  strength: number; // 0-100
  duration: number; // Bars in current trend
  startedAt: Date | null;
}

export class KronEngine extends BaseBotEngine {
  readonly botType = 'TRF' as const;
  
  private kronConfig: KronConfig | null = null;
  private trendState: TrendState = {
    direction: 'SIDEWAYS',
    strength: 0,
    duration: 0,
    startedAt: null,
  };
  private macdHistory: Array<{ macd: number; signal: number; histogram: number }> = [];
  private adxHistory: number[] = [];
  private emaFast: number = 0;
  private emaSlow: number = 0;
  private highestPrice: number = 0;
  private lowestPrice: number = Infinity;
  private entryPrice: number | null = null;

  async initialize(config: BotConfig): Promise<void> {
    this.config = config;
    this.kronConfig = {
      ...config,
      maFastLength: 12,
      maSlowLength: 26,
      signalLineLength: 9,
      adxThreshold: 25,
      adxSmoothing: 14,
      trailingStopPercent: 3.0,
      volumeConfirmThreshold: 1.2,
      useMultipleTimeframes: false,
    };
    this.state = {
      status: 'stopped',
      positions: [],
      totalTrades: 0,
      winRate: 0,
      totalPnl: 0,
      maxDrawdown: 0,
    };
    this.signals = [];
    this.priceHistory = [];
    this.macdHistory = [];
    this.adxHistory = [];
    this.highestPrice = 0;
    this.lowestPrice = Infinity;
  }

  async onMarketData(data: MarketData): Promise<BotEngineResult> {
    if (!this.kronConfig || this.state.status !== 'running') {
      return { success: false, error: 'Bot not running or not configured' };
    }

    this.addPriceData(data);

    // Update highest/lowest for trailing stop
    if (data.high > this.highestPrice) this.highestPrice = data.high;
    if (data.low < this.lowestPrice) this.lowestPrice = data.low;

    const indicators = this.calculateIndicators();
    this.updateTrendState(indicators);

    const signal = this.generateSignals(indicators);

    if (signal) {
      const riskCheck = this.validateSignal(signal);
      if (!riskCheck.allowed) {
        return { success: false, error: riskCheck.reason };
      }
      if (riskCheck.adjustedQuantity) {
        signal.quantity = riskCheck.adjustedQuantity;
      }
      this.addSignal(signal);
      return { success: true, signal, metadata: { indicators, trendState: this.trendState } };
    }

    return { success: true, metadata: { indicators, trendState: this.trendState } };
  }

  protected calculateIndicators(): IndicatorValues {
    if (!this.kronConfig || this.priceHistory.length < this.kronConfig.maSlowLength) {
      return {};
    }

    const closes = this.priceHistory.map(d => d.close);
    const highs = this.priceHistory.map(d => d.high);
    const lows = this.priceHistory.map(d => d.low);
    const volumes = this.priceHistory.map(d => d.volume);
    const currentPrice = closes[closes.length - 1];

    // Calculate EMAs
    this.emaFast = this.calculateEMA(closes, this.kronConfig.maFastLength);
    this.emaSlow = this.calculateEMA(closes, this.kronConfig.maSlowLength);

    // Calculate MACD
    const macdResult = this.calculateMACDFull(
      closes,
      this.kronConfig.maFastLength,
      this.kronConfig.maSlowLength,
      this.kronConfig.signalLineLength
    );
    this.macdHistory.push(macdResult);
    if (this.macdHistory.length > 50) this.macdHistory.shift();

    // Calculate ADX
    const adx = this.calculateADXFull(
      highs,
      lows,
      closes,
      this.kronConfig.adxSmoothing
    );
    this.adxHistory.push(adx);
    if (this.adxHistory.length > 50) this.adxHistory.shift();

    // +DI and -DI
    const { plusDI, minusDI } = this.calculateDI(highs, lows, closes, this.kronConfig.adxSmoothing);

    // Volume analysis
    const avgVolume = this.calculateSMA(volumes, 20);
    const volumeRatio = avgVolume > 0 ? volumes[volumes.length - 1] / avgVolume : 1;

    // ATR for stop loss
    const atr = this.calculateATR(highs, lows, closes, 14);

    // Trend strength (combination of ADX and MA alignment)
    const maAlignment = this.emaFast > this.emaSlow ? 1 : this.emaFast < this.emaSlow ? -1 : 0;
    const trendStrength = Math.min(100, adx * (1 + Math.abs(maAlignment) * 0.3));

    // MACD histogram slope
    const histogramSlope = this.macdHistory.length >= 2
      ? macdResult.histogram - this.macdHistory[this.macdHistory.length - 2].histogram
      : 0;

    // Price momentum
    const momentum = closes.length > 1 
      ? ((currentPrice - closes[closes.length - 2]) / closes[closes.length - 2]) * 100
      : 0;

    // RSI for overbought/oversold check
    const rsi = this.calculateRSI(closes, 14);

    return {
      currentPrice,
      emaFast: this.emaFast,
      emaSlow: this.emaSlow,
      macd: macdResult.macd,
      macdSignal: macdResult.signal,
      macdHistogram: macdResult.histogram,
      histogramSlope,
      adx,
      plusDI,
      minusDI,
      trendStrength,
      volumeRatio,
      atr,
      momentum,
      rsi,
      maSpread: ((this.emaFast - this.emaSlow) / this.emaSlow) * 100,
      highestPrice: this.highestPrice,
      lowestPrice: this.lowestPrice,
    };
  }

  protected generateSignals(indicators: IndicatorValues): Signal | null {
    if (!this.kronConfig || this.priceHistory.length < this.kronConfig.maSlowLength + 5) {
      return null;
    }

    const currentPrice = indicators.currentPrice as number;
    const emaFast = indicators.emaFast as number;
    const emaSlow = indicators.emaSlow as number;
    const macd = indicators.macd as number;
    const macdSignal = indicators.macdSignal as number;
    const histogram = indicators.macdHistogram as number;
    const histogramSlope = indicators.histogramSlope as number;
    const adx = indicators.adx as number;
    const plusDI = indicators.plusDI as number;
    const minusDI = indicators.minusDI as number;
    const volumeRatio = indicators.volumeRatio as number;
    const atr = indicators.atr as number;
    const rsi = indicators.rsi as number;
    const symbol = this.priceHistory[this.priceHistory.length - 1].symbol;

    const prevMacd = this.macdHistory.length > 1 ? this.macdHistory[this.macdHistory.length - 2] : null;

    // ENTRY SIGNALS

    // TREND FOLLOWING LONG
    // Conditions: EMA crossover up, ADX above threshold, MACD bullish, volume confirmation
    if (
      emaFast > emaSlow && // Fast MA above slow MA
      adx > this.kronConfig.adxThreshold && // Strong trend
      plusDI > minusDI && // Positive direction
      histogram > 0 && // MACD bullish
      histogramSlope > 0 && // Histogram rising
      volumeRatio >= this.kronConfig.volumeConfirmThreshold && // Volume confirmation
      rsi < 80 // Not overbought
    ) {
      // Check if this is a new trend (MA crossover recently occurred)
      const isNewTrend = this.trendState.duration < 5;
      const confidence = this.calculateTrendConfidence(adx, histogramSlope, volumeRatio, isNewTrend);

      this.entryPrice = currentPrice;
      this.highestPrice = currentPrice;

      return {
        id: `KRON-${Date.now()}-LONG`,
        symbol,
        direction: 'LONG',
        type: 'ENTRY',
        price: currentPrice,
        quantity: this.calculatePositionSize(currentPrice, atr),
        confidence,
        reason: `Trend following LONG: EMA crossover up, ADX=${adx.toFixed(1)}, MACD hist=${histogram.toFixed(4)}, Vol ratio=${volumeRatio.toFixed(2)}x`,
        timestamp: new Date(),
        metadata: {
          strategy: 'TREND_FOLLOWING',
          emaFast,
          emaSlow,
          adx,
          macd,
          macdSignal,
          histogram,
          trendDuration: this.trendState.duration,
          stopLoss: currentPrice - atr * 2,
          takeProfit: currentPrice + atr * 4,
        },
      };
    }

    // TREND FOLLOWING SHORT
    // Conditions: EMA crossover down, ADX above threshold, MACD bearish, volume confirmation
    if (
      emaFast < emaSlow && // Fast MA below slow MA
      adx > this.kronConfig.adxThreshold && // Strong trend
      minusDI > plusDI && // Negative direction
      histogram < 0 && // MACD bearish
      histogramSlope < 0 && // Histogram falling
      volumeRatio >= this.kronConfig.volumeConfirmThreshold && // Volume confirmation
      rsi > 20 // Not oversold
    ) {
      const isNewTrend = this.trendState.duration < 5;
      const confidence = this.calculateTrendConfidence(adx, Math.abs(histogramSlope), volumeRatio, isNewTrend);

      this.entryPrice = currentPrice;
      this.lowestPrice = currentPrice;

      return {
        id: `KRON-${Date.now()}-SHORT`,
        symbol,
        direction: 'SHORT',
        type: 'ENTRY',
        price: currentPrice,
        quantity: this.calculatePositionSize(currentPrice, atr),
        confidence,
        reason: `Trend following SHORT: EMA crossover down, ADX=${adx.toFixed(1)}, MACD hist=${histogram.toFixed(4)}, Vol ratio=${volumeRatio.toFixed(2)}x`,
        timestamp: new Date(),
        metadata: {
          strategy: 'TREND_FOLLOWING',
          emaFast,
          emaSlow,
          adx,
          macd,
          macdSignal,
          histogram,
          trendDuration: this.trendState.duration,
          stopLoss: currentPrice + atr * 2,
          takeProfit: currentPrice - atr * 4,
        },
      };
    }

    // EXIT SIGNALS - Trailing Stop Logic
    const existingPositions = this.state.positions.filter(p => p.symbol === symbol);
    
    for (const position of existingPositions) {
      // LONG position trailing stop
      if (position.direction === 'LONG' && this.entryPrice) {
        const trailingStop = this.highestPrice * (1 - this.kronConfig.trailingStopPercent / 100);
        
        if (currentPrice < trailingStop) {
          return {
            id: `KRON-${Date.now()}-EXIT-LONG-${position.id}`,
            symbol,
            direction: 'SHORT',
            type: 'EXIT',
            price: currentPrice,
            quantity: position.size,
            confidence: 0.85,
            reason: `Trailing stop triggered at ${trailingStop.toFixed(2)} (${this.kronConfig.trailingStopPercent}% below high ${this.highestPrice.toFixed(2)})`,
            timestamp: new Date(),
            metadata: {
              strategy: 'TRAILING_STOP',
              positionId: position.id,
              entryPrice: this.entryPrice,
              highestPrice: this.highestPrice,
              trailingStop,
            },
          };
        }

        // Exit on trend reversal
        if (
          emaFast < emaSlow &&
          histogram < 0 &&
          this.macdHistory.length > 2 &&
          this.macdHistory[this.macdHistory.length - 2].histogram > 0
        ) {
          return {
            id: `KRON-${Date.now()}-REVERSAL-EXIT-${position.id}`,
            symbol,
            direction: 'SHORT',
            type: 'EXIT',
            price: currentPrice,
            quantity: position.size,
            confidence: 0.8,
            reason: `Trend reversal detected: EMA crossover down, MACD histogram turned negative`,
            timestamp: new Date(),
            metadata: { strategy: 'TREND_REVERSAL', positionId: position.id },
          };
        }
      }

      // SHORT position trailing stop
      if (position.direction === 'SHORT' && this.entryPrice) {
        const trailingStop = this.lowestPrice * (1 + this.kronConfig.trailingStopPercent / 100);
        
        if (currentPrice > trailingStop) {
          return {
            id: `KRON-${Date.now()}-EXIT-SHORT-${position.id}`,
            symbol,
            direction: 'LONG',
            type: 'EXIT',
            price: currentPrice,
            quantity: position.size,
            confidence: 0.85,
            reason: `Trailing stop triggered at ${trailingStop.toFixed(2)} (${this.kronConfig.trailingStopPercent}% above low ${this.lowestPrice.toFixed(2)})`,
            timestamp: new Date(),
            metadata: {
              strategy: 'TRAILING_STOP',
              positionId: position.id,
              entryPrice: this.entryPrice,
              lowestPrice: this.lowestPrice,
              trailingStop,
            },
          };
        }

        // Exit on trend reversal
        if (
          emaFast > emaSlow &&
          histogram > 0 &&
          this.macdHistory.length > 2 &&
          this.macdHistory[this.macdHistory.length - 2].histogram < 0
        ) {
          return {
            id: `KRON-${Date.now()}-REVERSAL-EXIT-${position.id}`,
            symbol,
            direction: 'LONG',
            type: 'EXIT',
            price: currentPrice,
            quantity: position.size,
            confidence: 0.8,
            reason: `Trend reversal detected: EMA crossover up, MACD histogram turned positive`,
            timestamp: new Date(),
            metadata: { strategy: 'TREND_REVERSAL', positionId: position.id },
          };
        }
      }
    }

    return null;
  }

  protected validateSignal(signal: Signal): RiskCheckResult {
    if (!this.kronConfig) {
      return { allowed: false, reason: 'Bot not configured' };
    }

    // Position size check
    const maxSize = this.kronConfig.maxPositionSize;
    if (signal.quantity > maxSize) {
      return { allowed: true, adjustedQuantity: maxSize };
    }

    // Entry signal checks
    if (signal.type === 'ENTRY') {
      // Check existing positions
      const sameSymbolPositions = this.state.positions.filter(p => p.symbol === signal.symbol);
      if (sameSymbolPositions.length >= 1) {
        return { allowed: false, reason: 'Position already exists for this symbol' };
      }

      // Minimum confidence
      if (signal.confidence < 0.5) {
        return { allowed: false, reason: 'Signal confidence below threshold' };
      }
    }

    return { allowed: true };
  }

  private updateTrendState(indicators: IndicatorValues): void {
    const emaFast = indicators.emaFast as number;
    const emaSlow = indicators.emaSlow as number;
    const adx = indicators.adx as number;

    let newDirection: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS';

    if (adx >= this.kronConfig!.adxThreshold) {
      newDirection = emaFast > emaSlow ? 'UPTREND' : 'DOWNTREND';
    } else {
      newDirection = 'SIDEWAYS';
    }

    if (newDirection !== this.trendState.direction) {
      this.trendState = {
        direction: newDirection,
        strength: indicators.trendStrength as number,
        duration: 0,
        startedAt: new Date(),
      };
    } else {
      this.trendState.duration++;
      this.trendState.strength = indicators.trendStrength as number;
    }
  }

  private calculateMACDFull(
    prices: number[],
    fastPeriod: number,
    slowPeriod: number,
    signalPeriod: number
  ): { macd: number; signal: number; histogram: number } {
    const emaFast = this.calculateEMA(prices, fastPeriod);
    const emaSlow = this.calculateEMA(prices, slowPeriod);
    const macd = emaFast - emaSlow;

    // Calculate signal line (EMA of MACD)
    const signal = this.macdHistory.length > 0
      ? this.calculateEMA([...this.macdHistory.map(m => m.macd), macd], signalPeriod)
      : macd;

    const histogram = macd - signal;

    return { macd, signal, histogram };
  }

  private calculateADXFull(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number
  ): number {
    return this.calculateADX(highs, lows, closes, period);
  }

  private calculateDI(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number
  ): { plusDI: number; minusDI: number } {
    if (highs.length < period + 1) {
      return { plusDI: 25, minusDI: 25 };
    }

    let plusDM = 0;
    let minusDM = 0;
    let tr = 0;

    for (let i = highs.length - period; i < highs.length; i++) {
      const upMove = highs[i] - highs[i - 1];
      const downMove = lows[i - 1] - lows[i];

      plusDM += upMove > downMove && upMove > 0 ? upMove : 0;
      minusDM += downMove > upMove && downMove > 0 ? downMove : 0;
      tr += Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
    }

    const plusDI = tr > 0 ? (plusDM / tr) * 100 : 25;
    const minusDI = tr > 0 ? (minusDM / tr) * 100 : 25;

    return { plusDI, minusDI };
  }

  private calculatePositionSize(price: number, atr: number): number {
    if (!this.kronConfig) return 0;

    // ATR-based position sizing
    const riskPercent = 0.02;
    const riskAmount = this.kronConfig.maxPositionSize * riskPercent;
    const stopLossDistance = atr * 2;

    if (stopLossDistance <= 0) return this.kronConfig.maxPositionSize * 0.1;

    return Math.min(riskAmount / stopLossDistance, this.kronConfig.maxPositionSize);
  }

  private calculateTrendConfidence(
    adx: number,
    histogramSlope: number,
    volumeRatio: number,
    isNewTrend: boolean
  ): number {
    let confidence = 0.5;

    // ADX contribution (higher ADX = stronger trend)
    if (adx > 40) confidence += 0.2;
    else if (adx > 30) confidence += 0.15;
    else if (adx > 25) confidence += 0.1;

    // Histogram momentum
    confidence += Math.min(0.15, Math.abs(histogramSlope) * 10);

    // Volume confirmation
    if (volumeRatio > 2) confidence += 0.1;
    else if (volumeRatio > 1.5) confidence += 0.05;

    // New trend bonus
    if (isNewTrend) confidence += 0.05;

    return Math.min(0.95, confidence);
  }

  // Get trend state
  getTrendState(): TrendState {
    return { ...this.trendState };
  }

  // Get MACD history
  getMACDHistory(): Array<{ macd: number; signal: number; histogram: number }> {
    return [...this.macdHistory];
  }

  // Get ADX history
  getADXHistory(): number[] {
    return [...this.adxHistory];
  }

  updateKronConfig(updates: Partial<KronConfig>): void {
    if (this.kronConfig) {
      this.kronConfig = { ...this.kronConfig, ...updates };
    }
  }

  // Reset tracking values
  resetTracking(): void {
    this.highestPrice = 0;
    this.lowestPrice = Infinity;
    this.entryPrice = null;
  }
}

// Export singleton factory
let kronEngineInstance: KronEngine | null = null;

export function getKronEngine(): KronEngine {
  if (!kronEngineInstance) {
    kronEngineInstance = new KronEngine();
  }
  return kronEngineInstance;
}
