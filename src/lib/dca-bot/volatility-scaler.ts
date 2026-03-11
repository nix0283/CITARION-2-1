/**
 * DCA Bot Volatility Scaler
 * 
 * ATR-based volatility measurement and dynamic position sizing for DCA bots.
 * Adjusts DCA parameters based on market volatility conditions.
 * 
 * Features:
 * - ATR-based volatility measurement
 * - Volatility-adjusted position sizing
 * - Dynamic DCA level spacing
 * - Amount scaling based on volatility
 * - Safety order trigger conditions
 */

// ==================== TYPES ====================

export type VolatilityLevel = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';

export interface ATRConfig {
  period: number;           // ATR period (default: 14)
  smoothing: 'SMA' | 'EMA' | 'WMA';  // Smoothing type
}

export interface VolatilityConfig {
  enabled: boolean;
  lookbackPeriod: number;           // Periods to look back for volatility calc
  atrPeriod: number;                // ATR calculation period
  atrSmoothing: 'SMA' | 'EMA' | 'WMA';
  
  // Volatility thresholds (as % of price)
  lowVolatilityThreshold: number;   // Below this = LOW volatility
  highVolatilityThreshold: number;  // Above this = HIGH volatility
  extremeVolatilityThreshold: number; // Above this = EXTREME volatility
  
  // Scaling factors
  lowVolScaling: number;            // Position size multiplier for low vol
  normalVolScaling: number;         // Position size multiplier for normal vol
  highVolScaling: number;           // Position size multiplier for high vol
  extremeVolScaling: number;        // Position size multiplier for extreme vol
  
  // Level spacing adjustments
  lowVolSpacingMultiplier: number;  // Closer spacing in low vol
  normalVolSpacingMultiplier: number;
  highVolSpacingMultiplier: number; // Wider spacing in high vol
  extremeVolSpacingMultiplier: number;
  
  // Safety order adjustments
  safetyOrderTriggerMultiplier: number; // Multiplier for safety order triggers
  maxSafetyOrdersInExtreme: number;     // Limit safety orders in extreme vol
}

export interface VolatilityReading {
  timestamp: Date;
  atr: number;
  atrPercent: number;              // ATR as percentage of price
  volatilityLevel: VolatilityLevel;
  price: number;
  high24h: number;
  low24h: number;
  volume24h?: number;
}

export interface ScalingResult {
  positionSizeMultiplier: number;
  levelSpacingMultiplier: number;
  safetyOrderTriggerPrice: number;
  maxSafetyOrders: number;
  suggestedBaseAmount: number;
  suggestedDcaPercent: number;
  volatilityLevel: VolatilityLevel;
  atrPercent: number;
  confidence: number;              // 0-1 confidence in the scaling
}

export interface VolatilityHistoryEntry {
  timestamp: Date;
  atrPercent: number;
  volatilityLevel: VolatilityLevel;
  positionSizeMultiplier: number;
  levelSpacingMultiplier: number;
}

// ==================== DEFAULT CONFIG ====================

export const DEFAULT_VOLATILITY_CONFIG: VolatilityConfig = {
  enabled: true,
  lookbackPeriod: 14,
  atrPeriod: 14,
  atrSmoothing: 'SMA',
  
  // Volatility thresholds (ATR % of price)
  lowVolatilityThreshold: 1.5,     // Below 1.5% = LOW
  highVolatilityThreshold: 3.5,    // Above 3.5% = HIGH
  extremeVolatilityThreshold: 6.0, // Above 6% = EXTREME
  
  // Position size scaling
  lowVolScaling: 1.2,              // Increase size in low vol
  normalVolScaling: 1.0,           // Normal size
  highVolScaling: 0.7,             // Reduce size in high vol
  extremeVolScaling: 0.4,          // Significantly reduce in extreme vol
  
  // Level spacing multipliers
  lowVolSpacingMultiplier: 0.7,    // Closer levels in low vol
  normalVolSpacingMultiplier: 1.0,
  highVolSpacingMultiplier: 1.5,   // Wider levels in high vol
  extremeVolSpacingMultiplier: 2.0,
  
  // Safety order settings
  safetyOrderTriggerMultiplier: 1.0,
  maxSafetyOrdersInExtreme: 3,     // Limit safety orders in extreme conditions
};

// ==================== VOLATILITY SCALER CLASS ====================

export class VolatilityScaler {
  private config: VolatilityConfig;
  private priceHistory: number[] = [];
  private highHistory: number[] = [];
  private lowHistory: number[] = [];
  private atrHistory: number[] = [];
  private currentReading: VolatilityReading | null = null;
  private history: VolatilityHistoryEntry[] = [];
  private readonly maxHistorySize = 100;

  constructor(config: Partial<VolatilityConfig> = {}) {
    this.config = { ...DEFAULT_VOLATILITY_CONFIG, ...config };
  }

  // ==================== ATR CALCULATION ====================

  /**
   * Calculate True Range for a single period
   */
  private calculateTrueRange(
    high: number,
    low: number,
    prevClose: number
  ): number {
    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    return Math.max(tr1, tr2, tr3);
  }

  /**
   * Calculate ATR using configured smoothing method
   */
  private calculateATR(trueRanges: number[]): number {
    if (trueRanges.length === 0) return 0;
    
    const period = Math.min(this.config.atrPeriod, trueRanges.length);
    const relevantTRs = trueRanges.slice(-period);
    
    switch (this.config.atrSmoothing) {
      case 'SMA':
        return relevantTRs.reduce((a, b) => a + b, 0) / relevantTRs.length;
      
      case 'EMA': {
        const multiplier = 2 / (period + 1);
        let ema = relevantTRs[0];
        for (let i = 1; i < relevantTRs.length; i++) {
          ema = (relevantTRs[i] - ema) * multiplier + ema;
        }
        return ema;
      }
      
      case 'WMA': {
        let sum = 0;
        let weightSum = 0;
        for (let i = 0; i < relevantTRs.length; i++) {
          const weight = i + 1;
          sum += relevantTRs[i] * weight;
          weightSum += weight;
        }
        return sum / weightSum;
      }
      
      default:
        return relevantTRs.reduce((a, b) => a + b, 0) / relevantTRs.length;
    }
  }

  /**
   * Update with new price data and calculate volatility
   */
  updatePrice(
    high: number,
    low: number,
    close: number,
    volume?: number
  ): VolatilityReading {
    // Add to history
    this.highHistory.push(high);
    this.lowHistory.push(low);
    this.priceHistory.push(close);
    
    // Trim history
    if (this.priceHistory.length > this.config.lookbackPeriod * 2) {
      this.highHistory.shift();
      this.lowHistory.shift();
      this.priceHistory.shift();
    }
    
    // Calculate True Range if we have previous close
    if (this.priceHistory.length > 1) {
      const prevClose = this.priceHistory[this.priceHistory.length - 2];
      const tr = this.calculateTrueRange(high, low, prevClose);
      this.atrHistory.push(tr);
      
      if (this.atrHistory.length > this.config.lookbackPeriod * 2) {
        this.atrHistory.shift();
      }
    }
    
    // Calculate ATR
    const atr = this.calculateATR(this.atrHistory);
    const atrPercent = close > 0 ? (atr / close) * 100 : 0;
    
    // Determine volatility level
    const volatilityLevel = this.determineVolatilityLevel(atrPercent);
    
    // Create reading
    this.currentReading = {
      timestamp: new Date(),
      atr,
      atrPercent,
      volatilityLevel,
      price: close,
      high24h: Math.max(...this.highHistory.slice(-24)),
      low24h: Math.min(...this.lowHistory.slice(-24)),
      volume24h: volume,
    };
    
    return this.currentReading;
  }

  /**
   * Determine volatility level from ATR percentage
   */
  private determineVolatilityLevel(atrPercent: number): VolatilityLevel {
    if (atrPercent < this.config.lowVolatilityThreshold) {
      return 'LOW';
    } else if (atrPercent < this.config.highVolatilityThreshold) {
      return 'NORMAL';
    } else if (atrPercent < this.config.extremeVolatilityThreshold) {
      return 'HIGH';
    } else {
      return 'EXTREME';
    }
  }

  // ==================== SCALING CALCULATIONS ====================

  /**
   * Calculate scaling factors based on current volatility
   */
  calculateScaling(
    baseAmount: number,
    baseDcaPercent: number,
    currentPrice: number,
    maxSafetyOrders: number
  ): ScalingResult {
    if (!this.config.enabled || !this.currentReading) {
      return {
        positionSizeMultiplier: 1.0,
        levelSpacingMultiplier: 1.0,
        safetyOrderTriggerPrice: currentPrice * (1 - baseDcaPercent / 100),
        maxSafetyOrders,
        suggestedBaseAmount: baseAmount,
        suggestedDcaPercent: baseDcaPercent,
        volatilityLevel: 'NORMAL',
        atrPercent: 0,
        confidence: 0,
      };
    }
    
    const { atrPercent, volatilityLevel } = this.currentReading;
    
    // Get scaling factors based on volatility level
    let positionSizeMultiplier: number;
    let levelSpacingMultiplier: number;
    
    switch (volatilityLevel) {
      case 'LOW':
        positionSizeMultiplier = this.config.lowVolScaling;
        levelSpacingMultiplier = this.config.lowVolSpacingMultiplier;
        break;
      case 'HIGH':
        positionSizeMultiplier = this.config.highVolScaling;
        levelSpacingMultiplier = this.config.highVolSpacingMultiplier;
        break;
      case 'EXTREME':
        positionSizeMultiplier = this.config.extremeVolScaling;
        levelSpacingMultiplier = this.config.extremeVolSpacingMultiplier;
        break;
      default:
        positionSizeMultiplier = this.config.normalVolScaling;
        levelSpacingMultiplier = this.config.normalVolSpacingMultiplier;
    }
    
    // Adjust safety orders in extreme volatility
    const adjustedMaxSafetyOrders = volatilityLevel === 'EXTREME'
      ? Math.min(maxSafetyOrders, this.config.maxSafetyOrdersInExtreme)
      : maxSafetyOrders;
    
    // Calculate suggested amounts
    const suggestedBaseAmount = baseAmount * positionSizeMultiplier;
    const suggestedDcaPercent = baseDcaPercent * levelSpacingMultiplier;
    
    // Calculate safety order trigger price
    const safetyOrderTriggerPrice = currentPrice * 
      (1 - (suggestedDcaPercent * this.config.safetyOrderTriggerMultiplier) / 100);
    
    // Calculate confidence based on data points
    const dataPoints = Math.min(this.atrHistory.length, this.config.lookbackPeriod);
    const confidence = Math.min(dataPoints / this.config.lookbackPeriod, 1);
    
    // Record in history
    this.addToHistory({
      timestamp: new Date(),
      atrPercent,
      volatilityLevel,
      positionSizeMultiplier,
      levelSpacingMultiplier,
    });
    
    return {
      positionSizeMultiplier,
      levelSpacingMultiplier,
      safetyOrderTriggerPrice,
      maxSafetyOrders: adjustedMaxSafetyOrders,
      suggestedBaseAmount,
      suggestedDcaPercent,
      volatilityLevel,
      atrPercent,
      confidence,
    };
  }

  /**
   * Get optimal DCA level prices based on volatility
   */
  calculateVolatilityAdjustedLevels(
    entryPrice: number,
    baseDcaPercent: number,
    numLevels: number,
    direction: 'LONG' | 'SHORT' = 'LONG'
  ): Array<{ level: number; price: number; deviation: number }> {
    const scaling = this.calculateScaling(0, baseDcaPercent, entryPrice, numLevels);
    const levels: Array<{ level: number; price: number; deviation: number }> = [];
    
    const spacingMultiplier = scaling.levelSpacingMultiplier;
    const isLong = direction === 'LONG';
    
    for (let i = 1; i <= numLevels; i++) {
      // Progressive spacing - each level further apart
      const progressiveMultiplier = 1 + (i - 1) * 0.1; // 10% more spacing per level
      const deviation = baseDcaPercent * spacingMultiplier * progressiveMultiplier * i;
      
      const price = isLong
        ? entryPrice * (1 - deviation / 100)
        : entryPrice * (1 + deviation / 100);
      
      levels.push({
        level: i,
        price,
        deviation,
      });
    }
    
    return levels;
  }

  /**
   * Calculate dynamic amount for each DCA level
   */
  calculateVolatilityAdjustedAmounts(
    baseAmount: number,
    numLevels: number,
    baseMultiplier: number = 1.5,
    volatilityLevel?: VolatilityLevel
  ): Array<{ level: number; amount: number; multiplier: number }> {
    const vol = volatilityLevel || this.currentReading?.volatilityLevel || 'NORMAL';
    const amounts: Array<{ level: number; amount: number; multiplier: number }> = [];
    
    // Adjust base multiplier based on volatility
    let adjustedBaseMultiplier = baseMultiplier;
    if (vol === 'HIGH') {
      adjustedBaseMultiplier = baseMultiplier * 1.2; // More aggressive averaging
    } else if (vol === 'EXTREME') {
      adjustedBaseMultiplier = baseMultiplier * 1.5;
    } else if (vol === 'LOW') {
      adjustedBaseMultiplier = baseMultiplier * 0.9; // Less aggressive
    }
    
    let currentMultiplier = 1;
    for (let i = 1; i <= numLevels; i++) {
      const amount = baseAmount * currentMultiplier;
      amounts.push({
        level: i,
        amount,
        multiplier: currentMultiplier,
      });
      currentMultiplier *= adjustedBaseMultiplier;
    }
    
    return amounts;
  }

  /**
   * Check if conditions are safe for safety order
   */
  shouldTriggerSafetyOrder(
    currentPrice: number,
    triggerPrice: number,
    direction: 'LONG' | 'SHORT'
  ): { shouldTrigger: boolean; reason: string } {
    const isLong = direction === 'LONG';
    const priceTriggered = isLong
      ? currentPrice <= triggerPrice
      : currentPrice >= triggerPrice;
    
    if (!priceTriggered) {
      return { shouldTrigger: false, reason: 'Price not at trigger level' };
    }
    
    // Additional checks based on volatility
    if (this.currentReading) {
      const { volatilityLevel, atrPercent } = this.currentReading;
      
      if (volatilityLevel === 'EXTREME') {
        // In extreme volatility, require additional confirmation
        // Check if price has stabilized somewhat
        const recentPrices = this.priceHistory.slice(-5);
        if (recentPrices.length >= 5) {
          const avgRecentPrice = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
          const priceStability = Math.abs(currentPrice - avgRecentPrice) / avgRecentPrice;
          
          if (priceStability > 0.02) { // More than 2% deviation from recent average
            return {
              shouldTrigger: false,
              reason: `Extreme volatility with unstable price (stability: ${(priceStability * 100).toFixed(2)}%)`
            };
          }
        }
      }
    }
    
    return { shouldTrigger: true, reason: 'Price at trigger level' };
  }

  // ==================== HISTORY MANAGEMENT ====================

  private addToHistory(entry: VolatilityHistoryEntry): void {
    this.history.push(entry);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  getHistory(limit?: number): VolatilityHistoryEntry[] {
    const history = [...this.history].reverse();
    return limit ? history.slice(0, limit) : history;
  }

  getCurrentReading(): VolatilityReading | null {
    return this.currentReading;
  }

  getConfig(): VolatilityConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<VolatilityConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get volatility statistics
   */
  getVolatilityStats(): {
    avgAtrPercent: number;
    maxAtrPercent: number;
    minAtrPercent: number;
    currentLevel: VolatilityLevel;
    readingsCount: number;
  } {
    if (this.history.length === 0) {
      return {
        avgAtrPercent: 0,
        maxAtrPercent: 0,
        minAtrPercent: 0,
        currentLevel: 'NORMAL',
        readingsCount: 0,
      };
    }
    
    const atrPercents = this.history.map(h => h.atrPercent);
    
    return {
      avgAtrPercent: atrPercents.reduce((a, b) => a + b, 0) / atrPercents.length,
      maxAtrPercent: Math.max(...atrPercents),
      minAtrPercent: Math.min(...atrPercents),
      currentLevel: this.currentReading?.volatilityLevel || 'NORMAL',
      readingsCount: this.history.length,
    };
  }

  /**
   * Reset state
   */
  reset(): void {
    this.priceHistory = [];
    this.highHistory = [];
    this.lowHistory = [];
    this.atrHistory = [];
    this.currentReading = null;
    this.history = [];
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Create volatility scaler with config
 */
export function createVolatilityScaler(
  config: Partial<VolatilityConfig> = {}
): VolatilityScaler {
  return new VolatilityScaler(config);
}

/**
 * Quick volatility level check from OHLCV data
 */
export function quickVolatilityCheck(
  candles: Array<{ high: number; low: number; close: number }>
): { atr: number; atrPercent: number; level: VolatilityLevel } {
  if (candles.length < 2) {
    return { atr: 0, atrPercent: 0, level: 'NORMAL' };
  }
  
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    trueRanges.push(tr);
  }
  
  const atr = trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
  const lastClose = candles[candles.length - 1].close;
  const atrPercent = (atr / lastClose) * 100;
  
  let level: VolatilityLevel = 'NORMAL';
  if (atrPercent < DEFAULT_VOLATILITY_CONFIG.lowVolatilityThreshold) {
    level = 'LOW';
  } else if (atrPercent >= DEFAULT_VOLATILITY_CONFIG.extremeVolatilityThreshold) {
    level = 'EXTREME';
  } else if (atrPercent >= DEFAULT_VOLATILITY_CONFIG.highVolatilityThreshold) {
    level = 'HIGH';
  }
  
  return { atr, atrPercent, level };
}

/**
 * Get recommended DCA parameters for volatility level
 */
export function getRecommendedDCAParams(
  volatilityLevel: VolatilityLevel,
  baseConfig: {
    baseAmount: number;
    dcaPercent: number;
    dcaMultiplier: number;
    maxSafetyOrders: number;
  }
): {
  recommendedAmount: number;
  recommendedDcaPercent: number;
  recommendedMultiplier: number;
  recommendedSafetyOrders: number;
  reasoning: string;
} {
  const config = DEFAULT_VOLATILITY_CONFIG;
  
  switch (volatilityLevel) {
    case 'LOW':
      return {
        recommendedAmount: baseConfig.baseAmount * config.lowVolScaling,
        recommendedDcaPercent: baseConfig.dcaPercent * config.lowVolSpacingMultiplier,
        recommendedMultiplier: baseConfig.dcaMultiplier * 0.9,
        recommendedSafetyOrders: baseConfig.maxSafetyOrders,
        reasoning: 'Low volatility: Increased position size, closer levels, less aggressive averaging',
      };
    
    case 'HIGH':
      return {
        recommendedAmount: baseConfig.baseAmount * config.highVolScaling,
        recommendedDcaPercent: baseConfig.dcaPercent * config.highVolSpacingMultiplier,
        recommendedMultiplier: baseConfig.dcaMultiplier * 1.2,
        recommendedSafetyOrders: Math.max(3, baseConfig.maxSafetyOrders - 2),
        reasoning: 'High volatility: Reduced position size, wider levels, more aggressive averaging',
      };
    
    case 'EXTREME':
      return {
        recommendedAmount: baseConfig.baseAmount * config.extremeVolScaling,
        recommendedDcaPercent: baseConfig.dcaPercent * config.extremeVolSpacingMultiplier,
        recommendedMultiplier: baseConfig.dcaMultiplier * 1.5,
        recommendedSafetyOrders: config.maxSafetyOrdersInExtreme,
        reasoning: 'Extreme volatility: Significantly reduced size, very wide levels, maximum caution',
      };
    
    default:
      return {
        recommendedAmount: baseConfig.baseAmount,
        recommendedDcaPercent: baseConfig.dcaPercent,
        recommendedMultiplier: baseConfig.dcaMultiplier,
        recommendedSafetyOrders: baseConfig.maxSafetyOrders,
        reasoning: 'Normal volatility: Standard DCA parameters',
      };
  }
}
