/**
 * EquilibristBot Engine - Mean Reversion Bot
 * 
 * Strategy: Mean Reversion with KAMA (Kaufman's Adaptive Moving Average)
 * Algorithm: Identifies overbought/oversold conditions and trades price returning to mean
 * 
 * Key Features:
 * - KAMA for adaptive trend detection
 * - RSI divergence detection
 * - Bollinger Band position for entry timing
 * - Dynamic stop-loss based on ATR
 */

import { BaseBotEngine, BotConfig, MarketData, Signal, IndicatorValues, RiskCheckResult, BotEngineResult } from './types';

export interface EquilibristConfig extends BotConfig {
  lookbackPeriod: number;
  thresholdPercent: number; // Deviation from mean threshold (%)
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  kamaFast: number; // Fast EMA period for KAMA
  kamaSlow: number; // Slow EMA period for KAMA
  atrMultiplier: number; // ATR multiplier for stop loss
  useDivergence: boolean; // Use RSI divergence
}

export class EquilibristEngine extends BaseBotEngine {
  readonly botType = 'MR' as const;
  
  private equilibristConfig: EquilibristConfig | null = null;
  private kamaValue: number = 0;
  private prevKama: number = 0;
  private rsiHistory: number[] = [];
  private priceHistoryForKama: number[] = [];
  private divergenceDetected: 'bullish' | 'bearish' | null = null;

  async initialize(config: BotConfig): Promise<void> {
    this.config = config;
    this.equilibristConfig = {
      ...config,
      lookbackPeriod: 14,
      thresholdPercent: 5.0,
      rsiPeriod: 14,
      rsiOverbought: 70,
      rsiOversold: 30,
      kamaFast: 2,
      kamaSlow: 30,
      atrMultiplier: 2.0,
      useDivergence: true,
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
    this.rsiHistory = [];
    this.priceHistoryForKama = [];
  }

  async onMarketData(data: MarketData): Promise<BotEngineResult> {
    if (!this.equilibristConfig || this.state.status !== 'running') {
      return { success: false, error: 'Bot not running or not configured' };
    }

    this.addPriceData(data);
    this.priceHistoryForKama.push(data.close);
    
    // Keep KAMA history bounded
    if (this.priceHistoryForKama.length > 100) {
      this.priceHistoryForKama.shift();
    }

    const indicators = this.calculateIndicators();
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
      return { success: true, signal, metadata: { indicators } };
    }

    return { success: true, metadata: { indicators } };
  }

  protected calculateIndicators(): IndicatorValues {
    if (!this.equilibristConfig || this.priceHistory.length < 2) {
      return {};
    }

    const closes = this.priceHistory.map(d => d.close);
    const highs = this.priceHistory.map(d => d.high);
    const lows = this.priceHistory.map(d => d.low);
    const currentPrice = closes[closes.length - 1];

    // Calculate KAMA (Kaufman's Adaptive Moving Average)
    this.prevKama = this.kamaValue;
    this.kamaValue = this.calculateKAMA(
      this.priceHistoryForKama,
      this.equilibristConfig.lookbackPeriod,
      this.equilibristConfig.kamaFast,
      this.equilibristConfig.kamaSlow
    );

    // Calculate RSI
    const rsi = this.calculateRSI(closes, this.equilibristConfig.rsiPeriod);
    this.rsiHistory.push(rsi);
    if (this.rsiHistory.length > 50) {
      this.rsiHistory.shift();
    }

    // Detect RSI divergence
    this.divergenceDetected = this.detectDivergence(closes, this.rsiHistory);

    // Bollinger Bands
    const bollinger = this.calculateBollingerBands(
      closes,
      this.equilibristConfig.lookbackPeriod,
      2
    );

    // ATR for stop loss
    const atr = this.calculateATR(highs, lows, closes, 14);

    // Distance from KAMA (mean)
    const kamaDistance = currentPrice - this.kamaValue;
    const kamaDistancePercent = this.kamaValue > 0 
      ? (kamaDistance / this.kamaValue) * 100 
      : 0;

    // Z-score of price relative to recent prices
    const recentCloses = closes.slice(-this.equilibristConfig.lookbackPeriod);
    const mean = recentCloses.reduce((a, b) => a + b, 0) / recentCloses.length;
    const std = Math.sqrt(
      recentCloses.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / recentCloses.length
    );
    const zScore = std > 0 ? (currentPrice - mean) / std : 0;

    // Bollinger Band position (0-1)
    const bbPosition = bollinger.bandwidth > 0 
      ? (currentPrice - bollinger.lower) / (bollinger.upper - bollinger.lower)
      : 0.5;

    // Volatility ratio
    const volatilityRatio = bollinger.bandwidth;

    return {
      currentPrice,
      kama: this.kamaValue,
      prevKama: this.prevKama,
      kamaDistance,
      kamaDistancePercent,
      rsi,
      bollingerUpper: bollinger.upper,
      bollingerMiddle: bollinger.middle,
      bollingerLower: bollinger.lower,
      bollingerBandwidth: bollinger.bandwidth,
      bbPosition,
      atr,
      zScore,
      volatilityRatio,
      divergence: this.divergenceDetected,
      meanPrice: mean,
      stdDev: std,
    };
  }

  protected generateSignals(indicators: IndicatorValues): Signal | null {
    if (!this.equilibristConfig || this.priceHistory.length < this.equilibristConfig.lookbackPeriod) {
      return null;
    }

    const currentPrice = indicators.currentPrice as number;
    const kama = indicators.kama as number;
    const kamaDistancePercent = indicators.kamaDistancePercent as number;
    const rsi = indicators.rsi as number;
    const bbPosition = indicators.bbPosition as number;
    const atr = indicators.atr as number;
    const zScore = indicators.zScore as number;
    const divergence = indicators.divergence as string | null;
    const symbol = this.priceHistory[this.priceHistory.length - 1].symbol;

    // ENTRY SIGNALS
    
    // MEAN REVERSION LONG: Price significantly below KAMA + oversold RSI
    if (
      kamaDistancePercent < -this.equilibristConfig.thresholdPercent &&
      rsi < this.equilibristConfig.rsiOversold &&
      bbPosition < 0.2 &&
      zScore < -1.5
    ) {
      const stopLoss = currentPrice - atr * this.equilibristConfig.atrMultiplier;
      const takeProfit = kama; // Target is the KAMA (mean)
      
      return {
        id: `EQ-${Date.now()}-LONG`,
        symbol,
        direction: 'LONG',
        type: 'ENTRY',
        price: currentPrice,
        quantity: this.calculatePositionSize(currentPrice, atr),
        confidence: this.calculateConfidence(kamaDistancePercent, rsi, divergence),
        reason: `Mean reversion LONG: Price ${(kamaDistancePercent * -1).toFixed(1)}% below KAMA, RSI ${rsi.toFixed(0)} oversold, Z-score ${zScore.toFixed(2)}`,
        timestamp: new Date(),
        metadata: {
          strategy: 'MEAN_REVERSION',
          kama,
          rsi,
          zScore,
          stopLoss,
          takeProfit,
          divergence,
        },
      };
    }

    // MEAN REVERSION SHORT: Price significantly above KAMA + overbought RSI
    if (
      kamaDistancePercent > this.equilibristConfig.thresholdPercent &&
      rsi > this.equilibristConfig.rsiOverbought &&
      bbPosition > 0.8 &&
      zScore > 1.5
    ) {
      const stopLoss = currentPrice + atr * this.equilibristConfig.atrMultiplier;
      const takeProfit = kama;
      
      return {
        id: `EQ-${Date.now()}-SHORT`,
        symbol,
        direction: 'SHORT',
        type: 'ENTRY',
        price: currentPrice,
        quantity: this.calculatePositionSize(currentPrice, atr),
        confidence: this.calculateConfidence(kamaDistancePercent, rsi, divergence),
        reason: `Mean reversion SHORT: Price ${kamaDistancePercent.toFixed(1)}% above KAMA, RSI ${rsi.toFixed(0)} overbought, Z-score ${zScore.toFixed(2)}`,
        timestamp: new Date(),
        metadata: {
          strategy: 'MEAN_REVERSION',
          kama,
          rsi,
          zScore,
          stopLoss,
          takeProfit,
          divergence,
        },
      };
    }

    // DIVERGENCE SIGNALS (if enabled)
    if (this.equilibristConfig.useDivergence && divergence) {
      // Bullish divergence: Price making lower lows, RSI making higher lows
      if (divergence === 'bullish' && rsi < 50) {
        return {
          id: `EQ-${Date.now()}-DIV-LONG`,
          symbol,
          direction: 'LONG',
          type: 'ENTRY',
          price: currentPrice,
          quantity: this.calculatePositionSize(currentPrice, atr),
          confidence: 0.75,
          reason: `Bullish RSI divergence detected at price ${currentPrice.toFixed(2)}`,
          timestamp: new Date(),
          metadata: {
            strategy: 'RSI_DIVERGENCE',
            divergence,
            rsi,
          },
        };
      }
      
      // Bearish divergence: Price making higher highs, RSI making lower highs
      if (divergence === 'bearish' && rsi > 50) {
        return {
          id: `EQ-${Date.now()}-DIV-SHORT`,
          symbol,
          direction: 'SHORT',
          type: 'ENTRY',
          price: currentPrice,
          quantity: this.calculatePositionSize(currentPrice, atr),
          confidence: 0.75,
          reason: `Bearish RSI divergence detected at price ${currentPrice.toFixed(2)}`,
          timestamp: new Date(),
          metadata: {
            strategy: 'RSI_DIVERGENCE',
            divergence,
            rsi,
          },
        };
      }
    }

    // EXIT SIGNALS for existing positions
    const existingPositions = this.state.positions.filter(p => p.symbol === symbol);
    for (const position of existingPositions) {
      // Exit when price returns to KAMA (mean)
      if (Math.abs(kamaDistancePercent) < 0.5) {
        return {
          id: `EQ-${Date.now()}-EXIT-${position.id}`,
          symbol,
          direction: position.direction === 'LONG' ? 'SHORT' : 'LONG',
          type: 'EXIT',
          price: currentPrice,
          quantity: position.size,
          confidence: 0.8,
          reason: `Mean reversion complete: Price returned to KAMA (${kama.toFixed(2)})`,
          timestamp: new Date(),
          metadata: {
            strategy: 'MEAN_REVERSION_EXIT',
            positionId: position.id,
            kama,
          },
        };
      }

      // Exit on RSI neutralization
      if (position.direction === 'LONG' && rsi > 55) {
        return {
          id: `EQ-${Date.now()}-RSI-EXIT-${position.id}`,
          symbol,
          direction: 'SHORT',
          type: 'EXIT',
          price: currentPrice,
          quantity: position.size,
          confidence: 0.7,
          reason: `RSI neutralized: ${rsi.toFixed(0)} > 55`,
          timestamp: new Date(),
          metadata: { strategy: 'RSI_EXIT', positionId: position.id },
        };
      }
      
      if (position.direction === 'SHORT' && rsi < 45) {
        return {
          id: `EQ-${Date.now()}-RSI-EXIT-${position.id}`,
          symbol,
          direction: 'LONG',
          type: 'EXIT',
          price: currentPrice,
          quantity: position.size,
          confidence: 0.7,
          reason: `RSI neutralized: ${rsi.toFixed(0)} < 45`,
          timestamp: new Date(),
          metadata: { strategy: 'RSI_EXIT', positionId: position.id },
        };
      }
    }

    return null;
  }

  protected validateSignal(signal: Signal): RiskCheckResult {
    if (!this.equilibristConfig) {
      return { allowed: false, reason: 'Bot not configured' };
    }

    // Check position size
    const maxSize = this.equilibristConfig.maxPositionSize;
    if (signal.quantity > maxSize) {
      return { allowed: true, adjustedQuantity: maxSize };
    }

    // Check existing positions
    const existingPositions = this.state.positions.filter(p => p.symbol === signal.symbol);
    if (signal.type === 'ENTRY' && existingPositions.length >= 1) {
      return { allowed: false, reason: 'Position already exists for this symbol' };
    }

    // Minimum confidence
    if (signal.confidence < 0.5) {
      return { allowed: false, reason: 'Signal confidence below threshold' };
    }

    return { allowed: true };
  }

  private calculateKAMA(prices: number[], period: number, fast: number, fastPeriod: number, slowPeriod?: number): number {
    if (prices.length < period + 1) {
      return prices[prices.length - 1] || 0;
    }

    const slow = slowPeriod || 30;
    const fastSC = 2 / (fastPeriod + 1);
    const slowSC = 2 / (slow + 1);

    // Calculate Efficiency Ratio (ER)
    let change = Math.abs(prices[prices.length - 1] - prices[prices.length - period - 1]);
    let volatility = 0;
    
    for (let i = prices.length - period; i < prices.length; i++) {
      volatility += Math.abs(prices[i] - prices[i - 1]);
    }

    const er = volatility > 0 ? change / volatility : 0;

    // Calculate Smoothing Constant (SC)
    const sc = er * (fastSC - slowSC) + slowSC;

    // Calculate KAMA
    const prevKama = prices[prices.length - period - 1];
    return prevKama + sc * (prices[prices.length - 1] - prevKama);
  }

  private detectDivergence(prices: number[], rsiHistory: number[]): 'bullish' | 'bearish' | null {
    if (prices.length < 10 || rsiHistory.length < 10) return null;

    const lookback = 10;
    const recentPrices = prices.slice(-lookback);
    const recentRsi = rsiHistory.slice(-lookback);

    // Find price lows and RSI lows for bullish divergence
    const priceMinIdx = recentPrices.indexOf(Math.min(...recentPrices));
    const rsiAtPriceMin = recentRsi[priceMinIdx];
    const currentRsi = recentRsi[recentRsi.length - 1];

    // Bullish divergence: price makes lower low, RSI makes higher low
    if (
      priceMinIdx < lookback - 3 && // Price low was before the most recent bars
      recentPrices[recentPrices.length - 1] < recentPrices[priceMinIdx] && // Lower price
      currentRsi > rsiAtPriceMin // Higher RSI
    ) {
      return 'bullish';
    }

    // Find price highs and RSI highs for bearish divergence
    const priceMaxIdx = recentPrices.indexOf(Math.max(...recentPrices));
    const rsiAtPriceMax = recentRsi[priceMaxIdx];

    // Bearish divergence: price makes higher high, RSI makes lower high
    if (
      priceMaxIdx < lookback - 3 &&
      recentPrices[recentPrices.length - 1] > recentPrices[priceMaxIdx] && // Higher price
      currentRsi < rsiAtPriceMax // Lower RSI
    ) {
      return 'bearish';
    }

    return null;
  }

  private calculatePositionSize(price: number, atr: number): number {
    if (!this.equilibristConfig) return 0;

    // Risk-based position sizing using ATR
    const riskPercent = 0.02; // 2% risk per trade
    const riskAmount = this.equilibristConfig.maxPositionSize * riskPercent;
    const stopLossDistance = atr * this.equilibristConfig.atrMultiplier;
    
    if (stopLossDistance <= 0) return this.equilibristConfig.maxPositionSize * 0.1;
    
    const positionSize = riskAmount / stopLossDistance;
    return Math.min(positionSize, this.equilibristConfig.maxPositionSize);
  }

  private calculateConfidence(distancePercent: number, rsi: number, divergence: string | null): number {
    let confidence = 0.5;

    // Distance from mean contributes to confidence
    confidence += Math.min(0.2, Math.abs(distancePercent) / 20);

    // RSI extremity contributes
    if (rsi < 30 || rsi > 70) {
      confidence += 0.15;
    }

    // Divergence adds confidence
    if (divergence) {
      confidence += 0.1;
    }

    return Math.min(0.95, confidence);
  }

  // Get current KAMA value
  getKAMA(): number {
    return this.kamaValue;
  }

  // Get RSI history
  getRSIHistory(): number[] {
    return [...this.rsiHistory];
  }

  updateEquilibristConfig(updates: Partial<EquilibristConfig>): void {
    if (this.equilibristConfig) {
      this.equilibristConfig = { ...this.equilibristConfig, ...updates };
    }
  }
}

// Export singleton factory
let equilibristEngineInstance: EquilibristEngine | null = null;

export function getEquilibristEngine(): EquilibristEngine {
  if (!equilibristEngineInstance) {
    equilibristEngineInstance = new EquilibristEngine();
  }
  return equilibristEngineInstance;
}
