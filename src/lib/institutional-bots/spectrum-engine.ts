/**
 * SpectrumBot Engine - Price Range/Pattern Recognition Bot
 * 
 * Strategy: Pairs Trading with Cointegration Analysis
 * Algorithm: Identifies price ranges and statistical arbitrage opportunities
 * 
 * Key Features:
 * - Price range detection using standard deviation bands
 * - Mean reversion within identified ranges
 * - Breakout detection with volume confirmation
 * - Multi-timeframe analysis
 */

import { BaseBotEngine, BotConfig, MarketData, Signal, IndicatorValues, RiskCheckResult, BotEngineResult } from './types';

export interface SpectrumConfig extends BotConfig {
  lookbackPeriod: number;
  rangeDeviation: number; // Standard deviations for range bounds
  breakoutThreshold: number; // Percentage above/below range for breakout
  volumeThreshold: number; // Volume multiple for confirmation
  meanReversionEnabled: boolean;
  breakoutEnabled: boolean;
}

export class SpectrumEngine extends BaseBotEngine {
  readonly botType = 'SPECTRUM' as const;
  
  private spectrumConfig: SpectrumConfig | null = null;
  private priceRanges: Map<string, { upper: number; lower: number; middle: number }> = new Map();
  private volumeProfile: number[] = [];
  private breakoutSignals: Map<string, boolean> = new Map();

  async initialize(config: BotConfig): Promise<void> {
    this.config = config;
    this.spectrumConfig = {
      ...config,
      lookbackPeriod: 20,
      rangeDeviation: 2.0,
      breakoutThreshold: 0.02,
      volumeThreshold: 1.5,
      meanReversionEnabled: true,
      breakoutEnabled: true,
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
  }

  async onMarketData(data: MarketData): Promise<BotEngineResult> {
    if (!this.spectrumConfig || this.state.status !== 'running') {
      return { success: false, error: 'Bot not running or not configured' };
    }

    this.addPriceData(data);
    this.volumeProfile.push(data.volume);
    
    // Keep volume profile bounded
    if (this.volumeProfile.length > this.spectrumConfig.lookbackPeriod) {
      this.volumeProfile.shift();
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
    if (!this.spectrumConfig || this.priceHistory.length < 2) {
      return {};
    }

    const closes = this.priceHistory.map(d => d.close);
    const highs = this.priceHistory.map(d => d.high);
    const lows = this.priceHistory.map(d => d.low);
    const volumes = this.priceHistory.map(d => d.volume);
    const currentPrice = closes[closes.length - 1];

    // Price Range Calculation using Bollinger Bands
    const bollinger = this.calculateBollingerBands(
      closes,
      this.spectrumConfig.lookbackPeriod,
      this.spectrumConfig.rangeDeviation
    );

    // Store current range
    const symbol = this.priceHistory[this.priceHistory.length - 1].symbol;
    this.priceRanges.set(symbol, {
      upper: bollinger.upper,
      lower: bollinger.lower,
      middle: bollinger.middle,
    });

    // Average Volume for confirmation
    const avgVolume = this.calculateSMA(volumes, this.spectrumConfig.lookbackPeriod);
    const currentVolume = volumes[volumes.length - 1];
    const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

    // RSI for additional confirmation
    const rsi = this.calculateRSI(closes, 14);

    // ATR for volatility-based position sizing
    const atr = this.calculateATR(highs, lows, closes, 14);

    // Range position (0-1, where 0.5 is middle of range)
    const rangePosition = bollinger.bandwidth > 0 
      ? (currentPrice - bollinger.lower) / (bollinger.upper - bollinger.lower)
      : 0.5;

    // Distance from range bounds (percentage)
    const distanceFromUpper = (bollinger.upper - currentPrice) / currentPrice * 100;
    const distanceFromLower = (currentPrice - bollinger.lower) / currentPrice * 100;

    return {
      bollingerUpper: bollinger.upper,
      bollingerMiddle: bollinger.middle,
      bollingerLower: bollinger.lower,
      bollingerBandwidth: bollinger.bandwidth,
      currentPrice,
      rsi,
      atr,
      avgVolume,
      currentVolume,
      volumeRatio,
      rangePosition,
      distanceFromUpper,
      distanceFromLower,
    };
  }

  protected generateSignals(indicators: IndicatorValues): Signal | null {
    if (!this.spectrumConfig || this.priceHistory.length < this.spectrumConfig.lookbackPeriod) {
      return null;
    }

    const currentPrice = indicators.currentPrice as number;
    const rsi = indicators.rsi as number;
    const volumeRatio = indicators.volumeRatio as number;
    const rangePosition = indicators.rangePosition as number;
    const symbol = this.priceHistory[this.priceHistory.length - 1].symbol;
    const range = this.priceRanges.get(symbol);

    if (!range) return null;

    // MEAN REVERSION SIGNAL
    if (this.spectrumConfig.meanReversionEnabled) {
      // Price near upper band + RSI overbought -> SHORT
      if (rangePosition > 0.9 && rsi > 70 && volumeRatio >= 1) {
        return {
          id: `SPECTRUM-${Date.now()}-SHORT`,
          symbol,
          direction: 'SHORT',
          type: 'ENTRY',
          price: currentPrice,
          quantity: this.calculatePositionSize(currentPrice),
          confidence: Math.min(0.9, (rangePosition - 0.9) * 10 + rsi / 100),
          reason: 'Mean reversion: Price at upper band, RSI overbought',
          timestamp: new Date(),
          metadata: { strategy: 'MEAN_REVERSION', rangePosition, rsi },
        };
      }

      // Price near lower band + RSI oversold -> LONG
      if (rangePosition < 0.1 && rsi < 30 && volumeRatio >= 1) {
        return {
          id: `SPECTRUM-${Date.now()}-LONG`,
          symbol,
          direction: 'LONG',
          type: 'ENTRY',
          price: currentPrice,
          quantity: this.calculatePositionSize(currentPrice),
          confidence: Math.min(0.9, (0.1 - rangePosition) * 10 + (100 - rsi) / 100),
          reason: 'Mean reversion: Price at lower band, RSI oversold',
          timestamp: new Date(),
          metadata: { strategy: 'MEAN_REVERSION', rangePosition, rsi },
        };
      }
    }

    // BREAKOUT SIGNAL
    if (this.spectrumConfig.breakoutEnabled && volumeRatio >= this.spectrumConfig.volumeThreshold) {
      // Breakout above upper band with volume
      if (currentPrice > range.upper * (1 + this.spectrumConfig.breakoutThreshold)) {
        const alreadySignaled = this.breakoutSignals.get(`${symbol}-UP`);
        if (!alreadySignaled) {
          this.breakoutSignals.set(`${symbol}-UP`, true);
          return {
            id: `SPECTRUM-${Date.now()}-BREAKUP`,
            symbol,
            direction: 'LONG',
            type: 'ENTRY',
            price: currentPrice,
            quantity: this.calculatePositionSize(currentPrice),
            confidence: Math.min(0.85, volumeRatio / 3),
            reason: 'Breakout: Price above upper band with high volume',
            timestamp: new Date(),
            metadata: { strategy: 'BREAKOUT', volumeRatio, breakLevel: range.upper },
          };
        }
      }
      // Breakout below lower band with volume
      else if (currentPrice < range.lower * (1 - this.spectrumConfig.breakoutThreshold)) {
        const alreadySignaled = this.breakoutSignals.get(`${symbol}-DOWN`);
        if (!alreadySignaled) {
          this.breakoutSignals.set(`${symbol}-DOWN`, true);
          return {
            id: `SPECTRUM-${Date.now()}-BREAKDOWN`,
            symbol,
            direction: 'SHORT',
            type: 'ENTRY',
            price: currentPrice,
            quantity: this.calculatePositionSize(currentPrice),
            confidence: Math.min(0.85, volumeRatio / 3),
            reason: 'Breakout: Price below lower band with high volume',
            timestamp: new Date(),
            metadata: { strategy: 'BREAKOUT', volumeRatio, breakLevel: range.lower },
          };
        }
      }
      // Reset breakout signals when price returns to range
      else if (currentPrice > range.lower && currentPrice < range.upper) {
        this.breakoutSignals.delete(`${symbol}-UP`);
        this.breakoutSignals.delete(`${symbol}-DOWN`);
      }
    }

    return null;
  }

  protected validateSignal(signal: Signal): RiskCheckResult {
    if (!this.spectrumConfig) {
      return { allowed: false, reason: 'Bot not configured' };
    }

    // Check position size against maximum
    const maxSize = this.spectrumConfig.maxPositionSize;
    if (signal.quantity > maxSize) {
      return { allowed: true, adjustedQuantity: maxSize };
    }

    // Check if we have existing positions
    const existingPositions = this.state.positions.filter(
      p => p.symbol === signal.symbol && p.direction === signal.direction
    );
    if (existingPositions.length >= 1) {
      return { allowed: false, reason: 'Maximum one position per direction per symbol' };
    }

    // Check confidence threshold
    if (signal.confidence < 0.5) {
      return { allowed: false, reason: 'Signal confidence below threshold' };
    }

    return { allowed: true };
  }

  private calculatePositionSize(price: number): number {
    if (!this.spectrumConfig) return 0;
    
    // Simple position sizing based on max position size and leverage
    const baseSize = this.spectrumConfig.maxPositionSize * this.spectrumConfig.leverage;
    return Math.min(baseSize, this.spectrumConfig.maxPositionSize);
  }

  // Update range configuration
  updateSpectrumConfig(updates: Partial<SpectrumConfig>): void {
    if (this.spectrumConfig) {
      this.spectrumConfig = { ...this.spectrumConfig, ...updates };
    }
  }

  // Get current price ranges
  getPriceRanges(): Map<string, { upper: number; lower: number; middle: number }> {
    return new Map(this.priceRanges);
  }
}

// Export singleton factory
let spectrumEngineInstance: SpectrumEngine | null = null;

export function getSpectrumEngine(): SpectrumEngine {
  if (!spectrumEngineInstance) {
    spectrumEngineInstance = new SpectrumEngine();
  }
  return spectrumEngineInstance;
}
