/**
 * LOGOS Meta Bot
 * 
 * Signal aggregation, trade journaling, pattern detection,
 * and automatic strategy switching based on market conditions.
 */

// Core Engine
export {
  LOGOSEngine,
  LOGOS_BOT_METADATA,
  DEFAULT_AGGREGATION_CONFIG,
  DEFAULT_LOGOS_ENGINE_CONFIG,
  SignalAggregator,
} from './engine'

export type {
  IncomingSignal,
  AggregatedSignal,
  SignalContribution,
  BotPerformance,
  AggregationConfig,
  LOGOSEngineConfig,
} from './engine'

// Strategy Switching
export {
  StrategySwitcher,
  STRATEGY_PROFILES,
  BOT_CATEGORY_MAP,
  DEFAULT_STRATEGY_SWITCHER_CONFIG,
} from './strategy-switcher'

export type {
  StrategyProfile,
  StrategySwitcherConfig,
  StrategyPerformance,
  StrategySwitchEvent,
  BotStrategyCategory,
} from './strategy-switcher'

// Market Regime Detection
export {
  MarketRegimeDetector,
  DEFAULT_REGIME_DETECTOR_CONFIG,
} from './market-regime'

export type {
  MarketRegime,
  MarketRegimeType,
  TrendDirection,
  RegimeDetectorConfig,
  RegimeHistoryPoint,
  Candle,
} from './market-regime'

// Trade Journal & Pattern Detection
export { TradeJournal, PatternDetector } from './enhancements'

export type {
  JournalEntry,
  JournalStats,
  BotJournalStats,
  SymbolJournalStats,
  DetectedPattern,
  PatternType,
  PatternPerformance,
} from './enhancements'
