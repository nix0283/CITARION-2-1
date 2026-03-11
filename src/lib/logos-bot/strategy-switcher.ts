/**
 * LOGOS Strategy Switcher
 * 
 * Automatically adjusts aggregation strategy based on market conditions.
 * 
 * Features:
 * - Market regime detection (trending, ranging, volatile, quiet)
 * - Strategy profiles for different conditions
 * - Automatic weight adjustment for bot categories
 * - Hysteresis to prevent rapid switching
 * - Performance-based strategy selection
 */

import { AggregationConfig, DEFAULT_AGGREGATION_CONFIG } from './engine';

// ==================== TYPES ====================

export type MarketRegime = 'trending' | 'ranging' | 'volatile' | 'quiet' | 'transitional';

export interface MarketConditionScores {
  trendStrength: number;     // 0-1
  volatilityLevel: number;   // 0-1
  volumeProfile: number;     // 0-1
  momentumDirection: number; // -1 to 1
  rangeCompression: number;  // 0-1
}

export interface StrategyProfile {
  name: string;
  regime: MarketRegime;
  description: string;
  
  // Aggregation weights
  categoryWeights: {
    operational: number;
    institutional: number;
    frequency: number;
  };
  
  // Bot type preferences
  botPreferences: {
    trendFollowing: number;   // KRON, TRND
    meanReversion: number;    // EQUILIBRIST, MR
    momentum: number;         // FCST, PND
    marketMaking: number;     // ARCHITECT, MM
    grid: number;             // MESH, SCALE
  };
  
  // Signal parameters
  minSignals: number;
  minConfidence: number;
  minConsensus: number;
  conflictThreshold: number;
  conflictResolution: 'strict' | 'moderate' | 'loose';
  
  // Risk parameters
  positionSizeMultiplier: number;
  stopLossMultiplier: number;
  takeProfitMultiplier: number;
}

export interface StrategySwitchResult {
  previousRegime: MarketRegime;
  newRegime: MarketRegime;
  profile: StrategyProfile;
  confidence: number;
  reason: string;
  timestamp: Date;
}

export interface RegimeHistoryEntry {
  regime: MarketRegime;
  startTime: Date;
  endTime?: Date;
  performance: {
    signalsGenerated: number;
    signalsProfitable: number;
    avgPnl: number;
  };
}

// ==================== STRATEGY PROFILES ====================

export const STRATEGY_PROFILES: Record<MarketRegime, StrategyProfile> = {
  trending: {
    name: 'Trend Following',
    regime: 'trending',
    description: 'Favors trend-following bots with wider stops and larger targets',
    categoryWeights: {
      operational: 1.0,
      institutional: 1.3,  // Favor institutional bots
      frequency: 0.8,
    },
    botPreferences: {
      trendFollowing: 1.5,   // Strong preference
      meanReversion: 0.5,    // Reduce mean reversion
      momentum: 1.2,
      marketMaking: 0.7,
      grid: 0.8,
    },
    minSignals: 2,
    minConfidence: 0.55,
    minConsensus: 0.55,
    conflictThreshold: 0.25,
    conflictResolution: 'moderate',
    positionSizeMultiplier: 1.2,
    stopLossMultiplier: 1.3,    // Wider stops for trends
    takeProfitMultiplier: 1.5,  // Larger targets
  },
  
  ranging: {
    name: 'Range Trading',
    regime: 'ranging',
    description: 'Favors mean-reversion and grid strategies with tighter stops',
    categoryWeights: {
      operational: 1.2,    // Favor operational bots (Grid, BB)
      institutional: 1.0,
      frequency: 0.9,
    },
    botPreferences: {
      trendFollowing: 0.6,
      meanReversion: 1.4,   // Strong preference
      momentum: 0.8,
      marketMaking: 1.2,
      grid: 1.3,           // Grid works well in ranges
    },
    minSignals: 2,
    minConfidence: 0.5,
    minConsensus: 0.5,
    conflictThreshold: 0.35,
    conflictResolution: 'loose',
    positionSizeMultiplier: 1.0,
    stopLossMultiplier: 0.8,   // Tighter stops
    takeProfitMultiplier: 0.9, // Smaller targets
  },
  
  volatile: {
    name: 'High Volatility',
    regime: 'volatile',
    description: 'Conservative approach with reduced position sizes and wider stops',
    categoryWeights: {
      operational: 0.9,
      institutional: 1.1,
      frequency: 1.0,
    },
    botPreferences: {
      trendFollowing: 1.0,
      meanReversion: 0.9,
      momentum: 1.1,
      marketMaking: 0.8,
      grid: 0.6,          // Reduce grid in high vol
    },
    minSignals: 3,          // Require more signals
    minConfidence: 0.6,     // Higher confidence threshold
    minConsensus: 0.65,     // Higher consensus required
    conflictThreshold: 0.2,  // Stricter conflict
    conflictResolution: 'strict',
    positionSizeMultiplier: 0.6, // Smaller positions
    stopLossMultiplier: 1.5,     // Wider stops
    takeProfitMultiplier: 1.8,   // Larger targets for vol
  },
  
  quiet: {
    name: 'Low Volatility',
    regime: 'quiet',
    description: 'More aggressive entries with tighter risk management',
    categoryWeights: {
      operational: 1.1,
      institutional: 1.0,
      frequency: 1.0,
    },
    botPreferences: {
      trendFollowing: 0.9,
      meanReversion: 1.1,
      momentum: 0.9,
      marketMaking: 1.3,   // Market making works in quiet markets
      grid: 1.2,          // Grid works well
    },
    minSignals: 2,
    minConfidence: 0.45,   // Lower threshold
    minConsensus: 0.5,
    conflictThreshold: 0.4,
    conflictResolution: 'loose',
    positionSizeMultiplier: 1.3, // Larger positions
    stopLossMultiplier: 0.7,     // Tighter stops
    takeProfitMultiplier: 0.8,   // Smaller targets
  },
  
  transitional: {
    name: 'Market Transition',
    regime: 'transitional',
    description: 'Cautious approach during regime changes',
    categoryWeights: {
      operational: 1.0,
      institutional: 1.0,
      frequency: 0.9,
    },
    botPreferences: {
      trendFollowing: 1.0,
      meanReversion: 1.0,
      momentum: 1.0,
      marketMaking: 0.9,
      grid: 0.9,
    },
    minSignals: 3,
    minConfidence: 0.55,
    minConsensus: 0.6,
    conflictThreshold: 0.25,
    conflictResolution: 'moderate',
    positionSizeMultiplier: 0.8,
    stopLossMultiplier: 1.0,
    takeProfitMultiplier: 1.0,
  },
};

// ==================== STRATEGY SWITCHER CLASS ====================

export class StrategySwitcher {
  private currentRegime: MarketRegime = 'quiet';
  private currentProfile: StrategyProfile = STRATEGY_PROFILES.quiet;
  private regimeHistory: RegimeHistoryEntry[] = [];
  private switchCooldownMs: number;
  private minConfidenceForSwitch: number;
  private lastSwitchTime: Date | null = null;
  private hysteresisThreshold: number;
  
  // Market data tracking
  private priceHistory: number[] = [];
  private volumeHistory: number[] = [];
  private atrHistory: number[] = [];
  
  constructor(options: {
    switchCooldownMs?: number;
    minConfidenceForSwitch?: number;
    hysteresisThreshold?: number;
    initialRegime?: MarketRegime;
  } = {}) {
    this.switchCooldownMs = options.switchCooldownMs || 300000; // 5 minutes
    this.minConfidenceForSwitch = options.minConfidenceForSwitch || 0.7;
    this.hysteresisThreshold = options.hysteresisThreshold || 0.15;
    
    if (options.initialRegime) {
      this.currentRegime = options.initialRegime;
      this.currentProfile = STRATEGY_PROFILES[options.initialRegime];
    }
    
    // Record initial regime
    this.regimeHistory.push({
      regime: this.currentRegime,
      startTime: new Date(),
      performance: {
        signalsGenerated: 0,
        signalsProfitable: 0,
        avgPnl: 0,
      },
    });
  }

  // ==================== MARKET ANALYSIS ====================

  /**
   * Update market data and potentially switch strategy
   */
  updateMarketData(data: {
    price: number;
    volume?: number;
    high?: number;
    low?: number;
    atr?: number;
  }): MarketConditionScores {
    // Update history
    this.priceHistory.push(data.price);
    if (data.volume) this.volumeHistory.push(data.volume);
    if (data.atr) this.atrHistory.push(data.atr);
    
    // Limit history size
    const maxHistory = 100;
    if (this.priceHistory.length > maxHistory) this.priceHistory.shift();
    if (this.volumeHistory.length > maxHistory) this.volumeHistory.shift();
    if (this.atrHistory.length > maxHistory) this.atrHistory.shift();
    
    // Calculate scores
    return this.calculateConditionScores(data);
  }

  /**
   * Calculate market condition scores
   */
  private calculateConditionScores(data: {
    price: number;
    high?: number;
    low?: number;
    atr?: number;
  }): MarketConditionScores {
    const prices = this.priceHistory;
    
    // Trend Strength (using linear regression slope)
    const trendStrength = this.calculateTrendStrength(prices);
    
    // Volatility Level (using ATR or price range)
    const volatilityLevel = this.calculateVolatilityLevel(data);
    
    // Volume Profile (relative to recent average)
    const volumeProfile = this.calculateVolumeProfile();
    
    // Momentum Direction (recent price change direction)
    const momentumDirection = this.calculateMomentumDirection(prices);
    
    // Range Compression (Bollinger Band width or similar)
    const rangeCompression = this.calculateRangeCompression(prices);
    
    return {
      trendStrength,
      volatilityLevel,
      volumeProfile,
      momentumDirection,
      rangeCompression,
    };
  }

  /**
   * Calculate trend strength using linear regression
   */
  private calculateTrendStrength(prices: number[]): number {
    if (prices.length < 10) return 0.5;
    
    const n = prices.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += prices[i];
      sumXY += i * prices[i];
      sumX2 += i * i;
    }
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const avgPrice = sumY / n;
    
    // Normalize slope to 0-1 range
    const normalizedSlope = Math.abs(slope) / avgPrice * 100;
    return Math.min(1, normalizedSlope);
  }

  /**
   * Calculate volatility level
   */
  private calculateVolatilityLevel(data: { price: number; atr?: number }): number {
    if (this.atrHistory.length > 0) {
      const avgAtr = this.atrHistory.reduce((a, b) => a + b, 0) / this.atrHistory.length;
      const atrPercent = avgAtr / data.price;
      return Math.min(1, atrPercent * 20); // Normalize to 0-1
    }
    
    // Fallback: use price history variance
    if (this.priceHistory.length < 10) return 0.5;
    
    const avg = this.priceHistory.reduce((a, b) => a + b, 0) / this.priceHistory.length;
    const variance = this.priceHistory.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / this.priceHistory.length;
    const stdDev = Math.sqrt(variance);
    
    return Math.min(1, (stdDev / avg) * 20);
  }

  /**
   * Calculate volume profile
   */
  private calculateVolumeProfile(): number {
    if (this.volumeHistory.length < 5) return 0.5;
    
    const recent = this.volumeHistory.slice(-5);
    const older = this.volumeHistory.slice(-20, -5);
    
    if (older.length === 0) return 0.5;
    
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    
    return Math.min(1, recentAvg / olderAvg);
  }

  /**
   * Calculate momentum direction
   */
  private calculateMomentumDirection(prices: number[]): number {
    if (prices.length < 5) return 0;
    
    const recent = prices.slice(-5);
    const change = (recent[recent.length - 1] - recent[0]) / recent[0];
    
    return Math.max(-1, Math.min(1, change * 10));
  }

  /**
   * Calculate range compression
   */
  private calculateRangeCompression(prices: number[]): number {
    if (prices.length < 20) return 0.5;
    
    const recent = prices.slice(-10);
    const older = prices.slice(-20, -10);
    
    const recentRange = Math.max(...recent) - Math.min(...recent);
    const olderRange = Math.max(...older) - Math.min(...older);
    
    // Low value = compressed, high value = expanded
    return 1 - (recentRange / olderRange);
  }

  // ==================== REGIME DETECTION ====================

  /**
   * Detect current market regime
   */
  detectRegime(scores: MarketConditionScores): { regime: MarketRegime; confidence: number } {
    const { trendStrength, volatilityLevel, momentumDirection, rangeCompression } = scores;
    
    let regime: MarketRegime;
    let confidence: number;
    
    // Decision logic with hysteresis
    if (volatilityLevel > 0.7) {
      // High volatility
      regime = 'volatile';
      confidence = volatilityLevel;
    } else if (volatilityLevel < 0.3 && rangeCompression < 0.5) {
      // Low volatility and range compression
      regime = 'quiet';
      confidence = 1 - volatilityLevel;
    } else if (trendStrength > 0.5 && Math.abs(momentumDirection) > 0.3) {
      // Strong trend
      regime = 'trending';
      confidence = trendStrength * Math.abs(momentumDirection);
    } else if (trendStrength < 0.3 && rangeCompression > 0.5) {
      // Range-bound market
      regime = 'ranging';
      confidence = (1 - trendStrength) * rangeCompression;
    } else {
      // Transitional state
      regime = 'transitional';
      confidence = 0.5;
    }
    
    // Apply hysteresis
    if (this.currentRegime !== regime && this.currentRegime !== 'transitional') {
      // Require higher confidence to switch from stable regime
      const switchThreshold = this.minConfidenceForSwitch + this.hysteresisThreshold;
      if (confidence < switchThreshold) {
        regime = this.currentRegime;
        confidence *= 0.8;
      }
    }
    
    return { regime, confidence };
  }

  // ==================== STRATEGY SWITCHING ====================

  /**
   * Check and potentially switch strategy
   */
  checkAndSwitch(scores: MarketConditionScores): StrategySwitchResult | null {
    // Check cooldown
    if (this.lastSwitchTime) {
      const timeSinceLastSwitch = Date.now() - this.lastSwitchTime.getTime();
      if (timeSinceLastSwitch < this.switchCooldownMs) {
        return null;
      }
    }
    
    // Detect regime
    const { regime: detectedRegime, confidence } = this.detectRegime(scores);
    
    // Check if switch is needed
    if (detectedRegime === this.currentRegime) {
      return null;
    }
    
    // Check confidence threshold
    if (confidence < this.minConfidenceForSwitch) {
      return null;
    }
    
    // Perform switch
    const previousRegime = this.currentRegime;
    const newProfile = STRATEGY_PROFILES[detectedRegime];
    
    // End current regime history entry
    const currentEntry = this.regimeHistory[this.regimeHistory.length - 1];
    if (currentEntry) {
      currentEntry.endTime = new Date();
    }
    
    // Update state
    this.currentRegime = detectedRegime;
    this.currentProfile = newProfile;
    this.lastSwitchTime = new Date();
    
    // Add new history entry
    this.regimeHistory.push({
      regime: detectedRegime,
      startTime: new Date(),
      performance: {
        signalsGenerated: 0,
        signalsProfitable: 0,
        avgPnl: 0,
      },
    });
    
    console.log(`[StrategySwitcher] Switched from ${previousRegime} to ${detectedRegime} (confidence: ${(confidence * 100).toFixed(0)}%)`);
    
    return {
      previousRegime,
      newRegime: detectedRegime,
      profile: newProfile,
      confidence,
      reason: this.generateSwitchReason(scores, previousRegime, detectedRegime),
      timestamp: new Date(),
    };
  }

  /**
   * Generate reason for strategy switch
   */
  private generateSwitchReason(
    scores: MarketConditionScores,
    from: MarketRegime,
    to: MarketRegime
  ): string {
    const reasons: string[] = [];
    
    if (scores.volatilityLevel > 0.7) {
      reasons.push(`High volatility detected (${(scores.volatilityLevel * 100).toFixed(0)}%)`);
    } else if (scores.volatilityLevel < 0.3) {
      reasons.push(`Low volatility detected (${(scores.volatilityLevel * 100).toFixed(0)}%)`);
    }
    
    if (scores.trendStrength > 0.5) {
      reasons.push(`Strong trend (${(scores.trendStrength * 100).toFixed(0)}%)`);
    } else if (scores.trendStrength < 0.3) {
      reasons.push(`Weak trend (${(scores.trendStrength * 100).toFixed(0)}%)`);
    }
    
    if (Math.abs(scores.momentumDirection) > 0.3) {
      reasons.push(`Momentum ${scores.momentumDirection > 0 ? 'bullish' : 'bearish'} (${(scores.momentumDirection * 100).toFixed(0)}%)`);
    }
    
    return reasons.length > 0 
      ? reasons.join(', ')
      : `Market conditions changed from ${from} to ${to}`;
  }

  // ==================== AGGREGATION CONFIG UPDATE ====================

  /**
   * Get aggregation config adjusted for current strategy
   */
  getAdjustedAggregationConfig(baseConfig: AggregationConfig): AggregationConfig {
    const profile = this.currentProfile;
    
    return {
      ...baseConfig,
      categoryWeights: profile.categoryWeights,
      minSignals: profile.minSignals,
      minConfidence: profile.minConfidence,
      minConsensus: profile.minConsensus,
      conflictThreshold: profile.conflictThreshold,
      conflictResolution: profile.conflictResolution,
    };
  }

  /**
   * Get bot preference weight
   */
  getBotPreferenceWeight(botType: string): number {
    const prefs = this.currentProfile.botPreferences;
    
    const typeMap: Record<string, keyof typeof prefs> = {
      'KRON': 'trendFollowing',
      'TRND': 'trendFollowing',
      'EQUILIBRIST': 'meanReversion',
      'MR': 'meanReversion',
      'FCST': 'momentum',
      'PND': 'momentum',
      'ARCHITECT': 'marketMaking',
      'MM': 'marketMaking',
      'MESH': 'grid',
      'SCALE': 'grid',
    };
    
    const prefKey = typeMap[botType.toUpperCase()];
    return prefKey ? prefs[prefKey] : 1.0;
  }

  // ==================== GETTERS ====================

  getCurrentRegime(): MarketRegime {
    return this.currentRegime;
  }

  getCurrentProfile(): StrategyProfile {
    return this.currentProfile;
  }

  getRegimeHistory(): RegimeHistoryEntry[] {
    return [...this.regimeHistory];
  }

  getLastSwitchTime(): Date | null {
    return this.lastSwitchTime;
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Create strategy switcher with default options
 */
export function createStrategySwitcher(options?: {
  switchCooldownMs?: number;
  minConfidenceForSwitch?: number;
  hysteresisThreshold?: number;
  initialRegime?: MarketRegime;
}): StrategySwitcher {
  return new StrategySwitcher(options);
}

// ==================== EXPORTS ====================

export default StrategySwitcher;
