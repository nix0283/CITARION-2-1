/**
 * BB Bot Engine
 * 
 * Полнофункциональный движок Bollinger Bands торгового бота.
 * 
 * Features:
 * - Double Bollinger Bands with Inner/Outer bands
 * - Slow Stochastic confirmation
 * - Multi-timeframe analysis
 * - Event-driven trading
 * - Risk management
 */

import { EventEmitter } from 'events';
import {
  MultiTimeframeConfirmation,
  VolumeConfirmationFilter,
  DivergenceDetector,
  TimeframeSignal,
  MTFConfirmation,
} from './mtf-confirmation';

// ==================== TYPES ====================

export interface BBBotConfig {
  id: string;
  symbol: string;
  exchangeId: string;
  marketType: 'spot' | 'futures';
  direction: 'LONG' | 'SHORT' | 'BOTH';
  
  // Bollinger Bands settings
  bbInnerPeriod: number;
  bbInnerDeviation: number;
  bbOuterPeriod: number;
  bbOuterDeviation: number;
  
  // Stochastic settings
  stochKPeriod: number;
  stochDPeriod: number;
  stochSlowing: number;
  stochOverbought: number;
  stochOversold: number;
  
  // Timeframes
  timeframes: string[];
  primaryTimeframe: string;
  
  // Position settings
  tradeAmount: number;
  leverage: number;
  marginMode: 'isolated' | 'cross';
  
  // Risk management
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStopPercent?: number;
  maxDrawdown: number;
  
  // Filters
  volumeFilterEnabled: boolean;
  minVolumeRatio: number;
  mtfConfirmationEnabled: boolean;
  requiredTimeframeConfirmations: number;
  divergenceFilterEnabled: boolean;
  
  // Mode
  isManualMode: boolean;
  manualEntryPrice?: number;
  manualTargets?: Array<{ price: number; percentage: number }>;
  manualStopLoss?: number;
}

export interface BBBotState {
  id: string;
  status: 'IDLE' | 'STARTING' | 'RUNNING' | 'PAUSED' | 'STOPPED' | 'ERROR';
  startedAt?: Date;
  stoppedAt?: Date;
  
  // Position
  position?: BBPosition;
  
  // Metrics
  totalTrades: number;
  winTrades: number;
  lossTrades:  number;
  totalPnl: number;
  totalFees: number;
  totalVolume: number;
  
  // Risk state
  currentDrawdown: number;
  maxDrawdownReached: number;
  
  // Indicator state
  currentBBPosition: 'UPPER' | 'MIDDLE' | 'LOWER' | 'OUTSIDE';
  currentStochPosition: 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL';
  
  // Last update
  lastUpdate: Date;
  lastSignal?: BBSignal;
}

export interface BBPosition {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  avgEntryPrice: number;
  totalInvested: number;
  
  // Risk management
  stopLoss: number;
  takeProfits: Array<{ price: number; percentage: number; status: 'PENDING' | 'TRIGGERED' | 'FILLED' }>;
  trailingStopPrice?: number;
  
  // State
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  realizedPnl: number;
  fees: number;
  
  // Timing
  openedAt: Date;
  closedAt?: Date;
  closeReason?: 'TP' | 'SL' | 'MANUAL' | 'DIVERGENCE' | 'SIGNAL';
  status: 'OPEN' | 'CLOSING' | 'CLOSED';
  
  // BB context
  bbEntryPosition: 'UPPER' | 'MIDDLE' | 'LOWER' | 'OUTSIDE';
  stochEntryPosition: 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL';
}

export interface BBSignal {
  id: string;
  timestamp: Date;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  confidence: number;
  
  // Indicator values
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  stochK: number;
  stochD: number;
  volume: number;
  
  // Conditions
  bbCondition: string;
  stochCondition: string;
  volumeCondition: boolean;
  mtfConfirmation?: MTFConfirmation;
  divergence?: { detected: boolean; type: 'BULLISH' | 'BEARISH' | null };
  
  // Execution
  executed: boolean;
  positionId?: string;
}

export interface BBIndicators {
  upperInner: number;
  middleInner: number;
  lowerInner: number;
  upperOuter: number;
  middleOuter: number;
  lowerOuter: number;
  stochK: number;
  stochD: number;
  atr: number;
  volume: number;
  avgVolume: number;
}

export interface BBAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getCurrentPrice(): Promise<number>;
  getOHLCV(timeframe: string, limit: number): Promise<Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>>;
  placeOrder(params: { symbol: string; side: 'BUY' | 'SELL'; type: 'MARKET' | 'LIMIT'; quantity: number; price?: number; clientOrderId?: string }): Promise<{ success: boolean; order?: any; error?: string }>;
  cancelOrder(orderId: string): Promise<boolean>;
  getOpenOrders(): Promise<Array<{ id: string; symbol: string; side: string; status: string }>>;
  getPosition(): Promise<any>;
  getBalance(): Promise<{ available: number; total: number }>;
  setLeverage(leverage: number): Promise<void>;
  subscribePrice(callback: (price: number) => void): void;
  unsubscribePrice(): void;
}

// ==================== BB BOT ENGINE ====================

export class BBBotEngine extends EventEmitter {
  private config: BBBotConfig;
  private state: BBBotState;
  private adapter: BBAdapter;
  
  // Analysis components
  private mtfConfirmation: MultiTimeframeConfirmation;
  private volumeFilter: VolumeConfirmationFilter;
  private divergenceDetector: DivergenceDetector;
  
  // Price tracking
  private currentPrice: number = 0;
  private priceHistory: number[] = [];
  private volumeHistory: number[] = [];
  
  // Intervals
  private priceCheckInterval: NodeJS.Timeout | null = null;
  private signalInterval: NodeJS.Timeout | null = null;
  
  // Signals
  private signals: BBSignal[] = [];
  private isProcessing: boolean = false;

  constructor(config: BBBotConfig, adapter: BBAdapter) {
    super();
    this.config = config;
    this.adapter = adapter;
    
    this.mtfConfirmation = new MultiTimeframeConfirmation({
      timeframes: config.timeframes,
      requiredConfirmations: config.requiredTimeframeConfirmations,
      weightedVoting: true,
    });
    
    this.volumeFilter = new VolumeConfirmationFilter({
      enabled: config.volumeFilterEnabled,
      minVolumeRatio: config.minVolumeRatio,
    });
    
    this.divergenceDetector = new DivergenceDetector();
    
    this.state = this.createInitialState();
  }

  // ==================== LIFECYCLE ====================

  async start(): Promise<{ success: boolean; error?: string }> {
    try {
      this.state.status = 'STARTING';
      this.emitEvent('BOT_STARTED', { config: this.config });

      await this.adapter.connect();
      this.currentPrice = await this.adapter.getCurrentPrice();
      
      if (this.config.leverage > 1) {
        await this.adapter.setLeverage(this.config.leverage);
      }
      
      this.startPriceMonitoring();
      this.startSignalAnalysis();
      
      this.state.status = 'RUNNING';
      this.state.startedAt = new Date();
      this.state.lastUpdate = new Date();
      
      this.emitEvent('BOT_INITIALIZED', {
        symbol: this.config.symbol,
        leverage: this.config.leverage,
        direction: this.config.direction,
      });

      return { success: true };
    } catch (error) {
      this.state.status = 'ERROR';
      this.emitEvent('ERROR', { error: error instanceof Error ? error.message : 'Unknown error' });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async stop(closePosition: boolean = true): Promise<void> {
    this.state.status = 'STOPPING';
    this.stopMonitoring();
    
    if (closePosition && this.state.position) {
      await this.closePosition('MANUAL');
    }
    
    await this.adapter.disconnect();
    
    this.state.status = 'STOPPED';
    this.state.stoppedAt = new Date();
    
    this.emitEvent('BOT_STOPPED', {
      totalPnl: this.state.totalPnl,
      totalTrades: this.state.totalTrades,
    });
  }

  async pause(): Promise<void> {
    if (this.state.status !== 'RUNNING') return;
    this.state.status = 'PAUSED';
    this.stopMonitoring();
    this.emitEvent('BOT_PAUSED', {});
  }

  async resume(): Promise<void> {
    if (this.state.status !== 'PAUSED') return;
    this.state.status = 'RUNNING';
    this.startPriceMonitoring();
    this.startSignalAnalysis();
    this.emitEvent('BOT_RESUMED', {});
  }

  // ==================== SIGNAL ANALYSIS ====================

  private startSignalAnalysis(): void {
    this.signalInterval = setInterval(async () => {
      if (this.state.status !== 'RUNNING') return;
      try {
        await this.analyzeAndGenerateSignal();
      } catch (error) {
        console.error('[BBBot] Signal analysis error:', error);
      }
    }, 60000); // Every minute
  }

  private async analyzeAndGenerateSignal(): Promise<BBSignal | null> {
    const ohlcv = await this.adapter.getOHLCV(this.config.primaryTimeframe, 100);
    const indicators = this.calculateIndicators(ohlcv);
    
    // Determine BB position
    const bbPosition = this.determineBBPosition(indicators);
    this.state.currentBBPosition = bbPosition;
    
    // Determine Stochastic position
    const stochPosition = this.determineStochPosition(indicators);
    this.state.currentStochPosition = stochPosition;
    
    // Update divergence detector
    this.divergenceDetector.addDataPoint(this.currentPrice, indicators.stochK);
    const divergence = this.config.divergenceFilterEnabled 
      ? this.divergenceDetector.detect(10) 
      : { detected: false, type: null };
    
    // Volume check
    const volumeCheck = this.volumeFilter.check(indicators.volume, this.volumeHistory);
    
    // Generate signal based on conditions
    let direction: 'LONG' | 'SHORT' = 'LONG';
    let confidence = 0;
    const conditions: string[] = [];
    
    // LONG conditions
    if (this.config.direction === 'LONG' || this.config.direction === 'BOTH') {
      if (bbPosition === 'LOWER' && stochPosition === 'OVERSOLD') {
        direction = 'LONG';
        confidence = 70;
        conditions.push('Price near lower BB + Stoch oversold');
      } else if (indicators.stochK > indicators.stochD && indicators.stochK < 20) {
        direction = 'LONG';
        confidence = 60;
        conditions.push('Stoch K crossing above D in oversold');
      }
    }
    
    // SHORT conditions
    if (this.config.direction === 'SHORT' || this.config.direction === 'BOTH') {
      if (bbPosition === 'UPPER' && stochPosition === 'OVERBOUGHT') {
        direction = 'SHORT';
        confidence = 70;
        conditions.push('Price near upper BB + Stoch overbought');
      } else if (indicators.stochK < indicators.stochD && indicators.stochK > 80) {
        direction = 'SHORT';
        confidence = 60;
        conditions.push('Stoch K crossing below D in overbought');
      }
    }
    
    // Adjust confidence based on filters
    if (!volumeCheck.confirmed) confidence *= 0.7;
    if (divergence.detected) {
      if (divergence.type === 'BULLISH' && direction === 'LONG') confidence *= 1.2;
      if (divergence.type === 'BEARISH' && direction === 'SHORT') confidence *= 1.2;
      if (divergence.type === 'BULLISH' && direction === 'SHORT') confidence *= 0.5;
      if (divergence.type === 'BEARISH' && direction === 'LONG') confidence *= 0.5;
    }
    
    const signal: BBSignal = {
      id: `bb-${Date.now()}`,
      timestamp: new Date(),
      symbol: this.config.symbol,
      timeframe: this.config.primaryTimeframe,
      direction,
      confidence: Math.min(100, confidence),
      bbUpper: indicators.upperOuter,
      bbMiddle: indicators.middleOuter,
      bbLower: indicators.lowerOuter,
      stochK: indicators.stochK,
      stochD: indicators.stochD,
      volume: indicators.volume,
      bbCondition: bbPosition,
      stochCondition: stochPosition,
      volumeCondition: volumeCheck.confirmed,
      divergence: divergence,
      executed: false,
    };
    
    // MTF confirmation
    if (this.config.mtfConfirmationEnabled) {
      const mtfResult = this.mtfConfirmation.getConfirmation();
      signal.mtfConfirmation = mtfResult;
      if (!mtfResult.confirmed) confidence *= 0.6;
    }
    
    // Only execute if confidence threshold met
    if (confidence >= 60 && conditions.length > 0) {
      this.signals.push(signal);
      this.state.lastSignal = signal;
      this.emitEvent('SIGNAL_GENERATED', { signal });
      
      // Execute if not in position
      if (!this.state.position && !this.isProcessing) {
        await this.executeSignal(signal);
      }
    }
    
    return signal;
  }

  // ==================== INDICATORS ====================

  private calculateIndicators(ohlcv: Array<{ high: number; low: number; close: number; volume: number }>): BBIndicators {
    const closes = ohlcv.map(c => c.close);
    const highs = ohlcv.map(c => c.high);
    const lows = ohlcv.map(c => c.low);
    const volumes = ohlcv.map(c => c.volume);
    
    // Bollinger Bands Inner
    const bbInner = this.calculateBB(closes, this.config.bbInnerPeriod, this.config.bbInnerDeviation);
    
    // Bollinger Bands Outer
    const bbOuter = this.calculateBB(closes, this.config.bbOuterPeriod, this.config.bbOuterDeviation);
    
    // Stochastic
    const stoch = this.calculateStochastic(highs, lows, closes, this.config.stochKPeriod, this.config.stochDPeriod, this.config.stochSlowing);
    
    // ATR
    const atr = this.calculateATR(highs, lows, closes, 14);
    
    // Volume
    const volume = volumes[volumes.length - 1];
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    
    return {
      upperInner: bbInner.upper,
      middleInner: bbInner.middle,
      lowerInner: bbInner.lower,
      upperOuter: bbOuter.upper,
      middleOuter: bbOuter.middle,
      lowerOuter: bbOuter.lower,
      stochK: stoch.k,
      stochD: stoch.d,
      atr,
      volume,
      avgVolume,
    };
  }

  private calculateBB(closes: number[], period: number, deviation: number): { upper: number; middle: number; lower: number } {
    const relevantCloses = closes.slice(-period);
    const middle = relevantCloses.reduce((a, b) => a + b, 0) / period;
    
    const squaredDiffs = relevantCloses.map(c => Math.pow(c - middle, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const stdDev = Math.sqrt(variance);
    
    return {
      upper: middle + stdDev * deviation,
      middle,
      lower: middle - stdDev * deviation,
    };
  }

  private calculateStochastic(highs: number[], lows: number[], closes: number[], kPeriod: number, dPeriod: number, slowing: number): { k: number; d: number } {
    const relevantHighs = highs.slice(-kPeriod * 2);
    const relevantLows = lows.slice(-kPeriod * 2);
    const relevantCloses = closes.slice(-kPeriod * 2);
    
    const kValues: number[] = [];
    for (let i = kPeriod - 1; i < relevantCloses.length; i++) {
      const periodHigh = Math.max(...relevantHighs.slice(i - kPeriod + 1, i + 1));
      const periodLow = Math.min(...relevantLows.slice(i - kPeriod + 1, i + 1));
      const close = relevantCloses[i];
      const k = ((close - periodLow) / (periodHigh - periodLow)) * 100;
      kValues.push(k);
    }
    
    const k = kValues.slice(-slowing).reduce((a, b) => a + b, 0) / slowing;
    const d = kValues.slice(-dPeriod).reduce((a, b) => a + b, 0) / dPeriod;
    
    return { k: isNaN(k) ? 50 : k, d: isNaN(d) ? 50 : d };
  }

  private calculateATR(highs: number[], lows: number[], closes: number[], period: number): number {
    const trValues: number[] = [];
    for (let i = 1; i < highs.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trValues.push(tr);
    }
    return trValues.slice(-period).reduce((a, b) => a + b, 0) / period;
  }

  private determineBBPosition(indicators: BBIndicators): 'UPPER' | 'MIDDLE' | 'LOWER' | 'OUTSIDE' {
    const price = this.currentPrice;
    if (price >= indicators.upperOuter) return 'OUTSIDE';
    if (price <= indicators.lowerOuter) return 'OUTSIDE';
    if (price >= indicators.upperInner) return 'UPPER';
    if (price <= indicators.lowerInner) return 'LOWER';
    return 'MIDDLE';
  }

  private determineStochPosition(indicators: BBIndicators): 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL' {
    if (indicators.stochK >= this.config.stochOverbought) return 'OVERBOUGHT';
    if (indicators.stochK <= this.config.stochOversold) return 'OVERSOLD';
    return 'NEUTRAL';
  }

  // ==================== EXECUTION ====================

  private async executeSignal(signal: BBSignal): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    
    try {
      const quantity = this.config.tradeAmount / this.currentPrice;
      
      const orderResult = await this.adapter.placeOrder({
        symbol: this.config.symbol,
        side: signal.direction === 'LONG' ? 'BUY' : 'SELL',
        type: 'MARKET',
        quantity,
        clientOrderId: `bb_${this.config.id}_${Date.now()}`,
      });
      
      if (!orderResult.success || !orderResult.order) {
        this.emitEvent('ERROR', { error: orderResult.error || 'Failed to execute signal' });
        return;
      }
      
      // Create position
      const position: BBPosition = {
        id: `pos_${Date.now()}`,
        symbol: this.config.symbol,
        direction: signal.direction,
        quantity: orderResult.order.filledQuantity || quantity,
        entryPrice: orderResult.order.avgPrice || this.currentPrice,
        avgEntryPrice: orderResult.order.avgPrice || this.currentPrice,
        totalInvested: this.config.tradeAmount,
        stopLoss: this.calculateStopLoss(this.currentPrice, signal.direction),
        takeProfits: this.calculateTakeProfits(this.currentPrice, signal.direction),
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        realizedPnl: 0,
        fees: orderResult.order.fee || 0,
        openedAt: new Date(),
        status: 'OPEN',
        bbEntryPosition: this.state.currentBBPosition,
        stochEntryPosition: this.state.currentStochPosition,
      };
      
      this.state.position = position;
      signal.executed = true;
      signal.positionId = position.id;
      
      this.emitEvent('POSITION_OPENED', { position, signal });
    } finally {
      this.isProcessing = false;
    }
  }

  private calculateStopLoss(price: number, direction: 'LONG' | 'SHORT'): number {
    if (this.config.manualStopLoss) return this.config.manualStopLoss;
    return direction === 'LONG' 
      ? price * (1 - this.config.stopLossPercent / 100)
      : price * (1 + this.config.stopLossPercent / 100);
  }

  private calculateTakeProfits(price: number, direction: 'LONG' | 'SHORT'): Array<{ price: number; percentage: number; status: 'PENDING' | 'TRIGGERED' | 'FILLED' }> {
    if (this.config.manualTargets) {
      return this.config.manualTargets.map(t => ({ ...t, status: 'PENDING' }));
    }
    
    const tpPrice = direction === 'LONG'
      ? price * (1 + this.config.takeProfitPercent / 100)
      : price * (1 - this.config.takeProfitPercent / 100);
    
    return [{ price: tpPrice, percentage: 100, status: 'PENDING' }];
  }

  private async closePosition(reason: BBPosition['closeReason']): Promise<void> {
    if (!this.state.position) return;
    
    const position = this.state.position;
    position.status = 'CLOSING';
    
    const orderResult = await this.adapter.placeOrder({
      symbol: this.config.symbol,
      side: position.direction === 'LONG' ? 'SELL' : 'BUY',
      type: 'MARKET',
      quantity: position.quantity,
      clientOrderId: `bb_close_${Date.now()}`,
    });
    
    if (orderResult.success && orderResult.order) {
      const closePrice = orderResult.order.avgPrice || this.currentPrice;
      position.realizedPnl = (closePrice - position.avgEntryPrice) * position.quantity * (position.direction === 'LONG' ? 1 : -1);
      position.status = 'CLOSED';
      position.closeReason = reason;
      position.closedAt = new Date();
      
      this.state.totalTrades++;
      this.state.totalPnl += position.realizedPnl;
      this.state.totalFees += position.fees + (orderResult.order.fee || 0);
      
      if (position.realizedPnl > 0) this.state.winTrades++;
      else this.state.lossTrades++;
      
      this.state.position = undefined;
      
      this.emitEvent('POSITION_CLOSED', { position, closePrice, pnl: position.realizedPnl, reason });
    }
  }

  // ==================== MONITORING ====================

  private startPriceMonitoring(): void {
    this.adapter.subscribePrice((price: number) => {
      this.handlePriceUpdate(price);
    });
    
    this.priceCheckInterval = setInterval(async () => {
      if (this.state.status !== 'RUNNING') return;
      try {
        const price = await this.adapter.getCurrentPrice();
        this.handlePriceUpdate(price);
      } catch (error) {
        console.error('[BBBot] Price check error:', error);
      }
    }, 5000);
  }

  private handlePriceUpdate(price: number): void {
    this.currentPrice = price;
    this.priceHistory.push(price);
    if (this.priceHistory.length > 1000) this.priceHistory = this.priceHistory.slice(-500);
    
    if (this.state.position) {
      this.updatePositionMetrics(price);
      this.checkRiskManagement();
    }
    
    this.state.lastUpdate = new Date();
    this.emitEvent('PRICE_UPDATE', { price });
  }

  private updatePositionMetrics(price: number): void {
    if (!this.state.position) return;
    
    const position = this.state.position;
    position.unrealizedPnl = (price - position.avgEntryPrice) * position.quantity * (position.direction === 'LONG' ? 1 : -1);
    position.unrealizedPnlPercent = (position.unrealizedPnl / position.totalInvested) * 100;
  }

  private checkRiskManagement(): void {
    if (!this.state.position) return;
    
    const position = this.state.position;
    
    // Stop loss check
    if (position.direction === 'LONG' && this.currentPrice <= position.stopLoss) {
      this.closePosition('SL');
      return;
    }
    if (position.direction === 'SHORT' && this.currentPrice >= position.stopLoss) {
      this.closePosition('SL');
      return;
    }
    
    // Take profit check
    for (const tp of position.takeProfits) {
      if (tp.status !== 'PENDING') continue;
      
      const hit = position.direction === 'LONG' 
        ? this.currentPrice >= tp.price 
        : this.currentPrice <= tp.price;
      
      if (hit) {
        tp.status = 'TRIGGERED';
        this.closePosition('TP');
        return;
      }
    }
    
    // Trailing stop
    if (this.config.trailingStopPercent && this.state.position.unrealizedPnlPercent > 0) {
      const trailPrice = position.direction === 'LONG'
        ? this.currentPrice * (1 - this.config.trailingStopPercent / 100)
        : this.currentPrice * (1 + this.config.trailingStopPercent / 100);
      
      if (!position.trailingStopPrice || 
          (position.direction === 'LONG' && trailPrice > position.trailingStopPrice) ||
          (position.direction === 'SHORT' && trailPrice < position.trailingStopPrice)) {
        position.trailingStopPrice = trailPrice;
        this.emitEvent('TRAILING_STOP_UPDATED', { trailingStopPrice: trailPrice });
      }
    }
  }

  private stopMonitoring(): void {
    if (this.priceCheckInterval) {
      clearInterval(this.priceCheckInterval);
      this.priceCheckInterval = null;
    }
    if (this.signalInterval) {
      clearInterval(this.signalInterval);
      this.signalInterval = null;
    }
    this.adapter.unsubscribePrice();
  }

  // ==================== HELPERS ====================

  private createInitialState(): BBBotState {
    return {
      id: this.config.id,
      status: 'IDLE',
      totalTrades: 0,
      winTrades: 0,
      lossTrades: 0,
      totalPnl: 0,
      totalFees: 0,
      totalVolume: 0,
      currentDrawdown: 0,
      maxDrawdownReached: 0,
      currentBBPosition: 'MIDDLE',
      currentStochPosition: 'NEUTRAL',
      lastUpdate: new Date(),
    };
  }

  private emitEvent(type: string, data: any): void {
    this.emit(type, { type, timestamp: new Date(), botId: this.config.id, data });
    this.emit('event', { type, timestamp: new Date(), botId: this.config.id, data });
  }

  // ==================== GETTERS ====================

  getConfig(): BBBotConfig { return this.config; }
  getState(): BBBotState { return { ...this.state }; }
  getSignals(): BBSignal[] { return [...this.signals]; }
  getCurrentPrice(): number { return this.currentPrice; }
}

export default BBBotEngine;
