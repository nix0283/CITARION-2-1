/**
 * Dynamic Grid Adjuster
 * 
 * Real-time grid level adjustment based on market conditions:
 * - ATR-based grid spacing (wider in volatile markets)
 * - Support/resistance aware grid placement
 * - Automatic grid rebalancing when price exits range
 * - Trailing grid functionality
 * - Grid pause/resume based on market conditions
 */

import { EventEmitter } from 'events';
import { Candle } from '../strategy/types';

// ==================== TYPES ====================

export interface DynamicAdjusterConfig {
  /** Enable dynamic adjustment */
  enabled: boolean;
  /** Minimum interval between adjustments (ms) */
  adjustmentInterval: number;
  /** Maximum price movement threshold before adjustment (%) */
  maxAdjustmentThreshold: number;
  /** ATR period for volatility calculation */
  atrPeriod: number;
  /** ATR multiplier for grid spacing */
  atrMultiplier: number;
  /** Enable support/resistance detection */
  srDetectionEnabled: boolean;
  /** Support/resistance lookback period */
  srLookbackPeriod: number;
  /** Minimum distance from S/R level (%) */
  srMinDistancePercent: number;
  /** Enable trailing grid */
  trailingEnabled: boolean;
  /** Trailing activation threshold (%) */
  trailingActivationThreshold: number;
  /** Trailing distance (%) */
  trailingDistance: number;
  /** Enable auto pause on extreme volatility */
  autoPauseEnabled: boolean;
  /** Volatility threshold for auto pause (%) */
  autoPauseVolatilityThreshold: number;
  /** Enable auto resume */
  autoResumeEnabled: boolean;
  /** Volatility threshold for auto resume (%) */
  autoResumeVolatilityThreshold: number;
}

export interface SupportResistanceLevel {
  price: number;
  type: 'support' | 'resistance';
  strength: number; // 1-10
  touches: number;
  lastTouch: Date;
}

export interface GridAdjustmentResult {
  adjusted: boolean;
  reason: string;
  oldUpperPrice: number;
  oldLowerPrice: number;
  newUpperPrice: number;
  newLowerPrice: number;
  oldGridCount: number;
  newGridCount: number;
  timestamp: Date;
  metrics: AdjustmentMetrics;
}

export interface AdjustmentMetrics {
  atr: number;
  atrPercent: number;
  volatilityState: 'low' | 'normal' | 'high' | 'extreme';
  pricePosition: number; // 0-1, position within grid
  distanceToSupport: number;
  distanceToResistance: number;
  gridUtilization: number; // % of filled levels
}

export interface DynamicAdjusterState {
  lastAdjustmentAt: Date | null;
  adjustmentCount: number;
  trailingActivated: boolean;
  trailingHighestPrice: number;
  trailingLowestPrice: number;
  isPaused: boolean;
  pauseReason: string | null;
  adjustmentHistory: GridAdjustmentResult[];
}

// ==================== CONSTANTS ====================

export const DEFAULT_DYNAMIC_ADJUSTER_CONFIG: DynamicAdjusterConfig = {
  enabled: true,
  adjustmentInterval: 60000, // 1 minute
  maxAdjustmentThreshold: 5, // 5%
  atrPeriod: 14,
  atrMultiplier: 1.0,
  srDetectionEnabled: true,
  srLookbackPeriod: 100,
  srMinDistancePercent: 0.5,
  trailingEnabled: true,
  trailingActivationThreshold: 3, // 3%
  trailingDistance: 2, // 2%
  autoPauseEnabled: true,
  autoPauseVolatilityThreshold: 10, // 10% ATR
  autoResumeEnabled: true,
  autoResumeVolatilityThreshold: 5, // 5% ATR
};

// ==================== DYNAMIC ADJUSTER CLASS ====================

export class DynamicGridAdjuster extends EventEmitter {
  private config: DynamicAdjusterConfig;
  private state: DynamicAdjusterState;
  private candles: Candle[] = [];
  private srLevels: SupportResistanceLevel[] = [];
  private currentPrice: number = 0;
  private gridUpperPrice: number = 0;
  private gridLowerPrice: number = 0;
  private gridCount: number = 0;
  private gridCenter: number = 0;
  private baseAtr: number = 0;
  
  constructor(config: Partial<DynamicAdjusterConfig> = {}) {
    super();
    this.config = { ...DEFAULT_DYNAMIC_ADJUSTER_CONFIG, ...config };
    this.state = {
      lastAdjustmentAt: null,
      adjustmentCount: 0,
      trailingActivated: false,
      trailingHighestPrice: 0,
      trailingLowestPrice: Infinity,
      isPaused: false,
      pauseReason: null,
      adjustmentHistory: [],
    };
  }

  // ==================== INITIALIZATION ====================

  /**
   * Initialize the adjuster with grid parameters and historical data
   */
  initialize(
    upperPrice: number,
    lowerPrice: number,
    gridCount: number,
    candles: Candle[]
  ): void {
    this.gridUpperPrice = upperPrice;
    this.gridLowerPrice = lowerPrice;
    this.gridCount = gridCount;
    this.gridCenter = (upperPrice + lowerPrice) / 2;
    this.candles = candles;
    
    // Calculate base ATR
    if (candles.length >= this.config.atrPeriod) {
      this.baseAtr = this.calculateATR(candles, this.config.atrPeriod);
    }
    
    // Detect support/resistance levels
    if (this.config.srDetectionEnabled && candles.length >= this.config.srLookbackPeriod) {
      this.srLevels = this.detectSupportResistance(candles);
    }
    
    this.emit('initialized', {
      upperPrice,
      lowerPrice,
      gridCount,
      baseAtr: this.baseAtr,
      srLevels: this.srLevels.length,
    });
  }

  /**
   * Update with new price data
   */
  updatePrice(price: number): void {
    this.currentPrice = price;
    
    // Update trailing extremes
    if (price > this.state.trailingHighestPrice) {
      this.state.trailingHighestPrice = price;
    }
    if (price < this.state.trailingLowestPrice) {
      this.state.trailingLowestPrice = price;
    }
  }

  /**
   * Add new candle and update calculations
   */
  addCandle(candle: Candle): void {
    this.candles.push(candle);
    
    // Keep only recent candles
    const maxCandles = Math.max(this.config.atrPeriod, this.config.srLookbackPeriod) * 2;
    if (this.candles.length > maxCandles) {
      this.candles = this.candles.slice(-maxCandles);
    }
    
    // Update S/R levels periodically
    if (this.config.srDetectionEnabled && this.candles.length % 10 === 0) {
      this.srLevels = this.detectSupportResistance(this.candles);
    }
  }

  // ==================== ATR CALCULATIONS ====================

  /**
   * Calculate Average True Range
   */
  calculateATR(candles: Candle[], period: number): number {
    if (candles.length < period + 1) return 0;
    
    const trueRanges: number[] = [];
    
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      
      trueRanges.push(tr);
    }
    
    const recentRanges = trueRanges.slice(-period);
    return recentRanges.reduce((sum, tr) => sum + tr, 0) / recentRanges.length;
  }

  /**
   * Get ATR as percentage of price
   */
  getATRPercent(): number {
    if (this.currentPrice === 0 || this.baseAtr === 0) return 0;
    return (this.baseAtr / this.currentPrice) * 100;
  }

  /**
   * Get current volatility state
   */
  getVolatilityState(): 'low' | 'normal' | 'high' | 'extreme' {
    const currentAtr = this.calculateATR(this.candles, this.config.atrPeriod);
    if (currentAtr === 0 || this.baseAtr === 0) return 'normal';
    
    const ratio = currentAtr / this.baseAtr;
    
    if (ratio < 0.5) return 'low';
    if (ratio < 1.5) return 'normal';
    if (ratio < 2.5) return 'high';
    return 'extreme';
  }

  // ==================== SUPPORT/RESISTANCE DETECTION ====================

  /**
   * Detect support and resistance levels
   */
  detectSupportResistance(candles: Candle[]): SupportResistanceLevel[] {
    const levels: SupportResistanceLevel[] = [];
    const lookback = Math.min(this.config.srLookbackPeriod, candles.length);
    const recentCandles = candles.slice(-lookback);
    
    // Find local highs and lows
    const tolerance = 0.002; // 0.2% tolerance for clustering
    
    for (let i = 2; i < recentCandles.length - 2; i++) {
      const candle = recentCandles[i];
      
      // Local high (resistance)
      if (
        candle.high > recentCandles[i - 1].high &&
        candle.high > recentCandles[i - 2].high &&
        candle.high > recentCandles[i + 1].high &&
        candle.high > recentCandles[i + 2].high
      ) {
        this.addOrUpdateLevel(levels, candle.high, 'resistance', tolerance);
      }
      
      // Local low (support)
      if (
        candle.low < recentCandles[i - 1].low &&
        candle.low < recentCandles[i - 2].low &&
        candle.low < recentCandles[i + 1].low &&
        candle.low < recentCandles[i + 2].low
      ) {
        this.addOrUpdateLevel(levels, candle.low, 'support', tolerance);
      }
    }
    
    // Sort by strength and filter
    return levels
      .filter(l => l.strength >= 2)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 10);
  }

  /**
   * Add or update a support/resistance level
   */
  private addOrUpdateLevel(
    levels: SupportResistanceLevel[],
    price: number,
    type: 'support' | 'resistance',
    tolerance: number
  ): void {
    const existingLevel = levels.find(
      l => l.type === type && Math.abs(l.price - price) / l.price < tolerance
    );
    
    if (existingLevel) {
      existingLevel.touches++;
      existingLevel.strength = Math.min(10, existingLevel.touches * 2);
      existingLevel.lastTouch = new Date();
      existingLevel.price = (existingLevel.price + price) / 2; // Average
    } else {
      levels.push({
        price,
        type,
        strength: 2,
        touches: 1,
        lastTouch: new Date(),
      });
    }
  }

  /**
   * Find nearest support and resistance levels
   */
  findNearestSR(): { support: SupportResistanceLevel | null; resistance: SupportResistanceLevel | null } {
    const supportLevels = this.srLevels
      .filter(l => l.type === 'support' && l.price < this.currentPrice)
      .sort((a, b) => b.price - a.price);
    
    const resistanceLevels = this.srLevels
      .filter(l => l.type === 'resistance' && l.price > this.currentPrice)
      .sort((a, b) => a.price - b.price);
    
    return {
      support: supportLevels[0] || null,
      resistance: resistanceLevels[0] || null,
    };
  }

  // ==================== GRID SPACING CALCULATION ====================

  /**
   * Calculate optimal grid spacing based on ATR
   */
  calculateATRBasedSpacing(): number {
    const currentAtr = this.calculateATR(this.candles, this.config.atrPeriod);
    return currentAtr * this.config.atrMultiplier;
  }

  /**
   * Adjust grid levels to avoid S/R zones
   */
  adjustLevelsForSR(levels: number[]): number[] {
    if (!this.config.srDetectionEnabled || this.srLevels.length === 0) {
      return levels;
    }
    
    const minDistance = this.currentPrice * (this.config.srMinDistancePercent / 100);
    
    return levels.map(price => {
      for (const sr of this.srLevels) {
        const distance = Math.abs(price - sr.price);
        
        // If level is too close to S/R, shift it
        if (distance < minDistance) {
          const shift = minDistance - distance;
          // Shift away from S/R
          if (sr.type === 'support' && price < sr.price) {
            return price - shift;
          } else if (sr.type === 'support' && price > sr.price) {
            return price + shift;
          } else if (sr.type === 'resistance' && price > sr.price) {
            return price + shift;
          } else {
            return price - shift;
          }
        }
      }
      return price;
    });
  }

  // ==================== MAIN ADJUSTMENT LOGIC ====================

  /**
   * Check if adjustment is needed and perform it
   */
  checkAndAdjust(
    currentPrice: number,
    filledLevels: number,
    totalLevels: number
  ): GridAdjustmentResult | null {
    if (!this.config.enabled) return null;
    
    this.currentPrice = currentPrice;
    
    // Check adjustment interval
    if (this.state.lastAdjustmentAt) {
      const timeSinceLastAdjustment = Date.now() - this.state.lastAdjustmentAt.getTime();
      if (timeSinceLastAdjustment < this.config.adjustmentInterval) {
        return null;
      }
    }
    
    // Calculate metrics
    const metrics = this.calculateMetrics(filledLevels, totalLevels);
    
    // Check for auto pause/resume
    if (this.checkAutoPauseResume(metrics)) {
      return null;
    }
    
    // Check for price outside grid
    if (this.isPriceOutsideGrid(currentPrice)) {
      return this.performRebalance(currentPrice, 'price_outside_grid', metrics);
    }
    
    // Check for trailing activation
    if (this.config.trailingEnabled && this.shouldActivateTrailing(currentPrice)) {
      this.state.trailingActivated = true;
      this.emit('trailing_activated', { price: currentPrice });
    }
    
    // Execute trailing if active
    if (this.state.trailingActivated) {
      const trailingResult = this.executeTrailing(currentPrice, metrics);
      if (trailingResult) return trailingResult;
    }
    
    // Check for volatility-based adjustment
    const volatilityResult = this.checkVolatilityAdjustment(metrics);
    if (volatilityResult) return volatilityResult;
    
    // Check for S/R proximity adjustment
    const srResult = this.checkSRAdjustment(metrics);
    if (srResult) return srResult;
    
    return null;
  }

  /**
   * Calculate current adjustment metrics
   */
  private calculateMetrics(filledLevels: number, totalLevels: number): AdjustmentMetrics {
    const atr = this.calculateATR(this.candles, this.config.atrPeriod);
    const atrPercent = this.getATRPercent();
    const volatilityState = this.getVolatilityState();
    
    // Price position within grid (0 = at lower, 1 = at upper)
    const gridWidth = this.gridUpperPrice - this.gridLowerPrice;
    const pricePosition = gridWidth > 0 
      ? (this.currentPrice - this.gridLowerPrice) / gridWidth 
      : 0.5;
    
    // Distance to nearest S/R
    const nearestSR = this.findNearestSR();
    const distanceToSupport = nearestSR.support 
      ? ((this.currentPrice - nearestSR.support.price) / this.currentPrice) * 100 
      : Infinity;
    const distanceToResistance = nearestSR.resistance 
      ? ((nearestSR.resistance.price - this.currentPrice) / this.currentPrice) * 100 
      : Infinity;
    
    return {
      atr,
      atrPercent,
      volatilityState,
      pricePosition,
      distanceToSupport,
      distanceToResistance,
      gridUtilization: totalLevels > 0 ? (filledLevels / totalLevels) * 100 : 0,
    };
  }

  /**
   * Check and handle auto pause/resume
   */
  private checkAutoPauseResume(metrics: AdjustmentMetrics): boolean {
    // Auto pause on extreme volatility
    if (this.config.autoPauseEnabled && !this.state.isPaused) {
      if (metrics.atrPercent > this.config.autoPauseVolatilityThreshold) {
        this.state.isPaused = true;
        this.state.pauseReason = 'extreme_volatility';
        this.emit('paused', { reason: 'extreme_volatility', metrics });
        return true;
      }
    }
    
    // Auto resume when volatility normalizes
    if (this.config.autoResumeEnabled && this.state.isPaused) {
      if (metrics.atrPercent < this.config.autoResumeVolatilityThreshold) {
        this.state.isPaused = false;
        this.state.pauseReason = null;
        this.emit('resumed', { metrics });
        return false;
      }
      return true;
    }
    
    return this.state.isPaused;
  }

  /**
   * Check if price is outside grid range
   */
  private isPriceOutsideGrid(price: number): boolean {
    return price > this.gridUpperPrice || price < this.gridLowerPrice;
  }

  /**
   * Perform grid rebalance
   */
  private performRebalance(
    currentPrice: number,
    reason: string,
    metrics: AdjustmentMetrics
  ): GridAdjustmentResult {
    const oldUpper = this.gridUpperPrice;
    const oldLower = this.gridLowerPrice;
    const gridWidth = oldUpper - oldLower;
    
    // Center grid on current price
    const newCenter = currentPrice;
    const newUpper = newCenter + gridWidth / 2;
    const newLower = newCenter - gridWidth / 2;
    
    // Adjust grid count based on volatility
    const volatilityState = metrics.volatilityState;
    let newGridCount = this.gridCount;
    
    if (volatilityState === 'high' || volatilityState === 'extreme') {
      // Fewer levels in high volatility (wider spacing)
      newGridCount = Math.max(5, Math.floor(this.gridCount * 0.8));
    } else if (volatilityState === 'low') {
      // More levels in low volatility (tighter spacing)
      newGridCount = Math.min(50, Math.floor(this.gridCount * 1.2));
    }
    
    // Update internal state
    this.gridUpperPrice = newUpper;
    this.gridLowerPrice = newLower;
    this.gridCenter = newCenter;
    this.gridCount = newGridCount;
    
    const result: GridAdjustmentResult = {
      adjusted: true,
      reason,
      oldUpperPrice: oldUpper,
      oldLowerPrice: oldLower,
      newUpperPrice: newUpper,
      newLowerPrice: newLower,
      oldGridCount: this.gridCount,
      newGridCount,
      timestamp: new Date(),
      metrics,
    };
    
    this.state.lastAdjustmentAt = new Date();
    this.state.adjustmentCount++;
    this.state.adjustmentHistory.push(result);
    
    this.emit('rebalanced', result);
    
    return result;
  }

  /**
   * Check if trailing should be activated
   */
  private shouldActivateTrailing(price: number): boolean {
    if (this.state.trailingActivated) return false;
    
    // Calculate distance from center
    const distanceFromCenter = Math.abs(price - this.gridCenter);
    const threshold = this.gridCenter * (this.config.trailingActivationThreshold / 100);
    
    return distanceFromCenter >= threshold;
  }

  /**
   * Execute trailing grid adjustment
   */
  private executeTrailing(price: number, metrics: AdjustmentMetrics): GridAdjustmentResult | null {
    const trailingDistance = price * (this.config.trailingDistance / 100);
    
    // Check if we need to trail up
    if (price > this.gridCenter + trailingDistance) {
      const shift = price - this.gridCenter - trailingDistance;
      return this.shiftGrid(shift, 'trailing_up', metrics);
    }
    
    // Check if we need to trail down
    if (price < this.gridCenter - trailingDistance) {
      const shift = price - this.gridCenter + trailingDistance;
      return this.shiftGrid(shift, 'trailing_down', metrics);
    }
    
    return null;
  }

  /**
   * Shift grid by a given amount
   */
  private shiftGrid(
    shift: number,
    reason: string,
    metrics: AdjustmentMetrics
  ): GridAdjustmentResult {
    const oldUpper = this.gridUpperPrice;
    const oldLower = this.gridLowerPrice;
    
    this.gridUpperPrice += shift;
    this.gridLowerPrice += shift;
    this.gridCenter += shift;
    
    const result: GridAdjustmentResult = {
      adjusted: true,
      reason,
      oldUpperPrice: oldUpper,
      oldLowerPrice: oldLower,
      newUpperPrice: this.gridUpperPrice,
      newLowerPrice: this.gridLowerPrice,
      oldGridCount: this.gridCount,
      newGridCount: this.gridCount,
      timestamp: new Date(),
      metrics,
    };
    
    this.state.lastAdjustmentAt = new Date();
    this.state.adjustmentCount++;
    this.state.adjustmentHistory.push(result);
    
    this.emit('trailed', result);
    
    return result;
  }

  /**
   * Check for volatility-based adjustment
   */
  private checkVolatilityAdjustment(metrics: AdjustmentMetrics): GridAdjustmentResult | null {
    const currentAtr = metrics.atr;
    
    if (this.baseAtr === 0 || currentAtr === 0) return null;
    
    const atrRatio = currentAtr / this.baseAtr;
    
    // Significant volatility change
    if (atrRatio > 1.5 || atrRatio < 0.67) {
      // Adjust grid width based on volatility change
      const widthMultiplier = atrRatio > 1.5 ? 1.2 : 0.85;
      
      const oldUpper = this.gridUpperPrice;
      const oldLower = this.gridLowerPrice;
      const oldWidth = oldUpper - oldLower;
      const newWidth = oldWidth * widthMultiplier;
      
      this.gridUpperPrice = this.gridCenter + newWidth / 2;
      this.gridLowerPrice = this.gridCenter - newWidth / 2;
      
      const result: GridAdjustmentResult = {
        adjusted: true,
        reason: atrRatio > 1.5 ? 'volatility_increase' : 'volatility_decrease',
        oldUpperPrice: oldUpper,
        oldLowerPrice: oldLower,
        newUpperPrice: this.gridUpperPrice,
        newLowerPrice: this.gridLowerPrice,
        oldGridCount: this.gridCount,
        newGridCount: this.gridCount,
        timestamp: new Date(),
        metrics,
      };
      
      this.state.lastAdjustmentAt = new Date();
      this.state.adjustmentCount++;
      this.state.adjustmentHistory.push(result);
      
      // Update base ATR
      this.baseAtr = currentAtr;
      
      this.emit('volatility_adjusted', result);
      
      return result;
    }
    
    return null;
  }

  /**
   * Check for S/R proximity adjustment
   */
  private checkSRAdjustment(metrics: AdjustmentMetrics): GridAdjustmentResult | null {
    if (!this.config.srDetectionEnabled) return null;
    
    const nearestSR = this.findNearestSR();
    const significantDistance = this.currentPrice * 0.01; // 1%
    
    // Check if grid boundary is too close to strong S/R
    if (nearestSR.resistance && nearestSR.resistance.strength >= 5) {
      const distanceToUpperSR = nearestSR.resistance.price - this.gridUpperPrice;
      
      if (Math.abs(distanceToUpperSR) < significantDistance) {
        // Shift upper boundary away from resistance
        const oldUpper = this.gridUpperPrice;
        this.gridUpperPrice = nearestSR.resistance.price + significantDistance;
        
        const result: GridAdjustmentResult = {
          adjusted: true,
          reason: 'avoid_resistance',
          oldUpperPrice: oldUpper,
          oldLowerPrice: this.gridLowerPrice,
          newUpperPrice: this.gridUpperPrice,
          newLowerPrice: this.gridLowerPrice,
          oldGridCount: this.gridCount,
          newGridCount: this.gridCount,
          timestamp: new Date(),
          metrics,
        };
        
        this.state.lastAdjustmentAt = new Date();
        this.state.adjustmentCount++;
        this.state.adjustmentHistory.push(result);
        
        this.emit('sr_adjusted', result);
        
        return result;
      }
    }
    
    if (nearestSR.support && nearestSR.support.strength >= 5) {
      const distanceToLowerSR = this.gridLowerPrice - nearestSR.support.price;
      
      if (Math.abs(distanceToLowerSR) < significantDistance) {
        // Shift lower boundary away from support
        const oldLower = this.gridLowerPrice;
        this.gridLowerPrice = nearestSR.support.price - significantDistance;
        
        const result: GridAdjustmentResult = {
          adjusted: true,
          reason: 'avoid_support',
          oldUpperPrice: this.gridUpperPrice,
          oldLowerPrice: oldLower,
          newUpperPrice: this.gridUpperPrice,
          newLowerPrice: this.gridLowerPrice,
          oldGridCount: this.gridCount,
          newGridCount: this.gridCount,
          timestamp: new Date(),
          metrics,
        };
        
        this.state.lastAdjustmentAt = new Date();
        this.state.adjustmentCount++;
        this.state.adjustmentHistory.push(result);
        
        this.emit('sr_adjusted', result);
        
        return result;
      }
    }
    
    return null;
  }

  // ==================== MANUAL CONTROLS ====================

  /**
   * Manually trigger grid adjustment
   */
  manualAdjust(
    newUpperPrice?: number,
    newLowerPrice?: number,
    newGridCount?: number,
    reason: string = 'manual_adjustment'
  ): GridAdjustmentResult {
    const metrics = this.calculateMetrics(0, this.gridCount);
    
    const oldUpper = this.gridUpperPrice;
    const oldLower = this.gridLowerPrice;
    const oldCount = this.gridCount;
    
    if (newUpperPrice !== undefined) this.gridUpperPrice = newUpperPrice;
    if (newLowerPrice !== undefined) this.gridLowerPrice = newLowerPrice;
    if (newGridCount !== undefined) this.gridCount = newGridCount;
    
    this.gridCenter = (this.gridUpperPrice + this.gridLowerPrice) / 2;
    
    const result: GridAdjustmentResult = {
      adjusted: true,
      reason,
      oldUpperPrice: oldUpper,
      oldLowerPrice: oldLower,
      newUpperPrice: this.gridUpperPrice,
      newLowerPrice: this.gridLowerPrice,
      oldGridCount: oldCount,
      newGridCount: this.gridCount,
      timestamp: new Date(),
      metrics,
    };
    
    this.state.lastAdjustmentAt = new Date();
    this.state.adjustmentCount++;
    this.state.adjustmentHistory.push(result);
    
    this.emit('manual_adjusted', result);
    
    return result;
  }

  /**
   * Pause grid adjustments
   */
  pause(reason: string = 'manual'): void {
    this.state.isPaused = true;
    this.state.pauseReason = reason;
    this.emit('paused', { reason });
  }

  /**
   * Resume grid adjustments
   */
  resume(): void {
    this.state.isPaused = false;
    this.state.pauseReason = null;
    this.emit('resumed', {});
  }

  // ==================== GETTERS ====================

  getState(): DynamicAdjusterState {
    return { ...this.state };
  }

  getConfig(): DynamicAdjusterConfig {
    return { ...this.config };
  }

  getSRLevels(): SupportResistanceLevel[] {
    return [...this.srLevels];
  }

  getCurrentGridParams(): { upperPrice: number; lowerPrice: number; gridCount: number; center: number } {
    return {
      upperPrice: this.gridUpperPrice,
      lowerPrice: this.gridLowerPrice,
      gridCount: this.gridCount,
      center: this.gridCenter,
    };
  }

  getAdjustmentHistory(limit: number = 50): GridAdjustmentResult[] {
    return this.state.adjustmentHistory.slice(-limit);
  }

  isAdjustmentPaused(): boolean {
    return this.state.isPaused;
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Create a dynamic grid adjuster with default settings
 */
export function createDynamicAdjuster(
  config?: Partial<DynamicAdjusterConfig>
): DynamicGridAdjuster {
  return new DynamicGridAdjuster(config);
}

/**
 * Calculate optimal ATR multiplier based on market conditions
 */
export function calculateOptimalATRMultiplier(
  volatilityState: 'low' | 'normal' | 'high' | 'extreme'
): number {
  switch (volatilityState) {
    case 'low':
      return 0.5;
    case 'normal':
      return 1.0;
    case 'high':
      return 1.5;
    case 'extreme':
      return 2.0;
    default:
      return 1.0;
  }
}
