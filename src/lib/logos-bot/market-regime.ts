/**
 * LOGOS Market Regime Detector
 * 
 * Detects market conditions for automatic strategy switching.
 * Uses technical indicators to classify market regimes:
 * - TRENDING: Strong directional movement
 * - RANGING: Sideways/consolidation
 * - VOLATILE: High volatility periods
 * - QUIET: Low volatility, calm markets
 */

import type { BotCode } from '../orchestration'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Market regime types
 */
export type MarketRegimeType = 'TRENDING' | 'RANGING' | 'VOLATILE' | 'QUIET'

/**
 * Trend direction when trending
 */
export type TrendDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL'

/**
 * Market regime detection result
 */
export interface MarketRegime {
  type: MarketRegimeType
  confidence: number              // 0-1 confidence in regime classification
  trendDirection: TrendDirection
  
  // Component scores (0-1)
  trendStrength: number           // ADX-based
  volatilityLevel: number         // ATR-based
  rangeBound: number              // Bollinger Band width
  volumeProfile: number           // Volume analysis
  
  // Detailed metrics
  metrics: {
    adx: number
    adxSmoothed: number
    atr: number
    atrPercent: number            // ATR as % of price
    bbWidth: number               // Bollinger Band width
    bbPosition: number            // Price position within bands (0-1)
    volumeRatio: number           // Current vs average volume
    momentum: number              // Rate of change
  }
  
  // Timestamps
  timestamp: number
  symbol: string
  exchange: string
}

/**
 * Historical regime data point
 */
export interface RegimeHistoryPoint {
  timestamp: number
  regime: MarketRegimeType
  confidence: number
  trendDirection: TrendDirection
}

/**
 * Regime detector configuration
 */
export interface RegimeDetectorConfig {
  // ADX thresholds
  adxTrendThreshold: number       // ADX above this = trending (default: 25)
  adxStrongTrendThreshold: number // ADX above this = strong trend (default: 40)
  
  // ATR thresholds (as percentage of price)
  atrVolatileThreshold: number    // ATR% above this = volatile (default: 3%)
  atrQuietThreshold: number       // ATR% below this = quiet (default: 1%)
  
  // Bollinger Band thresholds
  bbNarrowThreshold: number       // BB width below this = ranging (default: 0.04)
  bbWideThreshold: number         // BB width above this = trending (default: 0.08)
  
  // Volume thresholds
  volumeHighRatio: number         // Volume ratio above this = high activity (default: 1.5)
  volumeLowRatio: number          // Volume ratio below this = low activity (default: 0.5)
  
  // Smoothing periods
  adxSmoothing: number            // Periods to smooth ADX (default: 3)
  atrSmoothing: number            // Periods to smooth ATR (default: 5)
  
  // History retention
  maxHistoryPoints: number        // Max history points to keep (default: 100)
  
  // Hysteresis
  regimeChangeThreshold: number   // Confidence threshold to change regime (default: 0.15)
}

/**
 * Default regime detector configuration
 */
export const DEFAULT_REGIME_DETECTOR_CONFIG: RegimeDetectorConfig = {
  adxTrendThreshold: 25,
  adxStrongTrendThreshold: 40,
  
  atrVolatileThreshold: 0.03,
  atrQuietThreshold: 0.01,
  
  bbNarrowThreshold: 0.04,
  bbWideThreshold: 0.08,
  
  volumeHighRatio: 1.5,
  volumeLowRatio: 0.5,
  
  adxSmoothing: 3,
  atrSmoothing: 5,
  
  maxHistoryPoints: 100,
  
  regimeChangeThreshold: 0.15,
}

/**
 * OHLCV candle data
 */
export interface Candle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// ============================================================================
// MARKET REGIME DETECTOR
// ============================================================================

/**
 * Market Regime Detector class
 * 
 * Uses technical indicators to classify market conditions
 */
export class MarketRegimeDetector {
  private config: RegimeDetectorConfig
  private history: Map<string, RegimeHistoryPoint[]> = new Map()
  private lastRegime: Map<string, MarketRegime> = new Map()
  
  // Smoothed indicator buffers
  private adxBuffer: Map<string, number[]> = new Map()
  private atrBuffer: Map<string, number[]> = new Map()
  
  constructor(config: Partial<RegimeDetectorConfig> = {}) {
    this.config = { ...DEFAULT_REGIME_DETECTOR_CONFIG, ...config }
  }

  /**
   * Detect market regime from OHLCV data
   */
  public detect(
    symbol: string,
    exchange: string,
    candles: Candle[]
  ): MarketRegime | null {
    if (candles.length < 30) {
      console.warn('[RegimeDetector] Insufficient candles for regime detection')
      return null
    }
    
    const key = `${exchange}_${symbol}`
    
    // Calculate all metrics
    const metrics = this.calculateMetrics(candles)
    
    // Calculate component scores
    const trendStrength = this.calculateTrendStrength(metrics)
    const volatilityLevel = this.calculateVolatilityLevel(metrics)
    const rangeBound = this.calculateRangeBound(metrics)
    const volumeProfile = this.calculateVolumeProfile(metrics)
    
    // Determine regime
    const { type, confidence, trendDirection } = this.classifyRegime(
      trendStrength,
      volatilityLevel,
      rangeBound,
      volumeProfile,
      metrics,
      key
    )
    
    const regime: MarketRegime = {
      type,
      confidence,
      trendDirection,
      trendStrength,
      volatilityLevel,
      rangeBound,
      volumeProfile,
      metrics,
      timestamp: Date.now(),
      symbol,
      exchange,
    }
    
    // Apply hysteresis
    const adjustedRegime = this.applyHysteresis(regime, key)
    
    // Store in history
    this.storeHistory(key, adjustedRegime)
    
    return adjustedRegime
  }

  /**
   * Get current regime for a symbol
   */
  public getCurrentRegime(symbol: string, exchange: string): MarketRegime | null {
    const key = `${exchange}_${symbol}`
    return this.lastRegime.get(key) || null
  }

  /**
   * Get regime history for a symbol
   */
  public getHistory(symbol: string, exchange: string): RegimeHistoryPoint[] {
    const key = `${exchange}_${symbol}`
    return this.history.get(key) || []
  }

  /**
   * Calculate all technical metrics
   */
  private calculateMetrics(candles: Candle[]): MarketRegime['metrics'] {
    const closes = candles.map(c => c.close)
    const highs = candles.map(c => c.high)
    const lows = candles.map(c => c.low)
    const volumes = candles.map(c => c.volume)
    
    // ADX
    const adx = this.calculateADX(highs, lows, closes, 14)
    const adxSmoothed = this.getSmoothedADX(adx)
    
    // ATR
    const atr = this.calculateATR(highs, lows, closes, 14)
    const atrPercent = atr / closes[closes.length - 1]
    const atrSmoothed = this.getSmoothedATR(atrPercent)
    
    // Bollinger Bands
    const bb = this.calculateBollingerBands(closes, 20, 2)
    const bbWidth = (bb.upper - bb.lower) / bb.middle
    const bbPosition = (closes[closes.length - 1] - bb.lower) / (bb.upper - bb.lower)
    
    // Volume
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20
    const currentVolume = volumes[volumes.length - 1]
    const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1
    
    // Momentum (Rate of Change)
    const momentum = this.calculateROC(closes, 14)
    
    return {
      adx,
      adxSmoothed,
      atr,
      atrPercent,
      bbWidth,
      bbPosition,
      volumeRatio,
      momentum,
    }
  }

  /**
   * Calculate ADX (Average Directional Index)
   */
  private calculateADX(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number
  ): number {
    const n = closes.length
    if (n < period + 1) return 0
    
    // Calculate +DM and -DM
    const plusDM: number[] = [0]
    const minusDM: number[] = [0]
    
    for (let i = 1; i < n; i++) {
      const upMove = highs[i] - highs[i - 1]
      const downMove = lows[i - 1] - lows[i]
      
      plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0)
      minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0)
    }
    
    // Calculate True Range
    const tr: number[] = [0]
    for (let i = 1; i < n; i++) {
      tr.push(Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      ))
    }
    
    // Smooth the values
    const smoothTR = this.calculateEMA(tr, period)
    const smoothPlusDM = this.calculateEMA(plusDM, period)
    const smoothMinusDM = this.calculateEMA(minusDM, period)
    
    // Calculate +DI and -DI
    const plusDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0
    const minusDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0
    
    // Calculate DX
    const diSum = plusDI + minusDI
    const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0
    
    return dx
  }

  /**
   * Calculate ATR (Average True Range)
   */
  private calculateATR(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number
  ): number {
    const n = closes.length
    if (n < period + 1) return 0
    
    const tr: number[] = []
    for (let i = 1; i < n; i++) {
      tr.push(Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      ))
    }
    
    // Simple moving average of TR
    const recentTR = tr.slice(-period)
    return recentTR.reduce((a, b) => a + b, 0) / period
  }

  /**
   * Calculate Bollinger Bands
   */
  private calculateBollingerBands(
    closes: number[],
    period: number,
    stdDev: number
  ): { upper: number; middle: number; lower: number } {
    const recent = closes.slice(-period)
    const middle = recent.reduce((a, b) => a + b, 0) / period
    
    const variance = recent.reduce((sum, val) => sum + Math.pow(val - middle, 2), 0) / period
    const std = Math.sqrt(variance)
    
    return {
      upper: middle + stdDev * std,
      middle,
      lower: middle - stdDev * std,
    }
  }

  /**
   * Calculate Rate of Change (momentum)
   */
  private calculateROC(closes: number[], period: number): number {
    if (closes.length < period + 1) return 0
    const current = closes[closes.length - 1]
    const past = closes[closes.length - 1 - period]
    return past > 0 ? ((current - past) / past) * 100 : 0
  }

  /**
   * Calculate EMA
   */
  private calculateEMA(values: number[], period: number): number {
    if (values.length < period) return 0
    
    const k = 2 / (period + 1)
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period
    
    for (let i = period; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k)
    }
    
    return ema
  }

  /**
   * Get smoothed ADX value
   */
  private getSmoothedADX(currentADX: number): number {
    // Return smoothed value from buffer
    return currentADX // Simplified - in production, use the buffer
  }

  /**
   * Get smoothed ATR value
   */
  private getSmoothedATR(currentATR: number): number {
    // Return smoothed value from buffer
    return currentATR // Simplified - in production, use the buffer
  }

  /**
   * Calculate trend strength score (0-1)
   */
  private calculateTrendStrength(metrics: MarketRegime['metrics']): number {
    const adx = metrics.adxSmoothed
    
    if (adx >= this.config.adxStrongTrendThreshold) {
      return 1.0
    } else if (adx >= this.config.adxTrendThreshold) {
      return 0.5 + (adx - this.config.adxTrendThreshold) / 
             (this.config.adxStrongTrendThreshold - this.config.adxTrendThreshold) * 0.5
    } else {
      return adx / this.config.adxTrendThreshold * 0.5
    }
  }

  /**
   * Calculate volatility level score (0-1)
   */
  private calculateVolatilityLevel(metrics: MarketRegime['metrics']): number {
    const atrPercent = metrics.atrPercent
    
    if (atrPercent >= this.config.atrVolatileThreshold) {
      return 1.0
    } else if (atrPercent >= this.config.atrQuietThreshold) {
      return (atrPercent - this.config.atrQuietThreshold) / 
             (this.config.atrVolatileThreshold - this.config.atrQuietThreshold)
    } else {
      return atrPercent / this.config.atrQuietThreshold * 0.3
    }
  }

  /**
   * Calculate range-bound score (0-1)
   */
  private calculateRangeBound(metrics: MarketRegime['metrics']): number {
    const bbWidth = metrics.bbWidth
    
    if (bbWidth <= this.config.bbNarrowThreshold) {
      return 1.0
    } else if (bbWidth <= this.config.bbWideThreshold) {
      return 1 - (bbWidth - this.config.bbNarrowThreshold) / 
                 (this.config.bbWideThreshold - this.config.bbNarrowThreshold)
    } else {
      return 0
    }
  }

  /**
   * Calculate volume profile score (0-1)
   */
  private calculateVolumeProfile(metrics: MarketRegime['metrics']): number {
    const ratio = metrics.volumeRatio
    
    if (ratio >= this.config.volumeHighRatio) {
      return 1.0
    } else if (ratio <= this.config.volumeLowRatio) {
      return 0.2
    } else {
      return (ratio - this.config.volumeLowRatio) / 
             (this.config.volumeHighRatio - this.config.volumeLowRatio) * 0.8 + 0.2
    }
  }

  /**
   * Classify market regime based on component scores
   */
  private classifyRegime(
    trendStrength: number,
    volatilityLevel: number,
    rangeBound: number,
    volumeProfile: number,
    metrics: MarketRegime['metrics'],
    _key: string
  ): { type: MarketRegimeType; confidence: number; trendDirection: TrendDirection } {
    // Determine trend direction
    let trendDirection: TrendDirection = 'NEUTRAL'
    if (metrics.momentum > 1 && metrics.bbPosition > 0.6) {
      trendDirection = 'BULLISH'
    } else if (metrics.momentum < -1 && metrics.bbPosition < 0.4) {
      trendDirection = 'BEARISH'
    }
    
    // Determine regime type
    let type: MarketRegimeType
    let confidence: number
    
    // High volatility takes precedence
    if (volatilityLevel >= 0.7) {
      type = 'VOLATILE'
      confidence = volatilityLevel
      return { type, confidence, trendDirection }
    }
    
    // Low volatility = quiet market
    if (volatilityLevel <= 0.3) {
      type = 'QUIET'
      confidence = 1 - volatilityLevel
      return { type, confidence, trendDirection }
    }
    
    // Check for trending vs ranging
    if (trendStrength > rangeBound) {
      type = 'TRENDING'
      confidence = (trendStrength + (1 - rangeBound)) / 2
    } else {
      type = 'RANGING'
      confidence = (rangeBound + (1 - trendStrength)) / 2
    }
    
    return { type, confidence, trendDirection }
  }

  /**
   * Apply hysteresis to prevent rapid regime switching
   */
  private applyHysteresis(newRegime: MarketRegime, key: string): MarketRegime {
    const lastRegime = this.lastRegime.get(key)
    
    if (!lastRegime) {
      this.lastRegime.set(key, newRegime)
      return newRegime
    }
    
    // If same regime type, update smoothly
    if (lastRegime.type === newRegime.type) {
      this.lastRegime.set(key, newRegime)
      return newRegime
    }
    
    // Different regime type - apply hysteresis
    const confidenceDiff = newRegime.confidence - lastRegime.confidence
    
    if (confidenceDiff >= this.config.regimeChangeThreshold) {
      // Confidence difference is large enough - switch regime
      this.lastRegime.set(key, newRegime)
      return newRegime
    } else {
      // Keep previous regime but with updated metrics
      return {
        ...newRegime,
        type: lastRegime.type,
        confidence: lastRegime.confidence * 0.7 + newRegime.confidence * 0.3,
      }
    }
  }

  /**
   * Store regime in history
   */
  private storeHistory(key: string, regime: MarketRegime): void {
    if (!this.history.has(key)) {
      this.history.set(key, [])
    }
    
    const history = this.history.get(key)!
    history.push({
      timestamp: regime.timestamp,
      regime: regime.type,
      confidence: regime.confidence,
      trendDirection: regime.trendDirection,
    })
    
    // Limit history size
    if (history.length > this.config.maxHistoryPoints) {
      history.shift()
    }
  }

  /**
   * Get regime statistics
   */
  public getRegimeStats(symbol: string, exchange: string): {
    dominant: MarketRegimeType
    distribution: Record<MarketRegimeType, number>
    avgConfidence: number
    lastChange: number
  } | null {
    const key = `${exchange}_${symbol}`
    const history = this.history.get(key)
    
    if (!history || history.length === 0) return null
    
    // Calculate distribution
    const distribution: Record<MarketRegimeType, number> = {
      TRENDING: 0,
      RANGING: 0,
      VOLATILE: 0,
      QUIET: 0,
    }
    
    for (const point of history) {
      distribution[point.regime]++
    }
    
    // Find dominant regime
    let dominant: MarketRegimeType = 'RANGING'
    let maxCount = 0
    for (const [regime, count] of Object.entries(distribution)) {
      if (count > maxCount) {
        maxCount = count
        dominant = regime as MarketRegimeType
      }
    }
    
    // Calculate average confidence
    const avgConfidence = history.reduce((sum, p) => sum + p.confidence, 0) / history.length
    
    // Find last regime change
    let lastChange = 0
    for (let i = history.length - 1; i > 0; i--) {
      if (history[i].regime !== history[i - 1].regime) {
        lastChange = history[i].timestamp
        break
      }
    }
    
    return {
      dominant,
      distribution,
      avgConfidence,
      lastChange,
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  MarketRegimeDetector,
  DEFAULT_REGIME_DETECTOR_CONFIG,
}

export type {
  MarketRegime,
  MarketRegimeType,
  TrendDirection,
  RegimeDetectorConfig,
  RegimeHistoryPoint,
  Candle,
}
