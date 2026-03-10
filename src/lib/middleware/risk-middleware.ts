/**
 * Risk Middleware
 * 
 * Pre-execution risk checks and validation for trading operations
 * Integrates with all trade endpoints to enforce risk limits
 */

import { db } from '@/lib/db';
import { 
  validateTradeEntry, 
  validateSignal,
  type TradeEntryInput,
  type SignalInput,
} from '@/lib/validators/trade-validation';

// ==================== TYPES ====================

/**
 * Risk check result
 */
export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  warnings?: string[];
  adjustments?: RiskAdjustment[];
  metadata?: Record<string, unknown>;
}

/**
 * Risk adjustment suggestion
 */
export interface RiskAdjustment {
  field: string;
  originalValue: unknown;
  suggestedValue: unknown;
  reason: string;
}

/**
 * Risk configuration
 */
export interface RiskConfig {
  // Position limits
  maxPositionSize: number;         // Maximum position size in USD
  maxPositionPercent: number;      // Maximum % of portfolio per position
  maxOpenPositions: number;        // Maximum concurrent positions
  maxOpenPositionsPerSymbol: number;
  
  // Leverage limits
  maxLeverage: number;             // Maximum leverage allowed
  defaultLeverage: number;
  
  // Drawdown limits
  maxDailyDrawdown: number;        // Maximum daily drawdown %
  maxWeeklyDrawdown: number;       // Maximum weekly drawdown %
  maxMonthlyDrawdown: number;      // Maximum monthly drawdown %
  
  // Exposure limits
  maxExposurePercent: number;      // Maximum total exposure % of portfolio
  maxCorrelatedExposure: number;   // Maximum exposure to correlated assets
  
  // Order limits
  maxOrderValue: number;           // Maximum single order value
  minOrderValue: number;           // Minimum order value
  maxOrdersPerMinute: number;      // Rate limiting
  maxOrdersPerHour: number;
  
  // Stop loss requirements
  requireStopLoss: boolean;
  minStopLossPercent: number;      // Minimum distance from entry
  maxStopLossPercent: number;      // Maximum distance from entry
  
  // Take profit requirements
  requireTakeProfit: boolean;
  minTakeProfitPercent: number;
  maxTakeProfitTargets: number;
  
  // Time restrictions
  allowedTradingHours?: {
    start: number; // 0-23
    end: number;   // 0-23
  };
  tradingDays?: number[];          // 0-6 (Sunday-Saturday)
  
  // Exchange restrictions
  allowedExchanges: string[];
  blockedExchanges: string[];
  allowedSymbols: string[];
  blockedSymbols: string[];
  
  // Risk score thresholds
  maxRiskScore: number;            // 0-100
  requireConfirmationAbove: number;
  
  // Margin requirements
  minMarginReserve: number;        // Minimum margin reserve %
  maxMarginUsage: number;          // Maximum margin usage %
}

/**
 * Portfolio state
 */
export interface PortfolioState {
  totalEquity: number;
  availableMargin: number;
  usedMargin: number;
  unrealizedPnl: number;
  openPositions: number;
  totalExposure: number;
  dailyPnl: number;
  weeklyPnl: number;
  monthlyPnl: number;
}

/**
 * Risk context
 */
export interface RiskContext {
  userId: string;
  accountId: string;
  portfolioState: PortfolioState;
  config: RiskConfig;
  signal?: SignalInput;
  currentTime: Date;
}

// ==================== DEFAULT CONFIG ====================

const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxPositionSize: 100000,
  maxPositionPercent: 10,
  maxOpenPositions: 10,
  maxOpenPositionsPerSymbol: 3,
  
  maxLeverage: 20,
  defaultLeverage: 5,
  
  maxDailyDrawdown: 5,
  maxWeeklyDrawdown: 10,
  maxMonthlyDrawdown: 20,
  
  maxExposurePercent: 80,
  maxCorrelatedExposure: 40,
  
  maxOrderValue: 50000,
  minOrderValue: 10,
  maxOrdersPerMinute: 10,
  maxOrdersPerHour: 100,
  
  requireStopLoss: true,
  minStopLossPercent: 0.5,
  maxStopLossPercent: 50,
  
  requireTakeProfit: false,
  minTakeProfitPercent: 0.5,
  maxTakeProfitTargets: 10,
  
  allowedExchanges: ['binance', 'bybit', 'okx', 'bitget', 'kucoin', 'bingx', 'hyperliquid'],
  blockedExchanges: [],
  allowedSymbols: [],
  blockedSymbols: [],
  
  maxRiskScore: 70,
  requireConfirmationAbove: 50,
  
  minMarginReserve: 20,
  maxMarginUsage: 80,
};

// ==================== RISK MIDDLEWARE CLASS ====================

/**
 * Risk Middleware
 * 
 * Performs comprehensive risk checks before trade execution
 */
export class RiskMiddleware {
  private static instance: RiskMiddleware | null = null;
  private orderTimestamps: Map<string, number[]> = new Map();

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): RiskMiddleware {
    if (!RiskMiddleware.instance) {
      RiskMiddleware.instance = new RiskMiddleware();
    }
    return RiskMiddleware.instance;
  }

  /**
   * Perform all risk checks for a trade
   */
  async checkTradeRisk(
    userId: string,
    accountId: string,
    signal: SignalInput,
    config?: Partial<RiskConfig>
  ): Promise<RiskCheckResult> {
    const warnings: string[] = [];
    const adjustments: RiskAdjustment[] = [];

    try {
      // 1. Get portfolio state
      const portfolioState = await this.getPortfolioState(accountId);
      if (!portfolioState) {
        return {
          allowed: false,
          reason: 'Unable to retrieve portfolio state',
          riskLevel: 'CRITICAL',
        };
      }

      // 2. Merge config with defaults
      const riskConfig = { ...DEFAULT_RISK_CONFIG, ...config };

      // 3. Create risk context
      const context: RiskContext = {
        userId,
        accountId,
        portfolioState,
        config: riskConfig,
        signal,
        currentTime: new Date(),
      };

      // 4. Run all checks
      const checks = [
        this.checkPositionLimits(context),
        this.checkLeverageLimits(context),
        this.checkDrawdownLimits(context),
        this.checkExposureLimits(context),
        this.checkStopLossRequirements(context),
        this.checkTakeProfitRequirements(context),
        this.checkOrderValueLimits(context),
        this.checkRateLimits(context),
        this.checkTimeRestrictions(context),
        this.checkSymbolRestrictions(context),
        this.checkExchangeRestrictions(context),
        this.checkMarginRequirements(context),
        this.checkRiskRewardRatio(context),
      ];

      const results = await Promise.all(checks);

      // 5. Aggregate results
      for (const result of results) {
        if (!result.allowed) {
          return result;
        }
        if (result.warnings) {
          warnings.push(...result.warnings);
        }
        if (result.adjustments) {
          adjustments.push(...result.adjustments);
        }
      }

      // 6. Calculate overall risk score
      const riskScore = this.calculateRiskScore(context, warnings);

      if (riskScore > riskConfig.maxRiskScore) {
        return {
          allowed: false,
          reason: `Risk score ${riskScore} exceeds maximum allowed ${riskConfig.maxRiskScore}`,
          riskLevel: 'HIGH',
          warnings,
          metadata: { riskScore },
        };
      }

      return {
        allowed: true,
        riskLevel: riskScore > 50 ? 'MEDIUM' : 'LOW',
        warnings: warnings.length > 0 ? warnings : undefined,
        adjustments: adjustments.length > 0 ? adjustments : undefined,
        metadata: { riskScore },
      };
    } catch (error) {
      console.error('[RiskMiddleware] Risk check error:', error);
      return {
        allowed: false,
        reason: 'Risk check failed due to internal error',
        riskLevel: 'CRITICAL',
      };
    }
  }

  /**
   * Check position limits
   */
  private checkPositionLimits(context: RiskContext): RiskCheckResult {
    const { config, portfolioState, signal } = context;
    const warnings: string[] = [];

    // Check max open positions
    if (portfolioState.openPositions >= config.maxOpenPositions) {
      return {
        allowed: false,
        reason: `Maximum open positions (${config.maxOpenPositions}) reached`,
        riskLevel: 'HIGH',
      };
    }

    // Calculate estimated position size
    const estimatedPositionValue = signal.entryPrices[0] * (portfolioState.availableMargin * 0.1); // Rough estimate

    // Check max position size
    if (estimatedPositionValue > config.maxPositionSize) {
      return {
        allowed: false,
        reason: `Position size exceeds maximum allowed (${config.maxPositionSize} USD)`,
        riskLevel: 'HIGH',
      };
    }

    // Check max position percent
    const positionPercent = (estimatedPositionValue / portfolioState.totalEquity) * 100;
    if (positionPercent > config.maxPositionPercent) {
      return {
        allowed: false,
        reason: `Position size (${positionPercent.toFixed(1)}%) exceeds maximum allowed (${config.maxPositionPercent}%)`,
        riskLevel: 'HIGH',
      };
    }

    // Warning if approaching limit
    if (portfolioState.openPositions >= config.maxOpenPositions - 2) {
      warnings.push(`Approaching maximum open positions limit (${portfolioState.openPositions}/${config.maxOpenPositions})`);
    }

    return { allowed: true, warnings };
  }

  /**
   * Check leverage limits
   */
  private checkLeverageLimits(context: RiskContext): RiskCheckResult {
    const { config, signal } = context;
    const adjustments: RiskAdjustment[] = [];

    if (signal.leverage > config.maxLeverage) {
      adjustments.push({
        field: 'leverage',
        originalValue: signal.leverage,
        suggestedValue: config.maxLeverage,
        reason: `Leverage exceeds maximum allowed (${config.maxLeverage}x)`,
      });

      return {
        allowed: true, // Allow with adjustment
        warnings: [`Leverage will be reduced from ${signal.leverage}x to ${config.maxLeverage}x`],
        adjustments,
      };
    }

    return { allowed: true };
  }

  /**
   * Check drawdown limits
   */
  private checkDrawdownLimits(context: RiskContext): RiskCheckResult {
    const { config, portfolioState } = context;

    // Calculate drawdown percentages
    const dailyDrawdownPercent = Math.abs(portfolioState.dailyPnl / portfolioState.totalEquity) * 100;
    const weeklyDrawdownPercent = Math.abs(portfolioState.weeklyPnl / portfolioState.totalEquity) * 100;
    const monthlyDrawdownPercent = Math.abs(portfolioState.monthlyPnl / portfolioState.totalEquity) * 100;

    if (dailyDrawdownPercent >= config.maxDailyDrawdown) {
      return {
        allowed: false,
        reason: `Daily drawdown limit (${config.maxDailyDrawdown}%) reached. Current: ${dailyDrawdownPercent.toFixed(1)}%`,
        riskLevel: 'CRITICAL',
      };
    }

    if (weeklyDrawdownPercent >= config.maxWeeklyDrawdown) {
      return {
        allowed: false,
        reason: `Weekly drawdown limit (${config.maxWeeklyDrawdown}%) reached. Current: ${weeklyDrawdownPercent.toFixed(1)}%`,
        riskLevel: 'CRITICAL',
      };
    }

    if (monthlyDrawdownPercent >= config.maxMonthlyDrawdown) {
      return {
        allowed: false,
        reason: `Monthly drawdown limit (${config.maxMonthlyDrawdown}%) reached. Current: ${monthlyDrawdownPercent.toFixed(1)}%`,
        riskLevel: 'CRITICAL',
      };
    }

    return { allowed: true };
  }

  /**
   * Check exposure limits
   */
  private checkExposureLimits(context: RiskContext): RiskCheckResult {
    const { config, portfolioState } = context;
    const warnings: string[] = [];

    const exposurePercent = (portfolioState.totalExposure / portfolioState.totalEquity) * 100;

    if (exposurePercent > config.maxExposurePercent) {
      return {
        allowed: false,
        reason: `Total exposure (${exposurePercent.toFixed(1)}%) exceeds maximum allowed (${config.maxExposurePercent}%)`,
        riskLevel: 'HIGH',
      };
    }

    if (exposurePercent > config.maxExposurePercent * 0.8) {
      warnings.push(`High exposure: ${exposurePercent.toFixed(1)}% of portfolio`);
    }

    return { allowed: true, warnings };
  }

  /**
   * Check stop loss requirements
   */
  private checkStopLossRequirements(context: RiskContext): RiskCheckResult {
    const { config, signal } = context;

    if (config.requireStopLoss && !signal.stopLoss) {
      return {
        allowed: false,
        reason: 'Stop loss is required but not provided',
        riskLevel: 'HIGH',
      };
    }

    if (signal.stopLoss && signal.entryPrices[0]) {
      const slPercent = Math.abs((signal.stopLoss - signal.entryPrices[0]) / signal.entryPrices[0]) * 100;

      if (slPercent < config.minStopLossPercent) {
        return {
          allowed: false,
          reason: `Stop loss too close to entry (${slPercent.toFixed(2)}%). Minimum: ${config.minStopLossPercent}%`,
          riskLevel: 'MEDIUM',
        };
      }

      if (slPercent > config.maxStopLossPercent) {
        return {
          allowed: false,
          reason: `Stop loss too far from entry (${slPercent.toFixed(2)}%). Maximum: ${config.maxStopLossPercent}%`,
          riskLevel: 'HIGH',
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check take profit requirements
   */
  private checkTakeProfitRequirements(context: RiskContext): RiskCheckResult {
    const { config, signal } = context;

    if (config.requireTakeProfit && (!signal.takeProfits || signal.takeProfits.length === 0)) {
      return {
        allowed: false,
        reason: 'Take profit is required but not provided',
        riskLevel: 'MEDIUM',
      };
    }

    if (signal.takeProfits && signal.takeProfits.length > config.maxTakeProfitTargets) {
      return {
        allowed: false,
        reason: `Too many take profit targets (${signal.takeProfits.length}). Maximum: ${config.maxTakeProfitTargets}`,
        riskLevel: 'LOW',
      };
    }

    return { allowed: true };
  }

  /**
   * Check order value limits
   */
  private checkOrderValueLimits(context: RiskContext): RiskCheckResult {
    const { config, signal, portfolioState } = context;

    // Estimate order value
    const estimatedValue = signal.entryPrices[0] * (portfolioState.availableMargin * 0.1);

    if (estimatedValue < config.minOrderValue) {
      return {
        allowed: false,
        reason: `Order value (${estimatedValue.toFixed(2)}) below minimum (${config.minOrderValue})`,
        riskLevel: 'LOW',
      };
    }

    if (estimatedValue > config.maxOrderValue) {
      return {
        allowed: false,
        reason: `Order value (${estimatedValue.toFixed(2)}) exceeds maximum (${config.maxOrderValue})`,
        riskLevel: 'HIGH',
      };
    }

    return { allowed: true };
  }

  /**
   * Check rate limits
   */
  private checkRateLimits(context: RiskContext): RiskCheckResult {
    const { config, accountId } = context;
    const now = Date.now();
    const minuteAgo = now - 60000;
    const hourAgo = now - 3600000;

    // Get timestamps for this account
    const timestamps = this.orderTimestamps.get(accountId) || [];
    
    // Filter recent timestamps
    const recentMinute = timestamps.filter(t => t > minuteAgo).length;
    const recentHour = timestamps.filter(t => t > hourAgo).length;

    if (recentMinute >= config.maxOrdersPerMinute) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${recentMinute} orders in the last minute (max: ${config.maxOrdersPerMinute})`,
        riskLevel: 'MEDIUM',
      };
    }

    if (recentHour >= config.maxOrdersPerHour) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${recentHour} orders in the last hour (max: ${config.maxOrdersPerHour})`,
        riskLevel: 'MEDIUM',
      };
    }

    return { allowed: true };
  }

  /**
   * Check time restrictions
   */
  private checkTimeRestrictions(context: RiskContext): RiskCheckResult {
    const { config, currentTime } = context;

    // Check trading hours
    if (config.allowedTradingHours) {
      const hour = currentTime.getHours();
      if (hour < config.allowedTradingHours.start || hour >= config.allowedTradingHours.end) {
        return {
          allowed: false,
          reason: `Trading not allowed at this hour (${hour}). Allowed: ${config.allowedTradingHours.start}-${config.allowedTradingHours.end}`,
          riskLevel: 'LOW',
        };
      }
    }

    // Check trading days
    if (config.tradingDays) {
      const day = currentTime.getDay();
      if (!config.tradingDays.includes(day)) {
        return {
          allowed: false,
          reason: `Trading not allowed on this day`,
          riskLevel: 'LOW',
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check symbol restrictions
   */
  private checkSymbolRestrictions(context: RiskContext): RiskCheckResult {
    const { config, signal } = context;

    if (config.blockedSymbols.includes(signal.symbol)) {
      return {
        allowed: false,
        reason: `Trading blocked for symbol: ${signal.symbol}`,
        riskLevel: 'HIGH',
      };
    }

    if (config.allowedSymbols.length > 0 && !config.allowedSymbols.includes(signal.symbol)) {
      return {
        allowed: false,
        reason: `Symbol ${signal.symbol} is not in the allowed list`,
        riskLevel: 'MEDIUM',
      };
    }

    return { allowed: true };
  }

  /**
   * Check exchange restrictions
   */
  private checkExchangeRestrictions(context: RiskContext): RiskCheckResult {
    const { config } = context;

    // Note: We'd need to pass exchangeId through context for this check
    // For now, return allowed
    return { allowed: true };
  }

  /**
   * Check margin requirements
   */
  private checkMarginRequirements(context: RiskContext): RiskCheckResult {
    const { config, portfolioState } = context;
    const warnings: string[] = [];

    const marginUsagePercent = (portfolioState.usedMargin / portfolioState.totalEquity) * 100;
    const marginReservePercent = (portfolioState.availableMargin / portfolioState.totalEquity) * 100;

    if (marginUsagePercent > config.maxMarginUsage) {
      return {
        allowed: false,
        reason: `Margin usage (${marginUsagePercent.toFixed(1)}%) exceeds maximum (${config.maxMarginUsage}%)`,
        riskLevel: 'CRITICAL',
      };
    }

    if (marginReservePercent < config.minMarginReserve) {
      return {
        allowed: false,
        reason: `Margin reserve (${marginReservePercent.toFixed(1)}%) below minimum (${config.minMarginReserve}%)`,
        riskLevel: 'HIGH',
      };
    }

    if (marginUsagePercent > config.maxMarginUsage * 0.8) {
      warnings.push(`High margin usage: ${marginUsagePercent.toFixed(1)}%`);
    }

    return { allowed: true, warnings };
  }

  /**
   * Check risk/reward ratio
   */
  private checkRiskRewardRatio(context: RiskContext): RiskCheckResult {
    const { signal } = context;
    const warnings: string[] = [];

    if (!signal.stopLoss || !signal.takeProfits || signal.takeProfits.length === 0) {
      return { allowed: true };
    }

    const entryPrice = signal.entryPrices[0];
    const stopLoss = signal.stopLoss;
    const takeProfitPrice = signal.takeProfits[0].price;

    // Calculate R:R
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfitPrice - entryPrice);
    const rrRatio = reward / risk;

    if (rrRatio < 1) {
      warnings.push(`Risk/Reward ratio is unfavorable: ${rrRatio.toFixed(2)}:1 (recommended: >= 1.5:1)`);
    }

    return { allowed: true, warnings };
  }

  /**
   * Get portfolio state from database
   */
  private async getPortfolioState(accountId: string): Promise<PortfolioState | null> {
    try {
      // Get positions
      const positions = await db.position.findMany({
        where: {
          accountId,
          status: 'OPEN',
        },
      });

      // Get PnL history
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [dailyPnl, weeklyPnl, monthlyPnl] = await Promise.all([
        this.getPnlForPeriod(accountId, dayAgo, now),
        this.getPnlForPeriod(accountId, weekAgo, now),
        this.getPnlForPeriod(accountId, monthAgo, now),
      ]);

      // Calculate totals
      const totalExposure = positions.reduce((sum, p) => sum + (p.totalAmount * p.avgEntryPrice), 0);
      const usedMargin = positions.reduce((sum, p) => sum + (p.totalAmount * p.avgEntryPrice / p.leverage), 0);
      const unrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);

      // Get account balance (simplified - would come from exchange)
      const totalEquity = 10000; // Default for demo
      const availableMargin = totalEquity - usedMargin;

      return {
        totalEquity,
        availableMargin,
        usedMargin,
        unrealizedPnl,
        openPositions: positions.length,
        totalExposure,
        dailyPnl,
        weeklyPnl,
        monthlyPnl,
      };
    } catch (error) {
      console.error('[RiskMiddleware] Failed to get portfolio state:', error);
      return null;
    }
  }

  /**
   * Get PnL for a time period
   */
  private async getPnlForPeriod(accountId: string, start: Date, end: Date): Promise<number> {
    const trades = await db.trade.findMany({
      where: {
        accountId,
        status: 'CLOSED',
        exitTime: {
          gte: start,
          lte: end,
        },
      },
      select: {
        pnl: true,
      },
    });

    return trades.reduce((sum, t) => sum + t.pnl, 0);
  }

  /**
   * Calculate overall risk score
   */
  private calculateRiskScore(context: RiskContext, warnings: string[]): number {
    const { signal, portfolioState, config } = context;
    let score = 0;

    // Leverage factor (0-25 points)
    score += (signal.leverage / config.maxLeverage) * 25;

    // Position concentration (0-20 points)
    const concentration = portfolioState.openPositions / config.maxOpenPositions;
    score += concentration * 20;

    // Exposure factor (0-15 points)
    const exposure = portfolioState.totalExposure / portfolioState.totalEquity;
    score += exposure * 15;

    // Margin usage factor (0-15 points)
    const marginUsage = portfolioState.usedMargin / portfolioState.totalEquity;
    score += marginUsage * 15;

    // Warning factor (0-10 points)
    score += Math.min(warnings.length * 2, 10);

    // Missing risk management factor (0-15 points)
    if (!signal.stopLoss) score += 10;
    if (!signal.takeProfits || signal.takeProfits.length === 0) score += 5;

    return Math.min(100, Math.round(score));
  }

  /**
   * Record order timestamp for rate limiting
   */
  recordOrder(accountId: string): void {
    const timestamps = this.orderTimestamps.get(accountId) || [];
    timestamps.push(Date.now());
    this.orderTimestamps.set(accountId, timestamps);
  }

  /**
   * Clean up old timestamps
   */
  cleanupTimestamps(): void {
    const hourAgo = Date.now() - 3600000;
    for (const [accountId, timestamps] of this.orderTimestamps.entries()) {
      const filtered = timestamps.filter(t => t > hourAgo);
      if (filtered.length === 0) {
        this.orderTimestamps.delete(accountId);
      } else {
        this.orderTimestamps.set(accountId, filtered);
      }
    }
  }

  /**
   * Get risk config for user/account
   */
  async getRiskConfig(userId: string, accountId: string): Promise<RiskConfig> {
    // Try to get user-specific config
    const userConfig = await db.botConfig.findFirst({
      where: {
        userId,
        accountId,
      },
    });

    if (userConfig) {
      return {
        ...DEFAULT_RISK_CONFIG,
        maxLeverage: userConfig.leverage,
        maxOpenPositions: userConfig.maxOpenTrades,
        requireStopLoss: userConfig.ignoreSignalsWithoutSL,
        requireTakeProfit: userConfig.ignoreSignalsWithoutTP,
      };
    }

    return DEFAULT_RISK_CONFIG;
  }

  /**
   * Update risk config
   */
  async updateRiskConfig(
    userId: string,
    accountId: string,
    config: Partial<RiskConfig>
  ): Promise<void> {
    // Store in bot config
    await db.botConfig.updateMany({
      where: {
        userId,
        accountId,
      },
      data: {
        leverage: config.maxLeverage,
        maxOpenTrades: config.maxOpenPositions,
        ignoreSignalsWithoutSL: config.requireStopLoss,
        ignoreSignalsWithoutTP: config.requireTakeProfit,
      },
    });
  }
}

// Singleton instance
export const riskMiddleware = RiskMiddleware.getInstance();
export default riskMiddleware;
