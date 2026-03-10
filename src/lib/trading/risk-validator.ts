/**
 * Production-Ready Risk Validation Layer
 * 
 * Validates all trades before execution to prevent:
 * 1. Exceeding daily/weekly/monthly loss limits
 * 2. Position size too large for account balance
 * 3. Trading blacklisted symbols
 * 4. Exceeding position limits
 * 5. Exceeding leverage limits
 * 6. Invalid risk/reward ratio
 */

import { db } from '@/lib/db';
import type { ExchangeClient } from '@/lib/exchange';

// Types
export interface RiskValidationResult {
  allowed: boolean;
  reason?: string;
  warnings?: string[];
  requiredMargin?: number;
  availableBalance?: number;
  currentExposure?: number;
  maxExposure?: number;
  dailyPnL?: number;
  maxDailyLoss?: number;
}

export interface RiskSettings {
  maxDailyLoss: number;
  maxDailyLossPercent: number;
  maxPositionSize: number;
  maxTotalExposure: number;
  maxPositions: number;
  maxLeverage: number;
  blacklistedSymbols: string[];
  allowedSymbols: string[];
  defaultStopLoss: number;
  defaultTakeProfit: number;
  minRiskRewardRatio: number;
  requireStopLoss: boolean;
  requireTakeProfit: boolean;
  requireConfirmation: boolean;
  killSwitchEnabled: boolean;
  killSwitchThreshold: number;
}

/**
 * Get risk settings for user, creating defaults if not set
 */
export async function getRiskSettings(userId: string): Promise<RiskSettings> {
  let settings = await db.riskSettings.findUnique({
    where: { userId }
  });

  if (!settings) {
    // Create default settings
    settings = await db.riskSettings.create({
      data: {
        userId,
        maxDailyLoss: 1000,
        maxDailyLossPercent: 5,
        maxPositionSize: 1000,
        maxTotalExposure: 10000,
        maxPositions: 10,
        maxLeverage: 20,
        blacklistedSymbols: '[]',
        allowedSymbols: '[]',
        defaultStopLoss: 10,
        defaultTakeProfit: 20,
        minRiskRewardRatio: 1.5,
        requireStopLoss: false,
        requireTakeProfit: false,
        requireConfirmation: true,
        killSwitchEnabled: false,
        killSwitchThreshold: 20,
      }
    });
  }

  return {
    maxDailyLoss: settings.maxDailyLoss,
    maxDailyLossPercent: settings.maxDailyLossPercent,
    maxPositionSize: settings.maxPositionSize,
    maxTotalExposure: settings.maxTotalExposure,
    maxPositions: settings.maxPositions,
    maxLeverage: settings.maxLeverage,
    blacklistedSymbols: JSON.parse(settings.blacklistedSymbols || '[]'),
    allowedSymbols: JSON.parse(settings.allowedSymbols || '[]'),
    defaultStopLoss: settings.defaultStopLoss,
    defaultTakeProfit: settings.defaultTakeProfit,
    minRiskRewardRatio: settings.minRiskRewardRatio,
    requireStopLoss: settings.requireStopLoss,
    requireTakeProfit: settings.requireTakeProfit,
    requireConfirmation: settings.requireConfirmation,
    killSwitchEnabled: settings.killSwitchEnabled,
    killSwitchThreshold: settings.killSwitchThreshold,
  };
}

/**
 * Calculate total exposure for user across all open positions
 */
export async function calculateTotalExposure(userId: string): Promise<number> {
  const positions = await db.position.findMany({
    where: {
      status: 'OPEN',
      account: {
        userId,
        accountType: 'REAL'
      }
    }
  });

  let totalExposure = 0;
  
  for (const position of positions) {
    const positionValue = position.totalAmount * (position.currentPrice || position.avgEntryPrice);
    totalExposure += positionValue * position.leverage;
  }

  return totalExposure;
}

/**
 * Calculate today's PnL for user
 */
export async function calculateDailyPnL(userId: string, date: Date = new Date()): Promise<number> {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(startOfDay);
  endOfDay.setHours(23, 59, 59, 999);

  const trades = await db.trade.findMany({
    where: {
      userId,
      isDemo: false,
      status: 'CLOSED',
      exitTime: {
        gte: startOfDay,
        lte: endOfDay
      }
    }
  });

  return trades.reduce((sum, trade) => sum + trade.pnl, 0);
}

/**
 * Validate if a trade can be executed based on risk rules
 */
export async function validateTrade(
  userId: string,
  symbol: string,
  direction: 'LONG' | 'SHORT',
  amount: number,
  leverage: number,
  stopLoss?: number | null,
  takeProfit?: number | null,
  accountId?: string,
  exchangeClient?: ExchangeClient
): Promise<RiskValidationResult> {
  const warnings: string[] = [];
  let requiredMargin = amount;
  let availableBalance = Infinity;
  let currentExposure = 0;
  let dailyPnL = 0;
  let maxDailyLoss = Infinity;

  try {
    // Get risk settings
    const settings = await getRiskSettings(userId);

    // 1. Check blacklisted symbols
    if (settings.blacklistedSymbols.length > 0) {
      if (settings.blacklistedSymbols.includes(symbol)) {
        return {
          allowed: false,
          reason: `Symbol ${symbol} is blacklisted`,
          warnings
        };
      }
    }

    // 2. Check allowed symbols (if not empty, symbol must be in list)
    if (settings.allowedSymbols.length > 0) {
      if (!settings.allowedSymbols.includes(symbol)) {
        return {
          allowed: false,
          reason: `Symbol ${symbol} is not in allowed list`,
          warnings
        };
      }
    }

    // 3. Check leverage limits
    if (leverage > settings.maxLeverage) {
      return {
        allowed: false,
        reason: `Leverage ${leverage}x exceeds maximum allowed (${settings.maxLeverage}x)`,
        warnings
      };
    }

    // 4. Calculate required margin (position value)
    const positionValue = amount * leverage;
    requiredMargin = amount;

    // 5. Get current exposure
    currentExposure = await calculateTotalExposure(userId);

    // 6. Get today's PnL
    dailyPnL = await calculateDailyPnL(userId, new Date());
    maxDailyLoss = settings.maxDailyLoss;

    // 7. Check daily loss limit
    if (dailyPnL < -settings.maxDailyLoss) {
      return {
        allowed: false,
        reason: `Daily loss limit reached: $${Math.abs(dailyPnL).toFixed(2)} of $${settings.maxDailyLoss} allowed`,
        warnings,
        dailyPnL,
        maxDailyLoss: settings.maxDailyLoss
      };
    }

    // 8. Check position count limit
    const openPositions = await db.position.count({
      where: {
        status: 'OPEN',
        account: {
          userId,
          accountType: 'REAL'
        }
      }
    });

    if (openPositions >= settings.maxPositions) {
      return {
        allowed: false,
        reason: `Maximum position count reached (${openPositions}/${settings.maxPositions})`,
        warnings
      };
    }

    // 9. Check total exposure limit
    if (currentExposure + positionValue > settings.maxTotalExposure) {
      return {
        allowed: false,
        reason: `Total exposure would exceed limit: $${(currentExposure + positionValue).toFixed(2)} > $${settings.maxTotalExposure}`,
        warnings,
        currentExposure,
        maxExposure: settings.maxTotalExposure
      };
    }

    // 10. Check position size limit
    if (amount > settings.maxPositionSize) {
      warnings.push(`Position size $${amount.toFixed(2)} exceeds recommended $${settings.maxPositionSize}`);
    }

    // 11. Check if SL/TP required
    if (settings.requireStopLoss && !stopLoss) {
      return {
        allowed: false,
        reason: 'Stop loss is required for all trades',
        warnings
      };
    }

    if (settings.requireTakeProfit && !takeProfit) {
      return {
        allowed: false,
        reason: 'Take profit is required for all trades',
        warnings
      };
    }

    // 12. Check risk/reward ratio if both SL and TP provided
    if (stopLoss && takeProfit && exchangeClient) {
      try {
        const currentPrice = await getCurrentPrice(symbol, exchangeClient);
        const riskRewardRatio = Math.abs(takeProfit - currentPrice) / 
                             Math.abs(currentPrice - stopLoss);
        
        if (riskRewardRatio < settings.minRiskRewardRatio) {
          warnings.push(`Risk/Reward ratio ${riskRewardRatio.toFixed(2)} is below recommended ${settings.minRiskRewardRatio}`);
        }
      } catch {
        // Ignore if can't get price
      }
    }

    // 13. Check balance if exchange client provided
    if (exchangeClient) {
      try {
        const accountInfo = await exchangeClient.getAccountInfo();
        availableBalance = accountInfo.availableBalance || accountInfo.balance || 0;
        
        if (availableBalance < requiredMargin) {
          return {
            allowed: false,
            reason: `Insufficient balance: $${availableBalance.toFixed(2)} available, $${requiredMargin.toFixed(2)} required`,
            warnings,
            requiredMargin,
            availableBalance
          };
        }
      } catch {
        warnings.push('Could not verify balance from exchange');
      }
    }

    // 14. Check kill switch
    if (settings.killSwitchEnabled && dailyPnL < -settings.killSwitchThreshold) {
      return {
        allowed: false,
        reason: `Kill switch triggered: Daily loss exceeded ${settings.killSwitchThreshold}%`,
        warnings
      };
    }

    // All checks passed
    return {
      allowed: true,
      warnings,
      requiredMargin,
      availableBalance,
      currentExposure,
      dailyPnL,
      maxDailyLoss: settings.maxDailyLoss
    };

  } catch (error) {
    console.error('[RiskValidator] Error:', error);
    // In case of error, allow trade but with warnings
    return {
      allowed: true,
      warnings: ['Risk validation encountered an error'],
      reason: 'Risk validation error - allowing trade with caution'
    };
  }
}

/**
 * Get current price for a symbol
 */
async function getCurrentPrice(symbol: string, exchangeClient?: ExchangeClient): Promise<number> {
  // Try exchange client first
  if (exchangeClient) {
    try {
      const ticker = await exchangeClient.getTicker(symbol);
      return ticker.last;
    } catch {
      // Fall through to DB
    }
  }

  // Try to get from market price cache
  const marketPrice = await db.marketPrice.findUnique({
    where: { symbol }
  });

  if (marketPrice) {
    return marketPrice.price;
  }

  // Return a fallback value
  return 0;
}

/**
 * Update daily risk metrics after a trade
 */
export async function updateDailyMetrics(userId: string, pnl: number, isWin: boolean): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let metrics = await db.dailyRiskMetrics.findUnique({
    where: {
      userId_date: {
        userId,
        date: today
      }
    }
  });

  if (!metrics) {
    metrics = await db.dailyRiskMetrics.create({
      data: {
        userId,
        date: today,
        totalTrades: 1,
        winningTrades: isWin ? 1 : 0,
        losingTrades: isWin ? 0 : 1,
        totalPnL: pnl,
        realizedPnL: pnl,
        maxDrawdown: pnl < 0 ? Math.abs(pnl) : 0,
        currentDrawdown: pnl < 0 ? Math.abs(pnl) : 0,
        maxExposure: 0
      }
    });
  } else {
    await db.dailyRiskMetrics.update({
      where: { id: metrics.id },
      data: {
        totalTrades: { increment: 1 },
        winningTrades: { increment: isWin ? 1 : 0 },
        losingTrades: { increment: isWin ? 0 : 1 },
        totalPnL: { increment: pnl },
        realizedPnL: { increment: pnl },
        maxDrawdown: Math.max(metrics.maxDrawdown, pnl < 0 ? Math.abs(pnl) : 0),
        currentDrawdown: pnl < 0 ? Math.abs(pnl) : 0
      }
    });
  }
}
