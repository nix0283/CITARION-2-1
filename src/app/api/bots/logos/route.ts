/**
 * LOGOS Meta Bot API Endpoint
 * 
 * Manages the LOGOS signal aggregation and consensus building system
 * with automatic strategy switching based on market conditions.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  LOGOSEngine,
  DEFAULT_AGGREGATION_CONFIG,
  DEFAULT_LOGOS_ENGINE_CONFIG,
  type AggregationConfig,
  type LOGOSEngineConfig,
} from '@/lib/logos-bot/engine'
import type { MarketRegimeType, Candle } from '@/lib/logos-bot/market-regime'
import type { StrategyProfile, StrategySwitchEvent } from '@/lib/logos-bot/strategy-switcher'

// ============================================================================
// LOGOS INSTANCE STORAGE
// ============================================================================

let logosInstance: LOGOSEngine | null = null

// LOGOS bot definition
const LOGOS_BOT_INFO = {
  code: 'LOGOS',
  name: 'Logos',
  fullName: 'Meta Bot - Signal Aggregator',
  category: 'meta',
  description: 'Aggregates signals from all bots and produces unified trading decisions through consensus building with automatic strategy switching',
  features: [
    'Signal aggregation',
    'Consensus building',
    'Weighted voting',
    'Performance tracking',
    'Conflict resolution',
    'Confidence calibration',
    'Automatic strategy switching',
    'Market regime detection',
  ],
}

// ============================================================================
// GET - Get LOGOS status and performance
// ============================================================================

export async function GET() {
  try {
    let status = 'idle'
    let config = DEFAULT_LOGOS_ENGINE_CONFIG
    let performances: unknown[] = []
    let strategy = null
    let regime = null
    let botWeights = null
    
    if (logosInstance) {
      const statusInfo = logosInstance.getStatus()
      status = statusInfo.status
      config = statusInfo.config
      performances = logosInstance.getBotPerformances()
      
      // Get strategy info
      strategy = statusInfo.strategy
      regime = logosInstance.getCurrentRegime()
      botWeights = logosInstance.getBotWeights()
    }
    
    return NextResponse.json({
      success: true,
      bot: {
        ...LOGOS_BOT_INFO,
        status,
        enabled: logosInstance !== null,
        config,
        performances,
        stats: {
          trackedBots: performances.length,
          avgAccuracy: performances.length > 0 
            ? (performances as any[]).reduce((sum: number, p: any) => sum + p.accuracy, 0) / performances.length 
            : 0,
        },
        // Strategy switching info
        strategy: strategy ? {
          activeProfile: strategy.profile,
          currentRegime: strategy.regime,
          autoSwitching: strategy.autoSwitching,
        } : null,
        regime: regime ? {
          type: regime.type,
          confidence: regime.confidence,
          trendDirection: regime.trendDirection,
          metrics: regime.metrics,
        } : null,
        botWeights,
      },
    })
  } catch (error) {
    console.error('Error fetching LOGOS status:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch LOGOS status' },
      { status: 500 }
    )
  }
}

// ============================================================================
// POST - Control LOGOS (start/stop/configure/strategy)
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, config, regime, candles, symbol, exchange, pnl, win } = body
    
    switch (action) {
      case 'start':
        return await startLogos(config)
      case 'stop':
        return await stopLogos()
      case 'configure':
        return await configureLogos(config)
      case 'inject_signal':
        return await injectSignal(body.signal)
      
      // Strategy switching actions
      case 'switch_strategy':
        return await switchStrategy(regime)
      case 'get_regime':
        return await getRegime()
      case 'get_strategy_profile':
        return await getStrategyProfile()
      case 'update_market_data':
        return await updateMarketData(symbol, exchange, candles)
      case 'get_strategy_profiles':
        return await getAllStrategyProfiles()
      case 'get_switch_history':
        return await getSwitchHistory(body.limit)
      case 'record_outcome':
        return await recordOutcome(pnl, win)
      
      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action' },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error('Error controlling LOGOS:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to control LOGOS' },
      { status: 500 }
    )
  }
}

// ============================================================================
// LOGOS CONTROL FUNCTIONS
// ============================================================================

async function startLogos(config?: Partial<LOGOSEngineConfig>) {
  try {
    if (logosInstance) {
      const status = logosInstance.getStatus()
      if (status.status === 'running') {
        return NextResponse.json({
          success: false,
          error: 'LOGOS is already running',
        })
      }
    }
    
    // Create new instance
    logosInstance = new LOGOSEngine(config)
    
    // Start the engine
    await logosInstance.start()
    
    const statusInfo = logosInstance.getStatus()
    
    return NextResponse.json({
      success: true,
      message: 'LOGOS started successfully',
      timestamp: Date.now(),
      config: statusInfo.config,
      strategy: statusInfo.strategy,
    })
  } catch (error) {
    console.error('Error starting LOGOS:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to start LOGOS' },
      { status: 500 }
    )
  }
}

async function stopLogos() {
  try {
    if (!logosInstance) {
      return NextResponse.json({
        success: false,
        error: 'LOGOS is not running',
      })
    }
    
    await logosInstance.stop()
    logosInstance = null
    
    return NextResponse.json({
      success: true,
      message: 'LOGOS stopped successfully',
      timestamp: Date.now(),
    })
  } catch (error) {
    console.error('Error stopping LOGOS:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to stop LOGOS' },
      { status: 500 }
    )
  }
}

async function configureLogos(config: Partial<LOGOSEngineConfig>) {
  try {
    if (!logosInstance) {
      return NextResponse.json({
        success: false,
        error: 'LOGOS is not running. Start it first to configure.',
      })
    }
    
    logosInstance.updateConfig(config)
    
    return NextResponse.json({
      success: true,
      message: 'LOGOS configuration updated',
      timestamp: Date.now(),
      config: logosInstance.getStatus().config,
    })
  } catch (error) {
    console.error('Error configuring LOGOS:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to configure LOGOS' },
      { status: 500 }
    )
  }
}

async function injectSignal(_signal: unknown) {
  try {
    if (!logosInstance) {
      return NextResponse.json({
        success: false,
        error: 'LOGOS is not running. Start it first.',
      })
    }
    
    // Signal injection would be handled through the event bus
    // This is a placeholder for manual signal injection for testing
    
    return NextResponse.json({
      success: true,
      message: 'Signal injected (handled through event bus)',
      timestamp: Date.now(),
    })
  } catch (error) {
    console.error('Error injecting signal:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to inject signal' },
      { status: 500 }
    )
  }
}

// ============================================================================
// STRATEGY SWITCHING FUNCTIONS
// ============================================================================

/**
 * Manually switch to a specific strategy
 */
async function switchStrategy(regime: MarketRegimeType) {
  try {
    if (!logosInstance) {
      return NextResponse.json({
        success: false,
        error: 'LOGOS is not running. Start it first.',
      })
    }
    
    const validRegimes: MarketRegimeType[] = ['TRENDING', 'RANGING', 'VOLATILE', 'QUIET']
    if (!validRegimes.includes(regime)) {
      return NextResponse.json({
        success: false,
        error: `Invalid regime. Must be one of: ${validRegimes.join(', ')}`,
      }, { status: 400 })
    }
    
    const event = logosInstance.switchStrategy(regime)
    const profile = logosInstance.getActiveStrategyProfile()
    const botWeights = logosInstance.getBotWeights()
    
    return NextResponse.json({
      success: true,
      message: `Strategy switched to ${profile.name}`,
      timestamp: event.timestamp,
      event: {
        fromProfile: event.fromProfile,
        toProfile: event.toProfile,
        fromRegime: event.fromRegime,
        toRegime: event.toRegime,
        trigger: event.trigger,
      },
      profile: {
        name: profile.name,
        regime: profile.regime,
        categoryWeights: profile.categoryWeights,
        riskParams: profile.riskParams,
        behavior: profile.behavior,
      },
      botWeights,
    })
  } catch (error) {
    console.error('Error switching strategy:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to switch strategy' },
      { status: 500 }
    )
  }
}

/**
 * Get current market regime
 */
async function getRegime() {
  try {
    if (!logosInstance) {
      return NextResponse.json({
        success: false,
        error: 'LOGOS is not running. Start it first.',
      })
    }
    
    const regime = logosInstance.getCurrentRegime()
    
    if (!regime) {
      return NextResponse.json({
        success: true,
        message: 'No regime data available yet. Update market data first.',
        regime: null,
      })
    }
    
    return NextResponse.json({
      success: true,
      regime: {
        type: regime.type,
        confidence: regime.confidence,
        trendDirection: regime.trendDirection,
        trendStrength: regime.trendStrength,
        volatilityLevel: regime.volatilityLevel,
        rangeBound: regime.rangeBound,
        volumeProfile: regime.volumeProfile,
        metrics: regime.metrics,
        timestamp: regime.timestamp,
        symbol: regime.symbol,
        exchange: regime.exchange,
      },
    })
  } catch (error) {
    console.error('Error getting regime:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to get regime' },
      { status: 500 }
    )
  }
}

/**
 * Get active strategy profile
 */
async function getStrategyProfile() {
  try {
    if (!logosInstance) {
      return NextResponse.json({
        success: false,
        error: 'LOGOS is not running. Start it first.',
      })
    }
    
    const profile = logosInstance.getActiveStrategyProfile()
    const botWeights = logosInstance.getBotWeights()
    
    return NextResponse.json({
      success: true,
      profile: {
        name: profile.name,
        regime: profile.regime,
        categoryWeights: profile.categoryWeights,
        botMultipliers: profile.botMultipliers,
        riskParams: profile.riskParams,
        behavior: profile.behavior,
        description: profile.description,
      },
      botWeights,
    })
  } catch (error) {
    console.error('Error getting strategy profile:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to get strategy profile' },
      { status: 500 }
    )
  }
}

/**
 * Get all available strategy profiles
 */
async function getAllStrategyProfiles() {
  try {
    if (!logosInstance) {
      return NextResponse.json({
        success: false,
        error: 'LOGOS is not running. Start it first.',
      })
    }
    
    const profiles = logosInstance.getAllStrategyProfiles()
    
    const formattedProfiles = Object.entries(profiles).map(([regime, profile]) => ({
      regime: regime as MarketRegimeType,
      name: profile.name,
      description: profile.description,
      categoryWeights: profile.categoryWeights,
      riskParams: profile.riskParams,
      behavior: profile.behavior,
    }))
    
    return NextResponse.json({
      success: true,
      profiles: formattedProfiles,
    })
  } catch (error) {
    console.error('Error getting strategy profiles:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to get strategy profiles' },
      { status: 500 }
    )
  }
}

/**
 * Update market data and trigger strategy evaluation
 */
async function updateMarketData(
  symbol: string,
  exchange: string,
  candles: Candle[]
) {
  try {
    if (!logosInstance) {
      return NextResponse.json({
        success: false,
        error: 'LOGOS is not running. Start it first.',
      })
    }
    
    if (!symbol || !exchange || !candles || candles.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields: symbol, exchange, candles',
      }, { status: 400 })
    }
    
    const result = logosInstance.updateMarketData(symbol, exchange, candles)
    
    return NextResponse.json({
      success: true,
      timestamp: Date.now(),
      switched: result.switched,
      regime: result.regime ? {
        type: result.regime.type,
        confidence: result.regime.confidence,
        trendDirection: result.regime.trendDirection,
        metrics: result.regime.metrics,
      } : null,
      profile: result.profile ? {
        name: result.profile.name,
        regime: result.profile.regime,
      } : null,
      switchEvent: result.switchEvent ? {
        fromProfile: result.switchEvent.fromProfile,
        toProfile: result.switchEvent.toProfile,
        fromRegime: result.switchEvent.fromRegime,
        toRegime: result.switchEvent.toRegime,
        trigger: result.switchEvent.trigger,
      } : null,
    })
  } catch (error) {
    console.error('Error updating market data:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update market data' },
      { status: 500 }
    )
  }
}

/**
 * Get strategy switch history
 */
async function getSwitchHistory(limit: number = 20) {
  try {
    if (!logosInstance) {
      return NextResponse.json({
        success: false,
        error: 'LOGOS is not running. Start it first.',
      })
    }
    
    const history = logosInstance.getSwitchHistory(limit)
    const stats = logosInstance.getStrategyStats()
    
    return NextResponse.json({
      success: true,
      history: history.map(event => ({
        timestamp: event.timestamp,
        fromProfile: event.fromProfile,
        toProfile: event.toProfile,
        fromRegime: event.fromRegime,
        toRegime: event.toRegime,
        trigger: event.trigger,
        confidence: event.confidence,
      })),
      stats: {
        currentProfile: stats.currentProfile,
        currentRegime: stats.currentRegime,
        totalSwitches: stats.totalSwitches,
        switchesByTrigger: stats.switchesByTrigger,
        avgTimeBetweenSwitches: stats.avgTimeBetweenSwitches,
      },
    })
  } catch (error) {
    console.error('Error getting switch history:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to get switch history' },
      { status: 500 }
    )
  }
}

/**
 * Record signal outcome for performance tracking
 */
async function recordOutcome(pnl: number, win: boolean) {
  try {
    if (!logosInstance) {
      return NextResponse.json({
        success: false,
        error: 'LOGOS is not running. Start it first.',
      })
    }
    
    logosInstance.recordSignalOutcome(pnl, win)
    
    return NextResponse.json({
      success: true,
      message: 'Outcome recorded for performance tracking',
      timestamp: Date.now(),
    })
  } catch (error) {
    console.error('Error recording outcome:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to record outcome' },
      { status: 500 }
    )
  }
}
