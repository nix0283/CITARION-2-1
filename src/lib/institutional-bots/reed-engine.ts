/**
 * ReedBot Engine - Stationary Algorithm Bot
 * 
 * Strategy: Statistical Arbitrage with PCA Analysis
 * Algorithm: Identifies stationary price series and mean reversion opportunities
 * 
 * Key Features:
 * - Statistical stationarity testing (ADF-like)
 * - Z-score based entry/exit signals
 * - Half-life calculation for optimal holding period
 * - PCA for multi-asset correlation
 */

import { BaseBotEngine, BotConfig, MarketData, Signal, IndicatorValues, RiskCheckResult, BotEngineResult } from './types';

export interface ReedConfig extends BotConfig {
  lookbackPeriod: number;
  deviationThreshold: number; // Z-score threshold for entry
  exitThreshold: number; // Z-score threshold for exit
  minHalfLife: number; // Minimum acceptable half-life (hours)
  maxHalfLife: number; // Maximum acceptable half-life (hours)
  usePCA: boolean; // Use PCA for multi-asset analysis
}

export class ReedEngine extends BaseBotEngine {
  readonly botType = 'STA' as const;
  
  private reedConfig: ReedConfig | null = null;
  private zScores: number[] = [];
  private halfLife: number | null = null;
  private spreadHistory: number[] = [];
  private meanValue: number = 0;
  private stdValue: number = 0;

  async initialize(config: BotConfig): Promise<void> {
    this.config = config;
    this.reedConfig = {
      ...config,
      lookbackPeriod: 20,
      deviationThreshold: 2.0,
      exitThreshold: 0.5,
      minHalfLife: 1,
      maxHalfLife: 48,
      usePCA: false,
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
    this.zScores = [];
    this.spreadHistory = [];
  }

  async onMarketData(data: MarketData): Promise<BotEngineResult> {
    if (!this.reedConfig || this.state.status !== 'running') {
      return { success: false, error: 'Bot not running or not configured' };
    }

    this.addPriceData(data);

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
    if (!this.reedConfig || this.priceHistory.length < this.reedConfig.lookbackPeriod) {
      return {};
    }

    const closes = this.priceHistory.map(d => d.close);
    const currentPrice = closes[closes.length - 1];

    // Calculate the spread (price deviations from mean)
    const lookback = this.reedConfig.lookbackPeriod;
    const recentCloses = closes.slice(-lookback);
    
    // Calculate mean and standard deviation
    this.meanValue = recentCloses.reduce((a, b) => a + b, 0) / lookback;
    const squaredDiffs = recentCloses.map(c => Math.pow(c - this.meanValue, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / lookback;
    this.stdValue = Math.sqrt(variance);

    // Calculate Z-score (current deviation from mean in standard deviations)
    const zScore = this.stdValue > 0 ? (currentPrice - this.meanValue) / this.stdValue : 0;
    this.zScores.push(zScore);
    if (this.zScores.length > lookback) {
      this.zScores.shift();
    }

    // Calculate spread for stationarity analysis
    const spread = currentPrice - this.meanValue;
    this.spreadHistory.push(spread);
    if (this.spreadHistory.length > lookback * 2) {
      this.spreadHistory.shift();
    }

    // Estimate half-life of mean reversion using Ornstein-Uhlenbeck process
    this.halfLife = this.calculateHalfLife();

    // RSI for additional confirmation
    const rsi = this.calculateRSI(closes, 14);

    // Rate of change
    const roc = closes.length > 1 
      ? ((currentPrice - closes[closes.length - 2]) / closes[closes.length - 2]) * 100 
      : 0;

    // Bollinger Band position
    const bollinger = this.calculateBollingerBands(closes, lookback, 2);

    // Autocorrelation (lag-1)
    const autocorrelation = this.calculateAutocorrelation(recentCloses, 1);

    return {
      currentPrice,
      meanValue: this.meanValue,
      stdValue: this.stdValue,
      zScore,
      halfLife: this.halfLife,
      rsi,
      roc,
      bollingerBandwidth: bollinger.bandwidth,
      autocorrelation,
      upperBand: this.meanValue + this.reedConfig.deviationThreshold * this.stdValue,
      lowerBand: this.meanValue - this.reedConfig.deviationThreshold * this.stdValue,
    };
  }

  protected generateSignals(indicators: IndicatorValues): Signal | null {
    if (!this.reedConfig || this.zScores.length < 2) {
      return null;
    }

    const currentPrice = indicators.currentPrice as number;
    const zScore = indicators.zScore as number;
    const halfLife = indicators.halfLife as number;
    const rsi = indicators.rsi as number;
    const symbol = this.priceHistory[this.priceHistory.length - 1].symbol;

    // Skip if half-life is outside acceptable range (not mean-reverting enough or too fast)
    if (halfLife !== null && (halfLife < this.reedConfig.minHalfLife || halfLife > this.reedConfig.maxHalfLife)) {
      return null;
    }

    // ENTRY SIGNALS
    // Z-score > threshold + RSI confirmation -> SHORT (expect mean reversion down)
    if (zScore > this.reedConfig.deviationThreshold && rsi > 60) {
      return {
        id: `REED-${Date.now()}-SHORT`,
        symbol,
        direction: 'SHORT',
        type: 'ENTRY',
        price: currentPrice,
        quantity: this.calculatePositionSize(currentPrice),
        confidence: Math.min(0.9, Math.abs(zScore) / 4 + (rsi - 60) / 100),
        reason: `Statistical arbitrage: Z-score ${zScore.toFixed(2)} > ${this.reedConfig.deviationThreshold}, expecting mean reversion`,
        timestamp: new Date(),
        metadata: { 
          strategy: 'STA', 
          zScore, 
          halfLife,
          expectedTarget: this.meanValue,
        },
      };
    }

    // Z-score < -threshold + RSI confirmation -> LONG (expect mean reversion up)
    if (zScore < -this.reedConfig.deviationThreshold && rsi < 40) {
      return {
        id: `REED-${Date.now()}-LONG`,
        symbol,
        direction: 'LONG',
        type: 'ENTRY',
        price: currentPrice,
        quantity: this.calculatePositionSize(currentPrice),
        confidence: Math.min(0.9, Math.abs(zScore) / 4 + (40 - rsi) / 100),
        reason: `Statistical arbitrage: Z-score ${zScore.toFixed(2)} < -${this.reedConfig.deviationThreshold}, expecting mean reversion`,
        timestamp: new Date(),
        metadata: { 
          strategy: 'STA', 
          zScore, 
          halfLife,
          expectedTarget: this.meanValue,
        },
      };
    }

    // EXIT SIGNALS for existing positions
    const existingPositions = this.state.positions.filter(p => p.symbol === symbol);
    for (const position of existingPositions) {
      // Exit when z-score returns to near zero
      if (Math.abs(zScore) < this.reedConfig.exitThreshold) {
        return {
          id: `REED-${Date.now()}-EXIT-${position.id}`,
          symbol,
          direction: position.direction === 'LONG' ? 'SHORT' : 'LONG',
          type: 'EXIT',
          price: currentPrice,
          quantity: position.size,
          confidence: 0.85,
          reason: `Mean reversion complete: Z-score ${zScore.toFixed(2)} returned to neutral`,
          timestamp: new Date(),
          metadata: { 
            strategy: 'STA_EXIT', 
            positionId: position.id,
            zScore,
          },
        };
      }
    }

    return null;
  }

  protected validateSignal(signal: Signal): RiskCheckResult {
    if (!this.reedConfig) {
      return { allowed: false, reason: 'Bot not configured' };
    }

    // Check position size
    const maxSize = this.reedConfig.maxPositionSize;
    if (signal.quantity > maxSize) {
      return { allowed: true, adjustedQuantity: maxSize };
    }

    // For entry signals, check existing positions
    if (signal.type === 'ENTRY') {
      const oppositePositions = this.state.positions.filter(
        p => p.symbol === signal.symbol && p.direction !== signal.direction
      );
      
      // Allow if we have opposite position (will be a hedge)
      if (oppositePositions.length > 0) {
        return { allowed: false, reason: 'Opposite position exists - close first' };
      }

      // Check total positions
      const samePositions = this.state.positions.filter(p => p.symbol === signal.symbol);
      if (samePositions.length >= 1) {
        return { allowed: false, reason: 'Position already exists for this symbol' };
      }
    }

    // Check confidence
    if (signal.confidence < 0.4) {
      return { allowed: false, reason: 'Signal confidence below threshold' };
    }

    return { allowed: true };
  }

  private calculateHalfLife(): number | null {
    if (this.spreadHistory.length < 10) return null;

    // Simple Ornstein-Uhlenbeck half-life estimation
    // λ = -ln(φ) where φ is the autoregressive coefficient
    const spreads = this.spreadHistory;
    const n = spreads.length;

    // Calculate linear regression of Δy_t on y_{t-1}
    let sumY = 0;
    let sumDeltaY = 0;
    let sumYDeltaY = 0;
    let sumY2 = 0;

    for (let t = 1; t < n; t++) {
      const y = spreads[t - 1];
      const deltaY = spreads[t] - spreads[t - 1];
      sumY += y;
      sumDeltaY += deltaY;
      sumYDeltaY += y * deltaY;
      sumY2 += y * y;
    }

    const meanY = sumY / (n - 1);
    const meanDeltaY = sumDeltaY / (n - 1);

    // Slope coefficient (lambda)
    const numerator = sumYDeltaY - (n - 1) * meanY * meanDeltaY;
    const denominator = sumY2 - (n - 1) * meanY * meanY;
    
    if (denominator === 0) return null;
    
    const lambda = numerator / denominator;

    // Half-life = -ln(2) / lambda
    // If lambda is positive, series is mean-reverting
    if (lambda >= 0) return null; // Not mean-reverting
    
    const halfLife = -Math.log(2) / lambda;
    
    // Convert to hours (assuming data is hourly)
    return Math.abs(halfLife);
  }

  private calculateAutocorrelation(data: number[], lag: number): number {
    if (data.length < lag + 1) return 0;

    const n = data.length;
    const mean = data.reduce((a, b) => a + b, 0) / n;
    
    let numerator = 0;
    let denominator = 0;

    for (let i = lag; i < n; i++) {
      numerator += (data[i] - mean) * (data[i - lag] - mean);
    }

    for (let i = 0; i < n; i++) {
      denominator += Math.pow(data[i] - mean, 2);
    }

    return denominator > 0 ? numerator / denominator : 0;
  }

  private calculatePositionSize(price: number): number {
    if (!this.reedConfig) return 0;
    return Math.min(
      this.reedConfig.maxPositionSize * this.reedConfig.leverage,
      this.reedConfig.maxPositionSize
    );
  }

  // Get current statistics
  getStatistics(): { mean: number; std: number; zScore: number; halfLife: number | null } {
    const lastZScore = this.zScores[this.zScores.length - 1] || 0;
    return {
      mean: this.meanValue,
      std: this.stdValue,
      zScore: lastZScore,
      halfLife: this.halfLife,
    };
  }

  updateReedConfig(updates: Partial<ReedConfig>): void {
    if (this.reedConfig) {
      this.reedConfig = { ...this.reedConfig, ...updates };
    }
  }
}

// Export singleton factory
let reedEngineInstance: ReedEngine | null = null;

export function getReedEngine(): ReedEngine {
  if (!reedEngineInstance) {
    reedEngineInstance = new ReedEngine();
  }
  return reedEngineInstance;
}
