/**
 * LOGOS Performance Tracker
 *
 * Tracks predictions vs actual outcomes for continuous improvement.
 * Calculates accuracy metrics per bot, per regime, per symbol.
 * Implements rolling window performance analysis and degradation detection.
 */

import { db } from '@/lib/db'
import type { BotCode } from '../orchestration'

// ============================================================================
// TYPES
// ============================================================================

export type Outcome = 'WIN' | 'LOSS' | 'BREAKEVEN' | 'PENDING'
export type MarketRegime = 'trending' | 'ranging' | 'volatile' | 'unknown'

export interface SignalPrediction {
  signalId: string
  timestamp: Date
  symbol: string
  exchange: string
  direction: 'LONG' | 'SHORT' | 'NEUTRAL'
  predictedConfidence: number
  predictedEntry?: number
  predictedSL?: number
  predictedTP?: number
  consensus: number
  participatingBots: BotCode[]
  marketRegime?: MarketRegime
  volatility?: number
  volume?: number
  contributions?: SignalContributionRecord[]
}

export interface SignalContributionRecord {
  botCode: BotCode
  direction: 'LONG' | 'SHORT' | 'NEUTRAL'
  confidence: number
  weight: number
}

export interface ActualOutcome {
  signalId: string
  actualEntry?: number
  actualExit?: number
  exitTime?: Date
  outcome: Outcome
  pnlPercent: number
  pnlAbsolute: number
}

export interface BotPerformanceMetrics {
  botCode: BotCode
  totalSignals: number
  correctSignals: number
  incorrectSignals: number
  overallAccuracy: number
  longAccuracy: number
  shortAccuracy: number
  currentWeight: number
  rollingAccuracy: number
  degradationScore: number
  lastSignalTime?: Date
  lastOutcomeTime?: Date
}

export interface RollingWindowStats {
  windowSize: number
  accuracy: number
  avgPnL: number
  winRate: number
  trendDirection: 'improving' | 'declining' | 'stable'
}

export interface PerformanceDegradation {
  botCode: BotCode
  previousAccuracy: number
  currentAccuracy: number
  degradationPercent: number
  detectedAt: Date
  severity: 'low' | 'medium' | 'high'
}

export interface SymbolPerformance {
  symbol: string
  totalSignals: number
  accuracy: number
  avgPnL: number
}

export interface RegimePerformance {
  regime: MarketRegime
  totalSignals: number
  accuracy: number
  avgPnL: number
}

// ============================================================================
// PERFORMANCE TRACKER CLASS
// ============================================================================

export class PerformanceTracker {
  private rollingWindowSize: number = 50
  private degradationThreshold: number = 0.15
  private degradationWindow: number = 20

  constructor(config?: {
    rollingWindowSize?: number
    degradationThreshold?: number
    degradationWindow?: number
  }) {
    if (config) {
      this.rollingWindowSize = config.rollingWindowSize ?? this.rollingWindowSize
      this.degradationThreshold = config.degradationThreshold ?? this.degradationThreshold
      this.degradationWindow = config.degradationWindow ?? this.degradationWindow
    }
  }

  // ===========================================================================
  // SIGNAL REGISTRATION
  // ===========================================================================

  /**
   * Register a new signal prediction for tracking
   */
  async registerSignal(prediction: SignalPrediction): Promise<string> {
    try {
      const outcome = await db.logosSignalOutcome.create({
        data: {
          signalId: prediction.signalId,
          timestamp: prediction.timestamp,
          symbol: prediction.symbol,
          exchange: prediction.exchange,
          direction: prediction.direction,
          predictedConfidence: prediction.predictedConfidence,
          predictedEntry: prediction.predictedEntry,
          predictedSL: prediction.predictedSL,
          predictedTP: prediction.predictedTP,
          consensus: prediction.consensus,
          participatingBots: JSON.stringify(prediction.participatingBots),
          marketRegime: prediction.marketRegime,
          volatility: prediction.volatility,
          volume: prediction.volume,
          contributions: prediction.contributions ? JSON.stringify(prediction.contributions) : null,
          outcome: 'PENDING',
        },
      })

      // Update bot performance tracking (signal counts)
      for (const botCode of prediction.participatingBots) {
        await this.incrementBotSignalCount(botCode, prediction.direction)
      }

      console.log(`[PerformanceTracker] Registered signal ${prediction.signalId} for ${prediction.symbol}`)
      return outcome.id
    } catch (error) {
      console.error('[PerformanceTracker] Error registering signal:', error)
      throw error
    }
  }

  /**
   * Update signal with actual outcome
   */
  async updateOutcome(outcome: ActualOutcome): Promise<void> {
    try {
      const signalOutcome = await db.logosSignalOutcome.findUnique({
        where: { signalId: outcome.signalId },
      })

      if (!signalOutcome) {
        console.warn(`[PerformanceTracker] Signal ${outcome.signalId} not found`)
        return
      }

      // Determine if prediction was correct
      const isCorrect = this.evaluatePrediction(
        signalOutcome.direction,
        outcome.outcome
      )

      // Update the signal outcome
      await db.logosSignalOutcome.update({
        where: { signalId: outcome.signalId },
        data: {
          actualEntry: outcome.actualEntry,
          actualExit: outcome.actualExit,
          exitTime: outcome.exitTime,
          outcome: outcome.outcome,
          pnlPercent: outcome.pnlPercent,
          pnlAbsolute: outcome.pnlAbsolute,
          processed: true,
        },
      })

      // Update bot performance for each participating bot
      const participatingBots = JSON.parse(signalOutcome.participatingBots) as BotCode[]
      const contributions = signalOutcome.contributions
        ? (JSON.parse(signalOutcome.contributions) as SignalContributionRecord[])
        : []

      for (const botCode of participatingBots) {
        const contribution = contributions.find(c => c.botCode === botCode)
        await this.updateBotOutcome(botCode, isCorrect, signalOutcome.direction, outcome)
      }

      // Check for performance degradation
      await this.checkDegradation(participatingBots)

      console.log(
        `[PerformanceTracker] Updated outcome for ${outcome.signalId}: ` +
        `${outcome.outcome} (${isCorrect ? 'CORRECT' : 'INCORRECT'})`
      )
    } catch (error) {
      console.error('[PerformanceTracker] Error updating outcome:', error)
      throw error
    }
  }

  // ===========================================================================
  // BOT PERFORMANCE TRACKING
  // ===========================================================================

  /**
   * Increment bot signal count
   */
  private async incrementBotSignalCount(
    botCode: BotCode,
    direction: 'LONG' | 'SHORT' | 'NEUTRAL'
  ): Promise<void> {
    try {
      const existing = await db.logosBotPerformance.findUnique({
        where: { botCode },
      })

      if (existing) {
        const updateData: Record<string, unknown> = {
          totalSignals: existing.totalSignals + 1,
          lastSignalTime: new Date(),
        }

        if (direction === 'LONG') {
          updateData.longSignals = existing.longSignals + 1
        } else if (direction === 'SHORT') {
          updateData.shortSignals = existing.shortSignals + 1
        }

        await db.logosBotPerformance.update({
          where: { botCode },
          data: updateData,
        })
      } else {
        await db.logosBotPerformance.create({
          data: {
            botCode,
            totalSignals: 1,
            longSignals: direction === 'LONG' ? 1 : 0,
            shortSignals: direction === 'SHORT' ? 1 : 0,
            lastSignalTime: new Date(),
          },
        })
      }
    } catch (error) {
      console.error(`[PerformanceTracker] Error incrementing signal count for ${botCode}:`, error)
    }
  }

  /**
   * Update bot performance after outcome
   */
  private async updateBotOutcome(
    botCode: BotCode,
    isCorrect: boolean,
    predictedDirection: string,
    outcome: ActualOutcome
  ): Promise<void> {
    try {
      const existing = await db.logosBotPerformance.findUnique({
        where: { botCode },
      })

      if (!existing) {
        console.warn(`[PerformanceTracker] Bot ${botCode} not found for outcome update`)
        return
      }

      const totalWithOutcome = existing.correctSignals + existing.incorrectSignals + 1
      const newCorrect = existing.correctSignals + (isCorrect ? 1 : 0)
      const newIncorrect = existing.incorrectSignals + (isCorrect ? 0 : 1)

      // Calculate accuracies
      const overallAccuracy = newCorrect / totalWithOutcome

      // Direction-specific accuracy
      let newCorrectLongs = existing.correctLongs
      let newCorrectShorts = existing.correctShorts
      if (predictedDirection === 'LONG') {
        newCorrectLongs += isCorrect ? 1 : 0
      } else if (predictedDirection === 'SHORT') {
        newCorrectShorts += isCorrect ? 1 : 0
      }

      const longAccuracy = existing.longSignals > 0
        ? newCorrectLongs / existing.longSignals
        : 0.5
      const shortAccuracy = existing.shortSignals > 0
        ? newCorrectShorts / existing.shortSignals
        : 0.5

      // Update rolling window
      const rollingWindow = existing.rollingWindow
        ? (JSON.parse(existing.rollingWindow) as number[])
        : []
      rollingWindow.push(isCorrect ? 1 : 0)
      if (rollingWindow.length > this.rollingWindowSize) {
        rollingWindow.shift()
      }
      const rollingAccuracy = rollingWindow.reduce((a, b) => a + b, 0) / rollingWindow.length

      // Update top/worst symbols
      await this.updateSymbolPerformance(botCode, outcome, isCorrect, existing)

      await db.logosBotPerformance.update({
        where: { botCode },
        data: {
          correctSignals: newCorrect,
          incorrectSignals: newIncorrect,
          overallAccuracy,
          longAccuracy,
          shortAccuracy,
          correctLongs: newCorrectLongs,
          correctShorts: newCorrectShorts,
          rollingAccuracy,
          rollingWindow: JSON.stringify(rollingWindow),
          lastOutcomeTime: new Date(),
        },
      })
    } catch (error) {
      console.error(`[PerformanceTracker] Error updating bot outcome for ${botCode}:`, error)
    }
  }

  /**
   * Update symbol performance for a bot
   */
  private async updateSymbolPerformance(
    botCode: BotCode,
    outcome: ActualOutcome,
    isCorrect: boolean,
    existing: { topSymbols?: string | null; worstSymbols?: string | null; id: string }
  ): Promise<void> {
    try {
      // Get symbol from signal outcome
      const signalOutcome = await db.logosSignalOutcome.findUnique({
        where: { signalId: outcome.signalId },
        select: { symbol: true },
      })

      if (!signalOutcome) return

      const symbol = signalOutcome.symbol
      const topSymbols = existing.topSymbols
        ? (JSON.parse(existing.topSymbols) as SymbolPerformance[])
        : []
      const worstSymbols = existing.worstSymbols
        ? (JSON.parse(existing.worstSymbols) as SymbolPerformance[])
        : []

      // Update or add symbol performance
      let topEntry = topSymbols.find(s => s.symbol === symbol)
      let worstEntry = worstSymbols.find(s => s.symbol === symbol)

      if (isCorrect) {
        if (topEntry) {
          topEntry.totalSignals++
          topEntry.accuracy = (topEntry.accuracy * (topEntry.totalSignals - 1) + 1) / topEntry.totalSignals
        } else {
          topSymbols.push({ symbol, totalSignals: 1, accuracy: 1, avgPnL: outcome.pnlPercent })
        }
        // Keep top 5
        topSymbols.sort((a, b) => b.accuracy - a.accuracy)
        if (topSymbols.length > 5) topSymbols.pop()
      } else {
        if (worstEntry) {
          worstEntry.totalSignals++
          worstEntry.accuracy = (worstEntry.accuracy * (worstEntry.totalSignals - 1)) / worstEntry.totalSignals
          worstEntry.avgPnL = (worstEntry.avgPnL * (worstEntry.totalSignals - 1) + outcome.pnlPercent) / worstEntry.totalSignals
        } else {
          worstSymbols.push({ symbol, totalSignals: 1, accuracy: 0, avgPnL: outcome.pnlPercent })
        }
        // Keep top 5 worst
        worstSymbols.sort((a, b) => a.accuracy - b.accuracy)
        if (worstSymbols.length > 5) worstSymbols.pop()
      }

      await db.logosBotPerformance.update({
        where: { botCode },
        data: {
          topSymbols: JSON.stringify(topSymbols),
          worstSymbols: JSON.stringify(worstSymbols),
        },
      })
    } catch (error) {
      console.error(`[PerformanceTracker] Error updating symbol performance:`, error)
    }
  }

  // ===========================================================================
  // DEGRADATION DETECTION
  // ===========================================================================

  /**
   * Check for performance degradation in bots
   */
  private async checkDegradation(botCodes: BotCode[]): Promise<PerformanceDegradation[]> {
    const degradations: PerformanceDegradation[] = []

    for (const botCode of botCodes) {
      try {
        const perf = await db.logosBotPerformance.findUnique({
          where: { botCode },
        })

        if (!perf || perf.totalSignals < this.degradationWindow) continue

        const rollingWindow = perf.rollingWindow
          ? (JSON.parse(perf.rollingWindow) as number[])
          : []

        if (rollingWindow.length < this.degradationWindow) continue

        // Calculate recent accuracy vs historical
        const recentWindow = rollingWindow.slice(-this.degradationWindow)
        const recentAccuracy = recentWindow.reduce((a, b) => a + b, 0) / recentWindow.length
        const historicalAccuracy = perf.overallAccuracy

        const degradation = historicalAccuracy - recentAccuracy

        if (degradation > this.degradationThreshold) {
          const severity: 'low' | 'medium' | 'high' =
            degradation > 0.3 ? 'high' : degradation > 0.2 ? 'medium' : 'low'

          const degradationRecord: PerformanceDegradation = {
            botCode,
            previousAccuracy: historicalAccuracy,
            currentAccuracy: recentAccuracy,
            degradationPercent: degradation,
            detectedAt: new Date(),
            severity,
          }

          degradations.push(degradationRecord)

          // Update degradation score
          await db.logosBotPerformance.update({
            where: { botCode },
            data: {
              degradationScore: degradation,
              lastDegradationCheck: new Date(),
            },
          })

          console.warn(
            `[PerformanceTracker] Degradation detected for ${botCode}: ` +
            `${(degradation * 100).toFixed(1)}% drop (${severity})`
          )
        } else {
          // Reset degradation score if recovered
          await db.logosBotPerformance.update({
            where: { botCode },
            data: {
              degradationScore: 0,
              lastDegradationCheck: new Date(),
            },
          })
        }
      } catch (error) {
        console.error(`[PerformanceTracker] Error checking degradation for ${botCode}:`, error)
      }
    }

    return degradations
  }

  // ===========================================================================
  // QUERY METHODS
  // ===========================================================================

  /**
   * Get performance metrics for a specific bot
   */
  async getBotPerformance(botCode: BotCode): Promise<BotPerformanceMetrics | null> {
    try {
      const perf = await db.logosBotPerformance.findUnique({
        where: { botCode },
      })

      if (!perf) return null

      return {
        botCode: perf.botCode as BotCode,
        totalSignals: perf.totalSignals,
        correctSignals: perf.correctSignals,
        incorrectSignals: perf.incorrectSignals,
        overallAccuracy: perf.overallAccuracy,
        longAccuracy: perf.longAccuracy,
        shortAccuracy: perf.shortAccuracy,
        currentWeight: perf.currentWeight,
        rollingAccuracy: perf.rollingAccuracy,
        degradationScore: perf.degradationScore,
        lastSignalTime: perf.lastSignalTime ?? undefined,
        lastOutcomeTime: perf.lastOutcomeTime ?? undefined,
      }
    } catch (error) {
      console.error(`[PerformanceTracker] Error getting performance for ${botCode}:`, error)
      return null
    }
  }

  /**
   * Get performance metrics for all bots
   */
  async getAllBotPerformances(): Promise<BotPerformanceMetrics[]> {
    try {
      const perfs = await db.logosBotPerformance.findMany({
        orderBy: { overallAccuracy: 'desc' },
      })

      return perfs.map(perf => ({
        botCode: perf.botCode as BotCode,
        totalSignals: perf.totalSignals,
        correctSignals: perf.correctSignals,
        incorrectSignals: perf.incorrectSignals,
        overallAccuracy: perf.overallAccuracy,
        longAccuracy: perf.longAccuracy,
        shortAccuracy: perf.shortAccuracy,
        currentWeight: perf.currentWeight,
        rollingAccuracy: perf.rollingAccuracy,
        degradationScore: perf.degradationScore,
        lastSignalTime: perf.lastSignalTime ?? undefined,
        lastOutcomeTime: perf.lastOutcomeTime ?? undefined,
      }))
    } catch (error) {
      console.error('[PerformanceTracker] Error getting all bot performances:', error)
      return []
    }
  }

  /**
   * Get rolling window statistics for a bot
   */
  async getRollingWindowStats(botCode: BotCode): Promise<RollingWindowStats | null> {
    try {
      const perf = await db.logosBotPerformance.findUnique({
        where: { botCode },
      })

      if (!perf || !perf.rollingWindow) return null

      const window = JSON.parse(perf.rollingWindow) as number[]
      if (window.length === 0) return null

      const accuracy = window.reduce((a, b) => a + b, 0) / window.length
      const recentAccuracy = window.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, window.length)
      const olderAccuracy = window.slice(0, -10).reduce((a, b) => a + b, 0) / Math.max(1, window.length - 10)

      let trendDirection: 'improving' | 'declining' | 'stable'
      if (recentAccuracy > olderAccuracy + 0.05) {
        trendDirection = 'improving'
      } else if (recentAccuracy < olderAccuracy - 0.05) {
        trendDirection = 'declining'
      } else {
        trendDirection = 'stable'
      }

      return {
        windowSize: window.length,
        accuracy,
        avgPnL: perf.avgPnl,
        winRate: accuracy,
        trendDirection,
      }
    } catch (error) {
      console.error(`[PerformanceTracker] Error getting rolling window stats for ${botCode}:`, error)
      return null
    }
  }

  /**
   * Get performance by symbol for a bot
   */
  async getSymbolPerformance(botCode: BotCode): Promise<{
    top: SymbolPerformance[]
    worst: SymbolPerformance[]
  }> {
    try {
      const perf = await db.logosBotPerformance.findUnique({
        where: { botCode },
      })

      if (!perf) return { top: [], worst: [] }

      return {
        top: perf.topSymbols ? (JSON.parse(perf.topSymbols) as SymbolPerformance[]) : [],
        worst: perf.worstSymbols ? (JSON.parse(perf.worstSymbols) as SymbolPerformance[]) : [],
      }
    } catch (error) {
      console.error(`[PerformanceTracker] Error getting symbol performance for ${botCode}:`, error)
      return { top: [], worst: [] }
    }
  }

  /**
   * Get pending signals (no outcome yet)
   */
  async getPendingSignals(limit: number = 50): Promise<SignalPrediction[]> {
    try {
      const pending = await db.logosSignalOutcome.findMany({
        where: { outcome: 'PENDING' },
        orderBy: { timestamp: 'desc' },
        take: limit,
      })

      return pending.map(p => ({
        signalId: p.signalId,
        timestamp: p.timestamp,
        symbol: p.symbol,
        exchange: p.exchange,
        direction: p.direction as 'LONG' | 'SHORT' | 'NEUTRAL',
        predictedConfidence: p.predictedConfidence,
        predictedEntry: p.predictedEntry ?? undefined,
        predictedSL: p.predictedSL ?? undefined,
        predictedTP: p.predictedTP ?? undefined,
        consensus: p.consensus,
        participatingBots: JSON.parse(p.participatingBots) as BotCode[],
        marketRegime: p.marketRegime as MarketRegime,
        volatility: p.volatility ?? undefined,
        volume: p.volume ?? undefined,
        contributions: p.contributions
          ? (JSON.parse(p.contributions) as SignalContributionRecord[])
          : undefined,
      }))
    } catch (error) {
      console.error('[PerformanceTracker] Error getting pending signals:', error)
      return []
    }
  }

  /**
   * Get recent outcomes for analysis
   */
  async getRecentOutcomes(limit: number = 100): Promise<Array<SignalPrediction & ActualOutcome>> {
    try {
      const outcomes = await db.logosSignalOutcome.findMany({
        where: { outcome: { not: 'PENDING' } },
        orderBy: { timestamp: 'desc' },
        take: limit,
      })

      return outcomes.map(o => ({
        signalId: o.signalId,
        timestamp: o.timestamp,
        symbol: o.symbol,
        exchange: o.exchange,
        direction: o.direction as 'LONG' | 'SHORT' | 'NEUTRAL',
        predictedConfidence: o.predictedConfidence,
        predictedEntry: o.predictedEntry ?? undefined,
        predictedSL: o.predictedSL ?? undefined,
        predictedTP: o.predictedTP ?? undefined,
        consensus: o.consensus,
        participatingBots: JSON.parse(o.participatingBots) as BotCode[],
        marketRegime: o.marketRegime as MarketRegime,
        volatility: o.volatility ?? undefined,
        volume: o.volume ?? undefined,
        contributions: o.contributions
          ? (JSON.parse(o.contributions) as SignalContributionRecord[])
          : undefined,
        actualEntry: o.actualEntry ?? undefined,
        actualExit: o.actualExit ?? undefined,
        exitTime: o.exitTime ?? undefined,
        outcome: o.outcome as Outcome,
        pnlPercent: o.pnlPercent,
        pnlAbsolute: o.pnlAbsolute,
      }))
    } catch (error) {
      console.error('[PerformanceTracker] Error getting recent outcomes:', error)
      return []
    }
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  /**
   * Evaluate if a prediction was correct based on outcome
   */
  private evaluatePrediction(
    predictedDirection: string,
    outcome: Outcome
  ): boolean {
    if (outcome === 'BREAKEVEN') return true // Neutral
    if (predictedDirection === 'NEUTRAL') return outcome === 'BREAKEVEN'
    return outcome === 'WIN'
  }

  /**
   * Calculate performance summary for all bots
   */
  async getPerformanceSummary(): Promise<{
    totalBots: number
    avgAccuracy: number
    bestBot: BotPerformanceMetrics | null
    worstBot: BotPerformanceMetrics | null
    degradingBots: BotPerformanceMetrics[]
    improvingBots: BotPerformanceMetrics[]
  }> {
    const performances = await this.getAllBotPerformances()

    if (performances.length === 0) {
      return {
        totalBots: 0,
        avgAccuracy: 0,
        bestBot: null,
        worstBot: null,
        degradingBots: [],
        improvingBots: [],
      }
    }

    const avgAccuracy = performances.reduce((sum, p) => sum + p.overallAccuracy, 0) / performances.length
    const sorted = [...performances].sort((a, b) => b.overallAccuracy - a.overallAccuracy)
    const bestBot = sorted[0]
    const worstBot = sorted[sorted.length - 1]
    const degradingBots = performances.filter(p => p.degradationScore > this.degradationThreshold)
    const improvingBots = performances.filter(p => p.rollingAccuracy > p.overallAccuracy + 0.05)

    return {
      totalBots: performances.length,
      avgAccuracy,
      bestBot,
      worstBot,
      degradingBots,
      improvingBots,
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const performanceTracker = new PerformanceTracker()
export default PerformanceTracker
