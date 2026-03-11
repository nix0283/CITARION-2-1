/**
 * LOGOS Feedback Collector
 *
 * Collects trade outcomes from closed positions.
 * Matches signals to outcomes and calculates contribution scores.
 * Identifies winning/losing patterns and generates improvement suggestions.
 */

import { db } from '@/lib/db'
import type { BotCode } from '../orchestration'
import { performanceTracker, type Outcome, type MarketRegime } from './performance-tracker'

// ============================================================================
// TYPES
// ============================================================================

export interface ClosedPosition {
  positionId: string
  signalId?: string
  symbol: string
  exchange: string
  direction: 'LONG' | 'SHORT'
  entryPrice: number
  exitPrice: number
  entryTime: Date
  exitTime: Date
  pnl: number
  pnlPercent: number
  closeReason: string
  marketRegime?: MarketRegime
}

export interface ContributionScore {
  botCode: BotCode
  score: number // -1 to 1 (negative = hurt, positive = helped)
  directionMatch: boolean // Did bot direction match final decision
  confidenceAlignment: number // How well confidence matched outcome
  weight: number // Contribution weight
}

export interface PatternMatch {
  patternId: string
  patternType: 'WINNING' | 'LOSING'
  characteristics: PatternCharacteristics
  frequency: number
  avgPnL: number
  confidence: number
}

export interface PatternCharacteristics {
  botAgreementLevel: 'high' | 'medium' | 'low' // How many bots agreed
  confidenceRange: 'narrow' | 'wide' // Spread of confidence values
  regimeMatch: boolean // Did outcome match expected regime behavior
  consensusLevel: 'strong' | 'moderate' | 'weak'
  timeOfDay?: number
  dayOfWeek?: number
  volatilityLevel?: 'low' | 'medium' | 'high'
}

export interface ImprovementSuggestion {
  id: string
  type: 'WEIGHT_ADJUST' | 'THRESHOLD_CHANGE' | 'REGIME_FILTER' | 'CONFIDENCE_CALIBRATION'
  target: string // Bot code or 'all'
  currentValue: number
  suggestedValue: number
  reason: string
  confidence: number
  expectedImpact: 'positive' | 'negative' | 'neutral'
  supportingEvidence: string[]
}

export interface FeedbackSummary {
  totalOutcomesProcessed: number
  wins: number
  losses: number
  breakevens: number
  avgWinPnL: number
  avgLossPnL: number
  winRate: number
  profitFactor: number
  topContributors: ContributionScore[]
  bottomContributors: ContributionScore[]
  identifiedPatterns: PatternMatch[]
  suggestions: ImprovementSuggestion[]
}

// ============================================================================
// FEEDBACK COLLECTOR CLASS
// ============================================================================

export class FeedbackCollector {
  private minSamplesForPattern: number = 5
  private contributionThreshold: number = 0.1 // Min contribution to score

  constructor(config?: {
    minSamplesForPattern?: number
    contributionThreshold?: number
  }) {
    if (config) {
      this.minSamplesForPattern = config.minSamplesForPattern ?? this.minSamplesForPattern
      this.contributionThreshold = config.contributionThreshold ?? this.contributionThreshold
    }
  }

  // ===========================================================================
  // OUTCOME COLLECTION
  // ===========================================================================

  /**
   * Collect outcome from a closed position
   */
  async collectOutcome(position: ClosedPosition): Promise<string | null> {
    try {
      // Find matching signal
      const signalOutcome = position.signalId
        ? await db.logosSignalOutcome.findUnique({
            where: { signalId: position.signalId },
          })
        : await this.findMatchingSignal(position)

      if (!signalOutcome) {
        console.log(`[FeedbackCollector] No matching signal found for position ${position.positionId}`)
        return null
      }

      // Determine outcome
      const outcome = this.determineOutcome(position.pnlPercent)
      const isCorrect = this.evaluatePrediction(signalOutcome.direction, outcome)

      // Calculate contribution scores
      const contributions = signalOutcome.contributions
        ? (JSON.parse(signalOutcome.contributions) as Array<{
            botCode: BotCode
            direction: string
            confidence: number
            weight: number
          }>)
        : []

      const contributionScores = this.calculateContributionScores(
        contributions,
        signalOutcome.direction,
        outcome,
        position.pnlPercent
      )

      // Update performance tracker
      await performanceTracker.updateOutcome({
        signalId: signalOutcome.signalId,
        actualEntry: position.entryPrice,
        actualExit: position.exitPrice,
        exitTime: position.exitTime,
        outcome,
        pnlPercent: position.pnlPercent,
        pnlAbsolute: position.pnl,
      })

      // Store feedback entry for pattern analysis
      await this.storeFeedbackEntry(signalOutcome.id, outcome, contributionScores, position)

      console.log(
        `[FeedbackCollector] Collected outcome for signal ${signalOutcome.signalId}: ` +
        `${outcome} (${position.pnlPercent > 0 ? '+' : ''}${position.pnlPercent.toFixed(2)}%)`
      )

      return signalOutcome.id
    } catch (error) {
      console.error('[FeedbackCollector] Error collecting outcome:', error)
      return null
    }
  }

  /**
   * Find matching signal for a position
   */
  private async findMatchingSignal(position: ClosedPosition): Promise<{
    id: string
    signalId: string
    direction: string
    contributions: string | null
  } | null> {
    try {
      // Look for pending signals matching the position
      const matchingSignals = await db.logosSignalOutcome.findMany({
        where: {
          symbol: position.symbol,
          direction: position.direction,
          outcome: 'PENDING',
          timestamp: {
            gte: new Date(position.entryTime.getTime() - 5 * 60 * 1000), // 5 min before
            lte: new Date(position.entryTime.getTime() + 5 * 60 * 1000), // 5 min after
          },
        },
        orderBy: { timestamp: 'desc' },
        take: 1,
      })

      return matchingSignals[0] || null
    } catch (error) {
      console.error('[FeedbackCollector] Error finding matching signal:', error)
      return null
    }
  }

  /**
   * Determine outcome type from PnL
   */
  private determineOutcome(pnlPercent: number): Outcome {
    if (pnlPercent > 0.5) return 'WIN'
    if (pnlPercent < -0.5) return 'LOSS'
    return 'BREAKEVEN'
  }

  /**
   * Evaluate if prediction was correct
   */
  private evaluatePrediction(predictedDirection: string, outcome: Outcome): boolean {
    if (outcome === 'BREAKEVEN') return true
    return outcome === 'WIN'
  }

  // ===========================================================================
  // CONTRIBUTION SCORING
  // ===========================================================================

  /**
   * Calculate contribution scores for each bot
   */
  private calculateContributionScores(
    contributions: Array<{
      botCode: BotCode
      direction: string
      confidence: number
      weight: number
    }>,
    finalDirection: string,
    outcome: Outcome,
    pnlPercent: number
  ): ContributionScore[] {
    const isWin = outcome === 'WIN'
    const isBreakeven = outcome === 'BREAKEVEN'

    return contributions.map(c => {
      const directionMatch = c.direction === finalDirection || c.direction === 'NEUTRAL'

      // Base score from direction match and outcome
      let score = 0
      if (isBreakeven) {
        score = 0
      } else if (isWin) {
        score = directionMatch ? c.confidence : -c.confidence * 0.5
      } else {
        score = directionMatch ? -c.confidence : c.confidence * 0.3 // Contrarian bonus for losses
      }

      // Weight-adjusted score
      const weightedScore = score * c.weight

      // Confidence alignment (how well confidence matched outcome)
      let confidenceAlignment = 0
      if (isWin && directionMatch) {
        confidenceAlignment = c.confidence // High confidence good on wins
      } else if (!isWin && directionMatch) {
        confidenceAlignment = 1 - c.confidence // Low confidence better on losses
      }

      return {
        botCode: c.botCode,
        score: Math.max(-1, Math.min(1, weightedScore)),
        directionMatch,
        confidenceAlignment,
        weight: c.weight,
      }
    })
  }

  // ===========================================================================
  // PATTERN ANALYSIS
  // ===========================================================================

  /**
   * Store feedback entry for pattern analysis
   */
  private async storeFeedbackEntry(
    outcomeId: string,
    outcome: Outcome,
    contributions: ContributionScore[],
    position: ClosedPosition
  ): Promise<void> {
    try {
      const patternType = outcome === 'WIN' ? 'WINNING' : outcome === 'LOSS' ? 'LOSING' : null

      if (!patternType) return

      // Calculate pattern characteristics
      const characteristics = this.extractPatternCharacteristics(contributions, position)

      // Generate pattern signature
      const signature = this.generatePatternSignature(characteristics, position.direction)

      // Create feedback entry
      await db.logosFeedbackEntry.create({
        data: {
          outcomeId,
          patternType,
          patternSignature: signature,
          botAgreement: characteristics.botAgreementLevel === 'high' ? 0.8 : characteristics.botAgreementLevel === 'medium' ? 0.5 : 0.2,
          confidenceRange: characteristics.confidenceRange === 'narrow' ? 0.1 : 0.3,
          regimeMatch: characteristics.regimeMatch,
          suggestion: null,
          suggestionType: null,
        },
      })
    } catch (error) {
      console.error('[FeedbackCollector] Error storing feedback entry:', error)
    }
  }

  /**
   * Extract pattern characteristics from outcome
   */
  private extractPatternCharacteristics(
    contributions: ContributionScore[],
    position: ClosedPosition
  ): PatternCharacteristics {
    // Calculate agreement level
    const directionMatches = contributions.filter(c => c.directionMatch).length
    const agreementRatio = contributions.length > 0 ? directionMatches / contributions.length : 0

    const botAgreementLevel: 'high' | 'medium' | 'low' =
      agreementRatio > 0.7 ? 'high' : agreementRatio > 0.4 ? 'medium' : 'low'

    // Calculate confidence range
    const confidences = contributions.map(c => c.confidence)
    const minConf = Math.min(...confidences)
    const maxConf = Math.max(...confidences)
    const confidenceRange: 'narrow' | 'wide' = maxConf - minConf < 0.2 ? 'narrow' : 'wide'

    // Get time characteristics
    const hour = position.exitTime.getHours()
    const dayOfWeek = position.exitTime.getDay()

    return {
      botAgreementLevel,
      confidenceRange,
      regimeMatch: true, // Would need regime prediction to determine
      consensusLevel: agreementRatio > 0.7 ? 'strong' : agreementRatio > 0.4 ? 'moderate' : 'weak',
      timeOfDay: hour,
      dayOfWeek,
      volatilityLevel: position.marketRegime === 'volatile' ? 'high' : 'low',
    }
  }

  /**
   * Generate pattern signature for grouping
   */
  private generatePatternSignature(
    characteristics: PatternCharacteristics,
    direction: string
  ): string {
    const parts = [
      direction,
      characteristics.botAgreementLevel,
      characteristics.confidenceRange,
      characteristics.consensusLevel,
    ]
    return parts.join('_')
  }

  /**
   * Identify winning/losing patterns
   */
  async identifyPatterns(): Promise<PatternMatch[]> {
    try {
      const feedbackEntries = await db.logosFeedbackEntry.findMany({
        where: {
          patternType: { not: null },
        },
      })

      // Group by pattern signature
      const patternGroups = new Map<string, typeof feedbackEntries>()

      for (const entry of feedbackEntries) {
        if (!entry.patternSignature) continue
        if (!patternGroups.has(entry.patternSignature)) {
          patternGroups.set(entry.patternSignature, [])
        }
        patternGroups.get(entry.patternSignature)!.push(entry)
      }

      const patterns: PatternMatch[] = []

      for (const [signature, entries] of patternGroups) {
        if (entries.length < this.minSamplesForPattern) continue

        const wins = entries.filter(e => e.patternType === 'WINNING').length
        const losses = entries.filter(e => e.patternType === 'LOSING').length
        const total = entries.length
        const winRate = wins / total

        // Get outcomes for PnL calculation
        let avgPnL = 0
        try {
          const outcomes = await db.logosSignalOutcome.findMany({
            where: {
              id: { in: entries.map(e => e.outcomeId) },
            },
          })
          avgPnL = outcomes.reduce((sum, o) => sum + o.pnlPercent, 0) / outcomes.length
        } catch {
          // Ignore if can't get outcomes
        }

        patterns.push({
          patternId: signature,
          patternType: winRate > 0.5 ? 'WINNING' : 'LOSING',
          characteristics: {
            botAgreementLevel: entries[0].botAgreement && entries[0].botAgreement > 0.7
              ? 'high'
              : entries[0].botAgreement && entries[0].botAgreement > 0.4
                ? 'medium'
                : 'low',
            confidenceRange: entries[0].confidenceRange && entries[0].confidenceRange < 0.15
              ? 'narrow'
              : 'wide',
            regimeMatch: entries[0].regimeMatch ?? false,
            consensusLevel: 'moderate',
          },
          frequency: total,
          avgPnL,
          confidence: Math.abs(winRate - 0.5) * 2, // 0 to 1, higher = more confidence
        })
      }

      return patterns.sort((a, b) => b.confidence - a.confidence)
    } catch (error) {
      console.error('[FeedbackCollector] Error identifying patterns:', error)
      return []
    }
  }

  // ===========================================================================
  // IMPROVEMENT SUGGESTIONS
  // ===========================================================================

  /**
   * Generate improvement suggestions based on feedback
   */
  async generateSuggestions(): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = []

    try {
      // Get bot performances
      const performances = await performanceTracker.getAllBotPerformances()
      const patterns = await this.identifyPatterns()

      // 1. Weight adjustment suggestions
      for (const perf of performances) {
        if (perf.totalSignals < 10) continue

        // Underperforming bots need weight reduction
        if (perf.overallAccuracy < 0.4 && perf.currentWeight > 0.5) {
          suggestions.push({
            id: `weight_${perf.botCode}_${Date.now()}`,
            type: 'WEIGHT_ADJUST',
            target: perf.botCode,
            currentValue: perf.currentWeight,
            suggestedValue: Math.max(0.3, perf.currentWeight * perf.overallAccuracy * 2),
            reason: `${perf.botCode} accuracy (${(perf.overallAccuracy * 100).toFixed(1)}%) is below threshold`,
            confidence: 1 - perf.overallAccuracy,
            expectedImpact: 'positive',
            supportingEvidence: [
              `Total signals: ${perf.totalSignals}`,
              `Correct: ${perf.correctSignals}`,
              `Rolling accuracy: ${(perf.rollingAccuracy * 100).toFixed(1)}%`,
            ],
          })
        }

        // Overperforming bots can get weight increase
        if (perf.overallAccuracy > 0.65 && perf.currentWeight < 1.5) {
          suggestions.push({
            id: `weight_${perf.botCode}_${Date.now()}`,
            type: 'WEIGHT_ADJUST',
            target: perf.botCode,
            currentValue: perf.currentWeight,
            suggestedValue: Math.min(2.0, perf.currentWeight * (1 + (perf.overallAccuracy - 0.5))),
            reason: `${perf.botCode} accuracy (${(perf.overallAccuracy * 100).toFixed(1)}%) is above average`,
            confidence: perf.overallAccuracy - 0.5,
            expectedImpact: 'positive',
            supportingEvidence: [
              `Total signals: ${perf.totalSignals}`,
              `Correct: ${perf.correctSignals}`,
              `Long accuracy: ${(perf.longAccuracy * 100).toFixed(1)}%`,
              `Short accuracy: ${(perf.shortAccuracy * 100).toFixed(1)}%`,
            ],
          })
        }

        // Degradation warning
        if (perf.degradationScore > 0.15) {
          suggestions.push({
            id: `degradation_${perf.botCode}_${Date.now()}`,
            type: 'CONFIDENCE_CALIBRATION',
            target: perf.botCode,
            currentValue: perf.overallAccuracy,
            suggestedValue: perf.rollingAccuracy,
            reason: `${perf.botCode} shows performance degradation (${(perf.degradationScore * 100).toFixed(1)}% drop)`,
            confidence: perf.degradationScore,
            expectedImpact: 'neutral',
            supportingEvidence: [
              `Current accuracy: ${(perf.overallAccuracy * 100).toFixed(1)}%`,
              `Recent accuracy: ${(perf.rollingAccuracy * 100).toFixed(1)}%`,
              'Consider temporary weight reduction',
            ],
          })
        }
      }

      // 2. Pattern-based suggestions
      for (const pattern of patterns) {
        if (pattern.confidence < 0.5) continue

        if (pattern.patternType === 'LOSING' && pattern.frequency >= 10) {
          suggestions.push({
            id: `pattern_${pattern.patternId}_${Date.now()}`,
            type: 'THRESHOLD_CHANGE',
            target: 'all',
            currentValue: 0.6,
            suggestedValue: 0.7,
            reason: `Losing pattern detected: ${pattern.patternId}`,
            confidence: pattern.confidence,
            expectedImpact: 'positive',
            supportingEvidence: [
              `Frequency: ${pattern.frequency}`,
              `Avg PnL: ${pattern.avgPnL.toFixed(2)}%`,
              JSON.stringify(pattern.characteristics),
            ],
          })
        }
      }

      // Store suggestions in feedback entries
      for (const suggestion of suggestions) {
        await this.storeSuggestion(suggestion)
      }

      return suggestions.sort((a, b) => b.confidence - a.confidence)
    } catch (error) {
      console.error('[FeedbackCollector] Error generating suggestions:', error)
      return []
    }
  }

  /**
   * Store suggestion for tracking
   */
  private async storeSuggestion(suggestion: ImprovementSuggestion): Promise<void> {
    try {
      // Find an unprocessed feedback entry to attach suggestion
      const feedbackEntry = await db.logosFeedbackEntry.findFirst({
        where: {
          suggestion: null,
          suggestionType: null,
        },
        orderBy: { createdAt: 'desc' },
      })

      if (feedbackEntry) {
        await db.logosFeedbackEntry.update({
          where: { id: feedbackEntry.id },
          data: {
            suggestion: JSON.stringify(suggestion),
            suggestionType: suggestion.type,
          },
        })
      }
    } catch (error) {
      // Ignore if can't store
    }
  }

  // ===========================================================================
  // SUMMARY AND REPORTING
  // ===========================================================================

  /**
   * Get comprehensive feedback summary
   */
  async getFeedbackSummary(days: number = 30): Promise<FeedbackSummary> {
    try {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

      const outcomes = await db.logosSignalOutcome.findMany({
        where: {
          outcome: { not: 'PENDING' },
          timestamp: { gte: since },
        },
      })

      const wins = outcomes.filter(o => o.outcome === 'WIN')
      const losses = outcomes.filter(o => o.outcome === 'LOSS')
      const breakevens = outcomes.filter(o => o.outcome === 'BREAKEVEN')

      const avgWinPnL = wins.length > 0
        ? wins.reduce((sum, o) => sum + o.pnlPercent, 0) / wins.length
        : 0
      const avgLossPnL = losses.length > 0
        ? losses.reduce((sum, o) => sum + o.pnlPercent, 0) / losses.length
        : 0

      const totalWins = wins.reduce((sum, o) => sum + Math.abs(o.pnlPercent), 0)
      const totalLosses = Math.abs(losses.reduce((sum, o) => sum + o.pnlPercent, 0))
      const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0

      // Get contribution scores from recent outcomes
      const recentContributions: ContributionScore[] = []
      for (const outcome of outcomes.slice(0, 50)) {
        if (outcome.contributions) {
          const contributions = JSON.parse(outcome.contributions) as Array<{
            botCode: BotCode
            direction: string
            confidence: number
            weight: number
          }>
          const scores = this.calculateContributionScores(
            contributions,
            outcome.direction,
            outcome.outcome as Outcome,
            outcome.pnlPercent
          )
          recentContributions.push(...scores)
        }
      }

      // Aggregate by bot
      const botContributions = new Map<BotCode, { total: number; count: number }>()
      for (const score of recentContributions) {
        const existing = botContributions.get(score.botCode) || { total: 0, count: 0 }
        existing.total += score.score
        existing.count++
        botContributions.set(score.botCode, existing)
      }

      const aggregatedContributions: ContributionScore[] = []
      for (const [botCode, data] of botContributions) {
        aggregatedContributions.push({
          botCode,
          score: data.total / data.count,
          directionMatch: true,
          confidenceAlignment: 0,
          weight: 1,
        })
      }

      // Sort by contribution score
      aggregatedContributions.sort((a, b) => b.score - a.score)

      // Get patterns
      const identifiedPatterns = await this.identifyPatterns()

      // Get suggestions
      const suggestions = await this.generateSuggestions()

      return {
        totalOutcomesProcessed: outcomes.length,
        wins: wins.length,
        losses: losses.length,
        breakevens: breakevens.length,
        avgWinPnL,
        avgLossPnL,
        winRate: outcomes.length > 0 ? wins.length / outcomes.length : 0,
        profitFactor,
        topContributors: aggregatedContributions.slice(0, 5),
        bottomContributors: aggregatedContributions.slice(-5).reverse(),
        identifiedPatterns,
        suggestions,
      }
    } catch (error) {
      console.error('[FeedbackCollector] Error getting feedback summary:', error)
      return {
        totalOutcomesProcessed: 0,
        wins: 0,
        losses: 0,
        breakevens: 0,
        avgWinPnL: 0,
        avgLossPnL: 0,
        winRate: 0,
        profitFactor: 0,
        topContributors: [],
        bottomContributors: [],
        identifiedPatterns: [],
        suggestions: [],
      }
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const feedbackCollector = new FeedbackCollector()
export default FeedbackCollector
