/**
 * Grid Optimizer
 * 
 * Optimal grid parameters calculation and backtesting:
 * - Optimal grid count calculation
 * - Optimal price range detection
 * - Profit maximization logic
 * - Risk-adjusted grid spacing
 * - Backtesting grid parameters
 */

import { Candle } from '../strategy/types';

// ==================== TYPES ====================

export interface GridOptimizationConfig {
  /** Minimum grid count */
  minGridCount: number;
  /** Maximum grid count */
  maxGridCount: number;
  /** Minimum price range (%) */
  minPriceRangePercent: number;
  /** Maximum price range (%) */
  maxPriceRangePercent: number;
  /** Risk tolerance (1-10, higher = more aggressive) */
  riskTolerance: number;
  /** Target profit per grid (%) */
  targetProfitPerGrid: number;
  /** Fee rate per trade (e.g., 0.0004 = 0.04%) */
  feeRate: number;
  /** Slippage estimate per trade (%) */
  slippageEstimate: number;
  /** Minimum trades for valid backtest */
  minBacktestTrades: number;
  /** Backtest period (days) */
  backtestPeriod: number;
}

export interface OptimalGridParams {
  gridCount: number;
  upperPrice: number;
  lowerPrice: number;
  gridSpacing: number;
  gridSpacingPercent: number;
  expectedProfitPerGrid: number;
  expectedROI: number;
  riskScore: number; // 1-10
  confidence: number; // 0-1
  reasoning: string;
}

export interface BacktestResult {
  params: {
    gridCount: number;
    upperPrice: number;
    lowerPrice: number;
  };
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  totalPnLPercent: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  profitFactor: number;
  avgTradeDuration: number; // minutes
  gridUtilization: number; // % of levels triggered
  feeImpact: number;
  recommendation: 'excellent' | 'good' | 'fair' | 'poor';
}

export interface PriceRangeAnalysis {
  currentPrice: number;
  suggestedUpper: number;
  suggestedLower: number;
  rangePercent: number;
  volatilityAdjustedRange: number;
  supportsInRange: number[];
  resistancesInRange: number[];
  recommendation: string;
}

export interface RiskAdjustedSpacing {
  baseSpacing: number;
  adjustedSpacing: number;
  adjustmentFactor: number;
  volatilityAdjustment: number;
  liquidityAdjustment: number;
  srAdjustment: number;
  reasoning: string;
}

// ==================== CONSTANTS ====================

export const DEFAULT_OPTIMIZATION_CONFIG: GridOptimizationConfig = {
  minGridCount: 5,
  maxGridCount: 50,
  minPriceRangePercent: 2,
  maxPriceRangePercent: 30,
  riskTolerance: 5,
  targetProfitPerGrid: 0.5,
  feeRate: 0.0004,
  slippageEstimate: 0.01,
  minBacktestTrades: 10,
  backtestPeriod: 30,
};

// ==================== GRID OPTIMIZER CLASS ====================

export class GridOptimizer {
  private config: GridOptimizationConfig;
  private candles: Candle[] = [];
  
  constructor(config: Partial<GridOptimizationConfig> = {}) {
    this.config = { ...DEFAULT_OPTIMIZATION_CONFIG, ...config };
  }

  /**
   * Set historical candle data for analysis
   */
  setCandles(candles: Candle[]): void {
    this.candles = candles;
  }

  // ==================== OPTIMAL GRID COUNT ====================

  /**
   * Calculate optimal grid count based on market conditions
   */
  calculateOptimalGridCount(
    priceRange: number,
    currentPrice: number,
    volatility: number
  ): { count: number; reasoning: string } {
    // Base count on price range and volatility
    const rangePercent = (priceRange / currentPrice) * 100;
    
    // Adjust for volatility
    const volatilityFactor = volatility < 0.02 ? 1.2 : volatility < 0.05 ? 1.0 : 0.8;
    
    // Calculate base grid count
    // More grids for larger ranges, fewer for smaller
    let baseCount = Math.floor(rangePercent * 2 * volatilityFactor);
    
    // Adjust for target profit per grid
    const profitPerGridTarget = this.config.targetProfitPerGrid;
    const gridsNeededForTarget = Math.floor(rangePercent / profitPerGridTarget);
    
    // Balance between coverage and profitability
    const optimalCount = Math.floor((baseCount + gridsNeededForTarget) / 2);
    
    // Apply constraints
    const finalCount = Math.max(
      this.config.minGridCount,
      Math.min(this.config.maxGridCount, optimalCount)
    );
    
    let reasoning = `Range ${rangePercent.toFixed(1)}% with ${(volatility * 100).toFixed(1)}% volatility`;
    
    if (finalCount !== optimalCount) {
      if (finalCount === this.config.minGridCount) {
        reasoning += ` - constrained to minimum ${this.config.minGridCount}`;
      } else {
        reasoning += ` - constrained to maximum ${this.config.maxGridCount}`;
      }
    }
    
    return { count: finalCount, reasoning };
  }

  // ==================== OPTIMAL PRICE RANGE ====================

  /**
   * Analyze and suggest optimal price range
   */
  analyzeOptimalPriceRange(
    currentPrice: number,
    volatility: number,
    supportLevels: number[] = [],
    resistanceLevels: number[] = []
  ): PriceRangeAnalysis {
    // Calculate base range from volatility
    // Higher volatility = wider range
    const volatilityMultiplier = 2 + volatility * 10;
    const baseRangePercent = volatility * volatilityMultiplier * 100;
    
    // Apply constraints
    let rangePercent = Math.max(
      this.config.minPriceRangePercent,
      Math.min(this.config.maxPriceRangePercent, baseRangePercent)
    );
    
    // Calculate initial bounds
    let lowerPrice = currentPrice * (1 - rangePercent / 200);
    let upperPrice = currentPrice * (1 + rangePercent / 200);
    
    // Adjust for support/resistance levels
    const supportsInRange = supportLevels.filter(s => s >= lowerPrice && s <= currentPrice);
    const resistancesInRange = resistanceLevels.filter(r => r >= currentPrice && r <= upperPrice);
    
    // Extend range to include nearby S/R levels
    if (supportsInRange.length > 0) {
      const lowestSupport = Math.min(...supportsInRange);
      lowerPrice = Math.min(lowerPrice, lowestSupport * 0.99);
    }
    
    if (resistancesInRange.length > 0) {
      const highestResistance = Math.max(...resistancesInRange);
      upperPrice = Math.max(upperPrice, highestResistance * 1.01);
    }
    
    // Recalculate range percent
    rangePercent = ((upperPrice - lowerPrice) / currentPrice) * 100;
    
    // Volatility-adjusted range
    const volatilityAdjustedRange = volatility * currentPrice * 3;
    
    let recommendation = `Suggested range: ${rangePercent.toFixed(1)}%`;
    
    if (supportsInRange.length > 0 || resistancesInRange.length > 0) {
      recommendation += ` (adjusted for ${supportsInRange.length} support(s), ${resistancesInRange.length} resistance(s))`;
    }
    
    return {
      currentPrice,
      suggestedUpper: upperPrice,
      suggestedLower: lowerPrice,
      rangePercent,
      volatilityAdjustedRange,
      supportsInRange,
      resistancesInRange,
      recommendation,
    };
  }

  // ==================== PROFIT MAXIMIZATION ====================

  /**
   * Find parameters that maximize expected profit
   */
  maximizeProfit(
    currentPrice: number,
    volatility: number,
    investment: number,
    leverage: number = 1
  ): OptimalGridParams {
    // Analyze price range
    const rangeAnalysis = this.analyzeOptimalPriceRange(currentPrice, volatility);
    
    // Calculate optimal grid count
    const priceRange = rangeAnalysis.suggestedUpper - rangeAnalysis.suggestedLower;
    const gridCountResult = this.calculateOptimalGridCount(priceRange, currentPrice, volatility);
    
    // Calculate grid spacing
    const gridSpacing = priceRange / (gridCountResult.count - 1);
    const gridSpacingPercent = (gridSpacing / currentPrice) * 100;
    
    // Calculate expected profit per grid (accounting for fees and slippage)
    const feeImpact = this.config.feeRate * 2; // Entry + exit
    const slippageImpact = this.config.slippageEstimate * 2;
    const expectedProfitPerGrid = gridSpacingPercent - (feeImpact * 100) - slippageImpact;
    
    // Calculate expected ROI
    const avgGridsTriggeredPerCycle = gridCountResult.count * 0.3; // Estimate 30% utilization
    const cyclesPerDay = 1; // Conservative estimate
    const expectedDailyROI = (expectedProfitPerGrid * avgGridsTriggeredPerCycle * cyclesPerDay * leverage) / 100;
    const expectedROI = expectedDailyROI * 30; // Monthly
    
    // Calculate risk score
    const riskScore = this.calculateRiskScore(
      volatility,
      rangeAnalysis.rangePercent,
      gridCountResult.count,
      leverage
    );
    
    // Calculate confidence based on data quality
    const confidence = this.calculateConfidence(volatility, rangeAnalysis);
    
    return {
      gridCount: gridCountResult.count,
      upperPrice: rangeAnalysis.suggestedUpper,
      lowerPrice: rangeAnalysis.suggestedLower,
      gridSpacing,
      gridSpacingPercent,
      expectedProfitPerGrid,
      expectedROI,
      riskScore,
      confidence,
      reasoning: `${gridCountResult.reasoning}. Expected ${expectedProfitPerGrid.toFixed(2)}% profit per grid.`,
    };
  }

  /**
   * Calculate risk score (1-10, higher = riskier)
   */
  private calculateRiskScore(
    volatility: number,
    rangePercent: number,
    gridCount: number,
    leverage: number
  ): number {
    let score = 5; // Base score
    
    // Volatility impact
    if (volatility > 0.05) score += 2;
    else if (volatility > 0.03) score += 1;
    else if (volatility < 0.01) score -= 1;
    
    // Range impact
    if (rangePercent > 20) score += 1;
    else if (rangePercent < 5) score += 1; // Too tight is risky too
    
    // Grid count impact
    if (gridCount > 30) score -= 1; // More levels = more diversification
    else if (gridCount < 10) score += 1;
    
    // Leverage impact
    if (leverage > 5) score += 2;
    else if (leverage > 2) score += 1;
    
    return Math.max(1, Math.min(10, score));
  }

  /**
   * Calculate confidence in the optimization
   */
  private calculateConfidence(
    volatility: number,
    rangeAnalysis: PriceRangeAnalysis
  ): number {
    let confidence = 0.7; // Base confidence
    
    // More S/R levels = more confidence
    const srCount = rangeAnalysis.supportsInRange.length + rangeAnalysis.resistancesInRange.length;
    confidence += Math.min(0.15, srCount * 0.03);
    
    // Moderate volatility = more confidence
    if (volatility >= 0.01 && volatility <= 0.04) {
      confidence += 0.1;
    } else if (volatility > 0.06) {
      confidence -= 0.15;
    }
    
    // Reasonable range = more confidence
    if (rangeAnalysis.rangePercent >= 5 && rangeAnalysis.rangePercent <= 15) {
      confidence += 0.05;
    }
    
    return Math.max(0.3, Math.min(0.95, confidence));
  }

  // ==================== RISK-ADJUSTED SPACING ====================

  /**
   * Calculate risk-adjusted grid spacing
   */
  calculateRiskAdjustedSpacing(
    baseSpacing: number,
    volatility: number,
    liquidityScore: number, // 0-1
    nearSupportResistance: boolean
  ): RiskAdjustedSpacing {
    let adjustmentFactor = 1.0;
    const adjustments: { factor: number; reason: string }[] = [];
    
    // Volatility adjustment
    let volatilityAdjustment = 0;
    if (volatility > 0.05) {
      volatilityAdjustment = 0.3;
      adjustments.push({ factor: 1.3, reason: 'High volatility' });
    } else if (volatility > 0.03) {
      volatilityAdjustment = 0.15;
      adjustments.push({ factor: 1.15, reason: 'Moderate volatility' });
    } else if (volatility < 0.01) {
      volatilityAdjustment = -0.1;
      adjustments.push({ factor: 0.9, reason: 'Low volatility' });
    }
    
    // Liquidity adjustment
    let liquidityAdjustment = 0;
    if (liquidityScore < 0.3) {
      liquidityAdjustment = 0.2;
      adjustments.push({ factor: 1.2, reason: 'Low liquidity' });
    } else if (liquidityScore > 0.7) {
      liquidityAdjustment = -0.05;
      adjustments.push({ factor: 0.95, reason: 'High liquidity' });
    }
    
    // Support/Resistant proximity adjustment
    let srAdjustment = 0;
    if (nearSupportResistance) {
      srAdjustment = 0.15;
      adjustments.push({ factor: 1.15, reason: 'Near S/R level' });
    }
    
    // Calculate total adjustment
    adjustmentFactor = 1 + volatilityAdjustment + liquidityAdjustment + srAdjustment;
    
    const adjustedSpacing = baseSpacing * adjustmentFactor;
    
    const reasoning = adjustments.map(a => a.reason).join(', ') || 'No adjustments needed';
    
    return {
      baseSpacing,
      adjustedSpacing,
      adjustmentFactor,
      volatilityAdjustment,
      liquidityAdjustment,
      srAdjustment,
      reasoning,
    };
  }

  // ==================== BACKTESTING ====================

  /**
   * Run backtest with given parameters
   */
  backtest(
    candles: Candle[],
    params: {
      gridCount: number;
      upperPrice: number;
      lowerPrice: number;
      investment: number;
      leverage?: number;
    }
  ): BacktestResult {
    const { gridCount, upperPrice, lowerPrice, investment, leverage = 1 } = params;
    
    // Calculate grid levels
    const gridLevels: number[] = [];
    const step = (upperPrice - lowerPrice) / (gridCount - 1);
    for (let i = 0; i < gridCount; i++) {
      gridLevels.push(lowerPrice + step * i);
    }
    
    // Simulate trading
    const trades: {
      entryPrice: number;
      exitPrice: number;
      pnl: number;
      duration: number;
      isWin: boolean;
    }[] = [];
    
    const positionPerGrid = investment / gridCount;
    const levelsTriggered = new Set<number>();
    
    let currentPrice = candles[0]?.close || 0;
    
    // Track grid fills
    const gridFills = new Map<number, { filled: boolean; side: 'BUY' | 'SELL'; price: number; time: number }>();
    
    for (let i = 0; i < gridLevels.length; i++) {
      gridFills.set(i, { filled: false, side: 'BUY', price: 0, time: 0 });
    }
    
    // Simulate through candles
    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      const high = candle.high;
      const low = candle.low;
      
      // Check each grid level
      for (let g = 0; g < gridLevels.length; g++) {
        const level = gridLevels[g];
        const fill = gridFills.get(g)!;
        
        // Buy levels (lower half)
        if (g < gridCount / 2) {
          if (!fill.filled && low <= level) {
            fill.filled = true;
            fill.side = 'BUY';
            fill.price = level;
            fill.time = i;
            levelsTriggered.add(g);
          } else if (fill.filled && fill.side === 'BUY' && high >= level + step) {
            // Sell for profit
            const pnl = (level + step - fill.price) / fill.price * positionPerGrid * leverage;
            const fee = positionPerGrid * this.config.feeRate * 2;
            trades.push({
              entryPrice: fill.price,
              exitPrice: level + step,
              pnl: pnl - fee,
              duration: i - fill.time,
              isWin: pnl > fee,
            });
            fill.filled = false;
          }
        }
        
        // Sell levels (upper half)
        if (g >= gridCount / 2) {
          if (!fill.filled && high >= level) {
            fill.filled = true;
            fill.side = 'SELL';
            fill.price = level;
            fill.time = i;
            levelsTriggered.add(g);
          } else if (fill.filled && fill.side === 'SELL' && low <= level - step) {
            // Buy back for profit
            const pnl = (fill.price - (level - step)) / fill.price * positionPerGrid * leverage;
            const fee = positionPerGrid * this.config.feeRate * 2;
            trades.push({
              entryPrice: fill.price,
              exitPrice: level - step,
              pnl: pnl - fee,
              duration: i - fill.time,
              isWin: pnl > fee,
            });
            fill.filled = false;
          }
        }
      }
      
      currentPrice = candle.close;
    }
    
    // Calculate metrics
    const totalTrades = trades.length;
    const winningTrades = trades.filter(t => t.isWin).length;
    const losingTrades = totalTrades - winningTrades;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    
    const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
    const totalPnLPercent = (totalPnL / investment) * 100;
    
    // Calculate max drawdown
    let maxDrawdown = 0;
    let peak = 0;
    let runningPnL = 0;
    
    for (const trade of trades) {
      runningPnL += trade.pnl;
      if (runningPnL > peak) peak = runningPnL;
      const drawdown = peak - runningPnL;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    
    const maxDrawdownPercent = (maxDrawdown / investment) * 100;
    
    // Calculate Sharpe ratio (simplified)
    const avgPnL = totalTrades > 0 ? totalPnL / totalTrades : 0;
    const pnlStd = trades.length > 1
      ? Math.sqrt(trades.reduce((sum, t) => sum + Math.pow(t.pnl - avgPnL, 2), 0) / trades.length)
      : 0;
    const sharpeRatio = pnlStd > 0 ? (avgPnL / pnlStd) * Math.sqrt(365) : 0;
    
    // Calculate profit factor
    const grossProfit = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    
    // Calculate average trade duration
    const avgTradeDuration = trades.length > 0
      ? trades.reduce((sum, t) => sum + t.duration, 0) / trades.length
      : 0;
    
    // Grid utilization
    const gridUtilization = (levelsTriggered.size / gridCount) * 100;
    
    // Fee impact
    const totalFees = totalTrades * positionPerGrid * this.config.feeRate * 2;
    const feeImpact = totalTrades > 0 ? (totalFees / (totalPnL + totalFees)) * 100 : 0;
    
    // Determine recommendation
    let recommendation: 'excellent' | 'good' | 'fair' | 'poor';
    if (totalTrades < this.config.minBacktestTrades) {
      recommendation = 'poor';
    } else if (winRate >= 60 && totalPnLPercent > 10 && maxDrawdownPercent < 10) {
      recommendation = 'excellent';
    } else if (winRate >= 50 && totalPnLPercent > 5 && maxDrawdownPercent < 20) {
      recommendation = 'good';
    } else if (winRate >= 40 && totalPnLPercent > 0) {
      recommendation = 'fair';
    } else {
      recommendation = 'poor';
    }
    
    return {
      params: { gridCount, upperPrice, lowerPrice },
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      totalPnL,
      totalPnLPercent,
      maxDrawdown,
      maxDrawdownPercent,
      sharpeRatio,
      profitFactor,
      avgTradeDuration,
      gridUtilization,
      feeImpact,
      recommendation,
    };
  }

  /**
   * Optimize parameters through backtesting
   */
  optimizeViaBacktest(
    candles: Candle[],
    baseParams: {
      currentPrice: number;
      investment: number;
      leverage?: number;
    },
    searchSpace?: {
      gridCounts?: number[];
      rangePercents?: number[];
    }
  ): { bestParams: OptimalGridParams; bestBacktest: BacktestResult; allResults: BacktestResult[] } {
    const gridCounts = searchSpace?.gridCounts || [5, 7, 10, 15, 20, 25, 30];
    const rangePercents = searchSpace?.rangePercents || [3, 5, 8, 10, 15, 20];
    
    const results: { params: OptimalGridParams; backtest: BacktestResult }[] = [];
    
    for (const gridCount of gridCounts) {
      for (const rangePercent of rangePercents) {
        const halfRange = baseParams.currentPrice * (rangePercent / 200);
        const upperPrice = baseParams.currentPrice + halfRange;
        const lowerPrice = baseParams.currentPrice - halfRange;
        
        const backtestResult = this.backtest(candles, {
          gridCount,
          upperPrice,
          lowerPrice,
          investment: baseParams.investment,
          leverage: baseParams.leverage,
        });
        
        // Only consider results with enough trades
        if (backtestResult.totalTrades >= this.config.minBacktestTrades) {
          const params: OptimalGridParams = {
            gridCount,
            upperPrice,
            lowerPrice,
            gridSpacing: (upperPrice - lowerPrice) / (gridCount - 1),
            gridSpacingPercent: ((upperPrice - lowerPrice) / (gridCount - 1) / baseParams.currentPrice) * 100,
            expectedProfitPerGrid: backtestResult.totalPnLPercent / backtestResult.totalTrades,
            expectedROI: backtestResult.totalPnLPercent,
            riskScore: this.calculateRiskScore(0.03, rangePercent, gridCount, baseParams.leverage || 1),
            confidence: 0.7,
            reasoning: `Backtested with ${backtestResult.totalTrades} trades`,
          };
          
          results.push({ params, backtest: backtestResult });
        }
      }
    }
    
    // Sort by a combined score
    const scoredResults = results.map(r => ({
      ...r,
      score: this.calculateBacktestScore(r.backtest),
    }));
    
    scoredResults.sort((a, b) => b.score - a.score);
    
    const best = scoredResults[0];
    
    return {
      bestParams: best.params,
      bestBacktest: best.backtest,
      allResults: scoredResults.map(r => r.backtest),
    };
  }

  /**
   * Calculate score for backtest result
   */
  private calculateBacktestScore(result: BacktestResult): number {
    // Weight factors
    const winRateWeight = 0.25;
    const pnlWeight = 0.35;
    const drawdownWeight = 0.25;
    const utilizationWeight = 0.15;
    
    // Normalize metrics
    const winRateScore = result.winRate / 100;
    const pnlScore = Math.min(1, result.totalPnLPercent / 20); // Cap at 20%
    const drawdownScore = Math.max(0, 1 - result.maxDrawdownPercent / 30); // Penalize > 30%
    const utilizationScore = result.gridUtilization / 100;
    
    return (
      winRateScore * winRateWeight +
      pnlScore * pnlWeight +
      drawdownScore * drawdownWeight +
      utilizationScore * utilizationWeight
    );
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Create a grid optimizer with default settings
 */
export function createGridOptimizer(config?: Partial<GridOptimizationConfig>): GridOptimizer {
  return new GridOptimizer(config);
}

/**
 * Quick optimization for immediate use
 */
export function quickOptimize(
  currentPrice: number,
  volatility: number,
  investment: number,
  leverage: number = 1
): OptimalGridParams {
  const optimizer = new GridOptimizer();
  return optimizer.maximizeProfit(currentPrice, volatility, investment, leverage);
}
