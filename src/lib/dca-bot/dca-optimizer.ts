/**
 * DCA Bot Optimizer
 * 
 * Optimizes DCA parameters based on market conditions and volatility.
 * 
 * Features:
 * - Optimal number of DCA levels
 * - Optimal price drop percentages
 * - Risk/reward optimization
 * - Martingale coefficient adjustment
 * - Backtesting support
 */

import { VolatilityLevel, VolatilityScaler, DEFAULT_VOLATILITY_CONFIG } from './volatility-scaler';

// ==================== TYPES ====================

export interface DCAOptimizationParams {
  availableCapital: number;
  riskTolerance: 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';
  targetProfitPercent: number;
  maxDrawdownPercent: number;
  volatilityLevel: VolatilityLevel;
  atrPercent: number;
  currentPrice: number;
}

export interface OptimizedDCAConfig {
  baseAmount: number;
  dcaLevels: number;
  dcaPercent: number;
  dcaMultiplier: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  maxSafetyOrders: number;
  
  // Calculated metrics
  totalPotentialInvestment: number;
  averageEntryAtMaxLevels: number;
  breakEvenPrice: number;
  riskRewardRatio: number;
  
  // Recommendations
  confidence: number;
  reasoning: string;
  warnings: string[];
}

export interface MartingaleConfig {
  enabled: boolean;
  initialMultiplier: number;
  maxMultiplier: number;
  multiplierStep: number;
  useVolatilityAdjustment: boolean;
}

export interface LevelOptimization {
  level: number;
  triggerPercent: number;
  amountMultiplier: number;
  cumulativeInvestment: number;
  avgEntryAfterLevel: number;
  breakEvenPercent: number;
}

export interface RiskRewardAnalysis {
  bestCase: {
    profit: number;
    profitPercent: number;
    levelsUsed: number;
  };
  worstCase: {
    loss: number;
    lossPercent: number;
    levelsUsed: number;
  };
  expectedCase: {
    profit: number;
    profitPercent: number;
    levelsUsed: number;
    probability: number;
  };
  riskRewardRatio: number;
  maxDrawdownAtTarget: number;
}

// ==================== DEFAULT CONFIGS ====================

export const DEFAULT_MARTINGALE_CONFIG: MartingaleConfig = {
  enabled: true,
  initialMultiplier: 1.0,
  maxMultiplier: 5.0,
  multiplierStep: 0.5,
  useVolatilityAdjustment: true,
};

// ==================== OPTIMIZER CLASS ====================

export class DCAOptimizer {
  private volatilityScaler: VolatilityScaler | null = null;
  private martingaleConfig: MartingaleConfig;

  constructor(
    volatilityScaler?: VolatilityScaler,
    martingaleConfig?: Partial<MartingaleConfig>
  ) {
    this.volatilityScaler = volatilityScaler || null;
    this.martingaleConfig = { ...DEFAULT_MARTINGALE_CONFIG, ...martingaleConfig };
  }

  // ==================== MAIN OPTIMIZATION ====================

  /**
   * Optimize DCA parameters based on current conditions
   */
  optimize(params: DCAOptimizationParams): OptimizedDCAConfig {
    const {
      availableCapital,
      riskTolerance,
      targetProfitPercent,
      maxDrawdownPercent,
      volatilityLevel,
      atrPercent,
      currentPrice,
    } = params;
    
    const warnings: string[] = [];
    
    // Get base parameters based on risk tolerance
    const baseParams = this.getBaseParamsForRiskTolerance(riskTolerance);
    
    // Adjust for volatility
    const volatilityAdjustments = this.adjustForVolatility(
      baseParams,
      volatilityLevel,
      atrPercent
    );
    
    // Calculate optimal number of levels
    const optimalLevels = this.calculateOptimalLevels(
      availableCapital,
      volatilityAdjustments.baseAmount,
      volatilityAdjustments.dcaMultiplier,
      volatilityLevel
    );
    
    // Calculate optimal price drop percentage
    const optimalDcaPercent = this.calculateOptimalDcaPercent(
      volatilityLevel,
      atrPercent,
      riskTolerance
    );
    
    // Calculate take profit and stop loss
    const { takeProfitPercent, stopLossPercent } = this.calculateTPSL(
      targetProfitPercent,
      maxDrawdownPercent,
      volatilityLevel,
      optimalDcaPercent
    );
    
    // Calculate total investment and metrics
    const levels = this.calculateLevelDetails(
      currentPrice,
      volatilityAdjustments.baseAmount,
      optimalDcaPercent,
      optimalLevels,
      volatilityAdjustments.dcaMultiplier
    );
    
    const lastLevel = levels[levels.length - 1];
    const totalInvestment = lastLevel.cumulativeInvestment;
    
    // Calculate break-even
    const breakEvenPrice = lastLevel.avgEntryAfterLevel;
    const breakEvenPercent = ((currentPrice - breakEvenPrice) / currentPrice) * 100;
    
    // Risk/Reward analysis
    const riskReward = this.analyzeRiskReward(
      currentPrice,
      levels,
      takeProfitPercent,
      stopLossPercent
    );
    
    // Generate warnings
    if (totalInvestment > availableCapital * 0.8) {
      warnings.push(`Total investment (${totalInvestment.toFixed(2)} USDT) exceeds 80% of available capital`);
    }
    
    if (riskReward.riskRewardRatio < 1.5) {
      warnings.push(`Risk/Reward ratio (${riskReward.riskRewardRatio.toFixed(2)}) is below recommended 1.5`);
    }
    
    if (volatilityLevel === 'EXTREME') {
      warnings.push('Extreme volatility detected - consider reducing position sizes');
    }
    
    // Calculate confidence
    const confidence = this.calculateConfidence(
      volatilityLevel,
      riskReward.riskRewardRatio,
      totalInvestment / availableCapital
    );
    
    return {
      baseAmount: volatilityAdjustments.baseAmount,
      dcaLevels: optimalLevels,
      dcaPercent: optimalDcaPercent,
      dcaMultiplier: volatilityAdjustments.dcaMultiplier,
      takeProfitPercent,
      stopLossPercent,
      maxSafetyOrders: Math.min(optimalLevels, this.getMaxSafetyOrders(volatilityLevel)),
      totalPotentialInvestment: totalInvestment,
      averageEntryAtMaxLevels: breakEvenPrice,
      breakEvenPrice,
      riskRewardRatio: riskReward.riskRewardRatio,
      confidence,
      reasoning: this.generateReasoning(volatilityLevel, riskTolerance, riskReward),
      warnings,
    };
  }

  // ==================== PARAMETER CALCULATIONS ====================

  /**
   * Get base parameters for risk tolerance level
   */
  private getBaseParamsForRiskTolerance(riskTolerance: DCAOptimizationParams['riskTolerance']): {
    baseAmountPercent: number;
    dcaMultiplier: number;
    maxLevels: number;
  } {
    switch (riskTolerance) {
      case 'CONSERVATIVE':
        return {
          baseAmountPercent: 5,  // 5% of capital per trade
          dcaMultiplier: 1.3,    // Less aggressive averaging
          maxLevels: 3,
        };
      case 'AGGRESSIVE':
        return {
          baseAmountPercent: 15, // 15% of capital per trade
          dcaMultiplier: 2.0,    // More aggressive averaging
          maxLevels: 8,
        };
      default: // MODERATE
        return {
          baseAmountPercent: 10, // 10% of capital per trade
          dcaMultiplier: 1.5,
          maxLevels: 5,
        };
    }
  }

  /**
   * Adjust parameters based on volatility
   */
  private adjustForVolatility(
    baseParams: ReturnType<typeof this.getBaseParamsForRiskTolerance>,
    volatilityLevel: VolatilityLevel,
    atrPercent: number
  ): {
    baseAmount: number;
    dcaMultiplier: number;
  } {
    // Volatility-based adjustments
    const volConfig = DEFAULT_VOLATILITY_CONFIG;
    
    let sizeMultiplier = 1.0;
    let multiplierAdjustment = 1.0;
    
    switch (volatilityLevel) {
      case 'LOW':
        sizeMultiplier = volConfig.lowVolScaling;
        multiplierAdjustment = 0.9; // Less aggressive averaging in low vol
        break;
      case 'HIGH':
        sizeMultiplier = volConfig.highVolScaling;
        multiplierAdjustment = 1.2; // More aggressive averaging in high vol
        break;
      case 'EXTREME':
        sizeMultiplier = volConfig.extremeVolScaling;
        multiplierAdjustment = 1.5;
        break;
    }
    
    return {
      baseAmount: baseParams.baseAmountPercent * sizeMultiplier,
      dcaMultiplier: baseParams.dcaMultiplier * multiplierAdjustment,
    };
  }

  /**
   * Calculate optimal number of DCA levels
   */
  private calculateOptimalLevels(
    availableCapital: number,
    baseAmountPercent: number,
    dcaMultiplier: number,
    volatilityLevel: VolatilityLevel
  ): number {
    // Base levels calculation
    const baseLevels = Math.floor(100 / baseAmountPercent);
    
    // Adjust for multiplier
    let totalCapitalUsed = 0;
    let multiplier = 1;
    let levels = 0;
    
    while (levels < baseLevels && totalCapitalUsed < 80) { // Max 80% capital
      totalCapitalUsed += baseAmountPercent * multiplier;
      multiplier *= dcaMultiplier;
      levels++;
      
      // Limit multiplier growth
      if (multiplier > 10) break;
    }
    
    // Adjust for volatility
    if (volatilityLevel === 'EXTREME') {
      levels = Math.min(levels, 3); // Fewer levels in extreme vol
    } else if (volatilityLevel === 'HIGH') {
      levels = Math.min(levels, 5);
    }
    
    return Math.max(1, Math.min(levels, 10)); // 1-10 levels
  }

  /**
   * Calculate optimal price drop percentage
   */
  private calculateOptimalDcaPercent(
    volatilityLevel: VolatilityLevel,
    atrPercent: number,
    riskTolerance: DCAOptimizationParams['riskTolerance']
  ): number {
    // Base percentage from ATR
    const basePercent = atrPercent || 2; // Default 2% if no ATR
    
    // Adjust for volatility level
    const volConfig = DEFAULT_VOLATILITY_CONFIG;
    let spacingMultiplier = volConfig.normalVolSpacingMultiplier;
    
    switch (volatilityLevel) {
      case 'LOW':
        spacingMultiplier = volConfig.lowVolSpacingMultiplier;
        break;
      case 'HIGH':
        spacingMultiplier = volConfig.highVolSpacingMultiplier;
        break;
      case 'EXTREME':
        spacingMultiplier = volConfig.extremeVolSpacingMultiplier;
        break;
    }
    
    // Adjust for risk tolerance
    const riskMultiplier = riskTolerance === 'CONSERVATIVE' ? 0.8 :
                          riskTolerance === 'AGGRESSIVE' ? 1.3 : 1.0;
    
    // Calculate final percentage
    const dcaPercent = basePercent * spacingMultiplier * riskMultiplier;
    
    // Clamp to reasonable range
    return Math.max(1, Math.min(dcaPercent, 15)); // 1-15%
  }

  /**
   * Calculate Take Profit and Stop Loss
   */
  private calculateTPSL(
    targetProfitPercent: number,
    maxDrawdownPercent: number,
    volatilityLevel: VolatilityLevel,
    dcaPercent: number
  ): { takeProfitPercent: number; stopLossPercent: number } {
    // Adjust TP based on volatility
    let tpMultiplier = 1.0;
    let slMultiplier = 1.0;
    
    switch (volatilityLevel) {
      case 'LOW':
        tpMultiplier = 0.8; // Smaller TP targets
        slMultiplier = 0.8; // Tighter stops
        break;
      case 'HIGH':
        tpMultiplier = 1.3; // Larger TP targets
        slMultiplier = 1.2; // Wider stops
        break;
      case 'EXTREME':
        tpMultiplier = 1.5;
        slMultiplier = 1.5;
        break;
    }
    
    // Calculate TP and SL
    const takeProfitPercent = Math.max(
      targetProfitPercent * tpMultiplier,
      dcaPercent * 2 // TP should be at least 2x the DCA spacing
    );
    
    const stopLossPercent = Math.min(
      maxDrawdownPercent * slMultiplier,
      dcaPercent * 5 // Max 5x the DCA spacing
    );
    
    return { takeProfitPercent, stopLossPercent };
  }

  /**
   * Calculate detailed level information
   */
  calculateLevelDetails(
    entryPrice: number,
    baseAmount: number,
    dcaPercent: number,
    numLevels: number,
    dcaMultiplier: number
  ): LevelOptimization[] {
    const levels: LevelOptimization[] = [];
    let cumulativeInvestment = 0;
    let totalQuantity = 0;
    let currentMultiplier = 1;
    let lastTriggerPercent = 0;
    
    for (let i = 1; i <= numLevels; i++) {
      // Calculate progressive trigger percent
      const triggerPercent = lastTriggerPercent + dcaPercent * (1 + (i - 1) * 0.1);
      lastTriggerPercent = triggerPercent;
      
      // Calculate price at this level
      const price = entryPrice * (1 - triggerPercent / 100);
      
      // Calculate amount for this level
      const amount = baseAmount * currentMultiplier;
      const quantity = amount / price;
      
      // Update cumulative values
      cumulativeInvestment += amount;
      totalQuantity += quantity;
      
      // Calculate average entry after this level
      const avgEntry = cumulativeInvestment / totalQuantity;
      
      // Calculate break-even percent from original entry
      const breakEvenPercent = ((entryPrice - avgEntry) / entryPrice) * 100;
      
      levels.push({
        level: i,
        triggerPercent,
        amountMultiplier: currentMultiplier,
        cumulativeInvestment,
        avgEntryAfterLevel: avgEntry,
        breakEvenPercent,
      });
      
      // Update multiplier for next level
      currentMultiplier *= dcaMultiplier;
      
      // Cap multiplier
      if (currentMultiplier > this.martingaleConfig.maxMultiplier) {
        currentMultiplier = this.martingaleConfig.maxMultiplier;
      }
    }
    
    return levels;
  }

  /**
   * Analyze risk/reward scenarios
   */
  analyzeRiskReward(
    entryPrice: number,
    levels: LevelOptimization[],
    takeProfitPercent: number,
    stopLossPercent: number
  ): RiskRewardAnalysis {
    const lastLevel = levels[levels.length - 1];
    const totalInvestment = lastLevel.cumulativeInvestment;
    const avgEntry = lastLevel.avgEntryAfterLevel;
    
    // Best case: price recovers to TP after max DCA
    const tpPrice = avgEntry * (1 + takeProfitPercent / 100);
    const bestCaseProfit = (tpPrice - avgEntry) * (totalInvestment / avgEntry);
    const bestCaseProfitPercent = (bestCaseProfit / totalInvestment) * 100;
    
    // Worst case: price hits stop loss after max DCA
    const slPrice = entryPrice * (1 - stopLossPercent / 100);
    const worstCaseLoss = totalInvestment - (slPrice * (totalInvestment / avgEntry));
    const worstCaseLossPercent = (worstCaseLoss / totalInvestment) * 100;
    
    // Expected case: based on typical recovery patterns
    // Assuming 60% probability of recovery to 50% of TP
    const expectedProfitPercent = takeProfitPercent * 0.5;
    const expectedProfit = totalInvestment * (expectedProfitPercent / 100);
    const probability = 0.6; // 60% probability of partial recovery
    
    // Risk/Reward ratio
    const riskRewardRatio = bestCaseProfitPercent / worstCaseLossPercent;
    
    // Max drawdown at target (if price goes to TP from entry)
    const maxDrawdownAtTarget = lastLevel.breakEvenPercent;
    
    return {
      bestCase: {
        profit: bestCaseProfit,
        profitPercent: bestCaseProfitPercent,
        levelsUsed: levels.length,
      },
      worstCase: {
        loss: worstCaseLoss,
        lossPercent: worstCaseLossPercent,
        levelsUsed: levels.length,
      },
      expectedCase: {
        profit: expectedProfit,
        profitPercent: expectedProfitPercent,
        levelsUsed: Math.ceil(levels.length * 0.6),
        probability,
      },
      riskRewardRatio,
      maxDrawdownAtTarget,
    };
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(
    volatilityLevel: VolatilityLevel,
    riskRewardRatio: number,
    capitalUsagePercent: number
  ): number {
    let confidence = 1.0;
    
    // Reduce confidence based on volatility
    if (volatilityLevel === 'HIGH') {
      confidence *= 0.8;
    } else if (volatilityLevel === 'EXTREME') {
      confidence *= 0.5;
    }
    
    // Reduce confidence for poor risk/reward
    if (riskRewardRatio < 1.5) {
      confidence *= 0.7;
    } else if (riskRewardRatio > 3) {
      confidence *= 1.1; // Slight boost for excellent R:R
    }
    
    // Reduce confidence for high capital usage
    if (capitalUsagePercent > 0.8) {
      confidence *= 0.8;
    }
    
    return Math.min(1, Math.max(0.1, confidence));
  }

  /**
   * Generate reasoning string
   */
  private generateReasoning(
    volatilityLevel: VolatilityLevel,
    riskTolerance: DCAOptimizationParams['riskTolerance'],
    riskReward: RiskRewardAnalysis
  ): string {
    const parts: string[] = [];
    
    parts.push(`Optimized for ${riskTolerance.toLowerCase()} risk tolerance.`);
    parts.push(`Current volatility: ${volatilityLevel}.`);
    
    if (volatilityLevel === 'EXTREME') {
      parts.push('Reduced position sizes due to extreme market conditions.');
    } else if (volatilityLevel === 'HIGH') {
      parts.push('Adjusted parameters for elevated volatility.');
    }
    
    parts.push(`Risk/Reward ratio: ${riskReward.riskRewardRatio.toFixed(2)}.`);
    parts.push(`${(riskReward.expectedCase.probability * 100).toFixed(0)}% probability of ${riskReward.expectedCase.profitPercent.toFixed(1)}% profit.`);
    
    return parts.join(' ');
  }

  /**
   * Get max safety orders for volatility level
   */
  private getMaxSafetyOrders(volatilityLevel: VolatilityLevel): number {
    switch (volatilityLevel) {
      case 'EXTREME':
        return DEFAULT_VOLATILITY_CONFIG.maxSafetyOrdersInExtreme;
      case 'HIGH':
        return 5;
      case 'LOW':
        return 8;
      default:
        return 6;
    }
  }

  // ==================== MARTINGALE ADJUSTMENTS ====================

  /**
   * Calculate martingale multiplier for a level
   */
  calculateMartingaleMultiplier(
    level: number,
    volatilityLevel: VolatilityLevel
  ): number {
    if (!this.martingaleConfig.enabled) return 1;
    
    let multiplier = this.martingaleConfig.initialMultiplier;
    
    for (let i = 1; i < level; i++) {
      multiplier += this.martingaleConfig.multiplierStep;
    }
    
    // Volatility adjustment
    if (this.martingaleConfig.useVolatilityAdjustment) {
      switch (volatilityLevel) {
        case 'LOW':
          multiplier *= 0.9;
          break;
        case 'HIGH':
          multiplier *= 1.1;
          break;
        case 'EXTREME':
          multiplier *= 1.2;
          break;
      }
    }
    
    return Math.min(multiplier, this.martingaleConfig.maxMultiplier);
  }

  /**
   * Validate martingale settings
   */
  validateMartingaleConfig(): { valid: boolean; warnings: string[] } {
    const warnings: string[] = [];
    
    if (this.martingaleConfig.maxMultiplier > 10) {
      warnings.push('Martingale multiplier above 10x is extremely risky');
    }
    
    if (this.martingaleConfig.multiplierStep > 1) {
      warnings.push('High multiplier step may lead to rapid position size growth');
    }
    
    return {
      valid: warnings.length === 0,
      warnings,
    };
  }

  // ==================== SETTERS ====================

  setVolatilityScaler(scaler: VolatilityScaler): void {
    this.volatilityScaler = scaler;
  }

  updateMartingaleConfig(config: Partial<MartingaleConfig>): void {
    this.martingaleConfig = { ...this.martingaleConfig, ...config };
  }

  getMartingaleConfig(): MartingaleConfig {
    return { ...this.martingaleConfig };
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Create DCA optimizer with optional volatility scaler
 */
export function createDCAOptimizer(
  volatilityScaler?: VolatilityScaler,
  martingaleConfig?: Partial<MartingaleConfig>
): DCAOptimizer {
  return new DCAOptimizer(volatilityScaler, martingaleConfig);
}

/**
 * Quick optimization for given conditions
 */
export function quickOptimize(
  availableCapital: number,
  currentPrice: number,
  volatilityLevel: VolatilityLevel = 'NORMAL',
  atrPercent: number = 2,
  riskTolerance: DCAOptimizationParams['riskTolerance'] = 'MODERATE'
): OptimizedDCAConfig {
  const optimizer = new DCAOptimizer();
  
  return optimizer.optimize({
    availableCapital,
    riskTolerance,
    targetProfitPercent: 10,
    maxDrawdownPercent: 30,
    volatilityLevel,
    atrPercent,
    currentPrice,
  });
}

/**
 * Calculate optimal DCA spacing from ATR
 */
export function calculateOptimalSpacingFromATR(
  atr: number,
  price: number,
  riskMultiplier: number = 1.0
): number {
  const atrPercent = (atr / price) * 100;
  // Spacing should be 1-2x ATR for optimal DCA
  return atrPercent * riskMultiplier * 1.5;
}

/**
 * Estimate break-even price for DCA levels
 */
export function estimateBreakEven(
  entryPrice: number,
  dcaPercent: number,
  numLevels: number,
  dcaMultiplier: number
): { breakEvenPrice: number; breakEvenPercent: number; totalInvestment: number } {
  let totalInvestment = 0;
  let totalQuantity = 0;
  let multiplier = 1;
  
  for (let i = 0; i <= numLevels; i++) {
    const triggerPercent = dcaPercent * i * (1 + i * 0.1);
    const price = entryPrice * (1 - triggerPercent / 100);
    const amount = entryPrice * 0.1 * multiplier; // Assume 10% base
    const quantity = amount / price;
    
    totalInvestment += amount;
    totalQuantity += quantity;
    multiplier *= dcaMultiplier;
  }
  
  const breakEvenPrice = totalInvestment / totalQuantity;
  const breakEvenPercent = ((entryPrice - breakEvenPrice) / entryPrice) * 100;
  
  return { breakEvenPrice, breakEvenPercent, totalInvestment };
}
