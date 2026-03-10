/**
 * Argus Bot Engine
 * 
 * Полнофункциональный движок Argus торгового бота.
 * 
 * Features:
 * - Orderbook analysis for pump/dump confirmation
 * - Whale tracking
 * - Progressive circuit breaker
 * - Event-driven trading
 * - Real-time risk management
 */

import { EventEmitter } from 'events';
import {
  OrderbookAnalyzer,
  WhaleTracker,
  CircuitBreaker,
  OrderbookData,
  OrderbookSignal,
  OrderbookMetrics,
  WhaleOrder,
  WhaleActivity,
  CircuitBreakerState,
  OrderbookAnalyzerConfig,
  WhaleTrackerConfig,
  CircuitBreakerConfig,
} from './index';

// ==================== TYPES ====================

export interface ArgusBotConfig {
  id: string;
  symbol: string;
  exchangeId: string;
  marketType: 'spot' | 'futures';
  
  // Position settings
  tradeAmount: number;
  leverage: number;
  marginMode: 'isolated' | 'cross';
  
  // Orderbook analyzer
  orderbookConfig: Partial<OrderbookAnalyzerConfig>;
  
  // Whale tracker
  whaleConfig: Partial<WhaleTrackerConfig>;
  
  // Circuit breaker
  circuitBreakerConfig: Partial<CircuitBreakerConfig>;
  
  // Risk management
  stopLossPercent: number;
  takeProfitPercent: number;
  maxDrawdown: number;
  maxDailyLoss: number;
  
  // Confirmation thresholds
  pumpConfirmationThreshold: number;
  dumpConfirmationThreshold: number;
  whaleActivityThreshold: number;
  
  // Mode
  enableWhaleTracking: boolean;
  enableOrderbookAnalysis: boolean;
  requireBothConfirmations: boolean;
}

export interface ArgusBotState {
  id: string;
  status: 'IDLE' | 'STARTING' | 'RUNNING' | 'PAUSED' | 'STOPPED' | 'ERROR' | 'CIRCUIT_BREAKER';
  startedAt?: Date;
  stoppedAt?: Date;
  
  // Position
  position?: ArgusPosition;
  
  // Analysis state
  lastOrderbookSignal?: OrderbookSignal;
  lastWhaleSentiment?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  lastWhaleActivity?: WhaleActivity;
  
  // Metrics
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  totalPnl: number;
  totalFees: number;
  totalVolume: number;
  
  // Risk state
  currentDrawdown: number;
  maxDrawdownReached: number;
  dailyPnl: number;
  
  // Circuit breaker
  circuitBreakerState: CircuitBreakerState;
  
  // Last update
  lastUpdate: Date;
}

export interface ArgusPosition {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  avgEntryPrice: number;
  totalInvested: number;
  
  // Context
  entryReason: string;
  orderbookMetrics?: OrderbookMetrics;
  whaleActivity?: WhaleActivity;
  
  // Risk management
  stopLoss: number;
  takeProfit: number;
  
  // State
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  realizedPnl: number;
  fees: number;
  
  // Timing
  openedAt: Date;
  closedAt?: Date;
  closeReason?: 'TP' | 'SL' | 'MANUAL' | 'CIRCUIT_BREAKER' | 'DUMP_DETECTED';
  status: 'OPEN' | 'CLOSING' | 'CLOSED';
}

export interface ArgusSignal {
  id: string;
  timestamp: Date;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  confidence: number;
  
  // Confirmations
  orderbookConfirmed: boolean;
  whaleConfirmed: boolean;
  bothConfirmed: boolean;
  
  // Details
  orderbookSignal?: OrderbookSignal;
  whaleActivity?: WhaleActivity;
  
  // Execution
  executed: boolean;
  positionId?: string;
}

export interface ArgusAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getCurrentPrice(): Promise<number>;
  getOrderbook(depth: number): Promise<OrderbookData>;
  getRecentTrades(limit: number): Promise<Array<{ price: number; amount: number; side: 'BUY' | 'SELL'; timestamp: Date }>>;
  placeOrder(params: { symbol: string; side: 'BUY' | 'SELL'; type: 'MARKET' | 'LIMIT'; quantity: number; price?: number; clientOrderId?: string }): Promise<{ success: boolean; order?: any; error?: string }>;
  cancelOrder(orderId: string): Promise<boolean>;
  getOpenOrders(): Promise<Array<{ id: string; symbol: string; side: string; status: string }>>;
  getPosition(): Promise<any>;
  getBalance(): Promise<{ available: number; total: number }>;
  setLeverage(leverage: number): Promise<void>;
  subscribeOrderbook(callback: (data: OrderbookData) => void, depth: number): void;
  unsubscribeOrderbook(): void;
  subscribePrice(callback: (price: number) => void): void;
  unsubscribePrice(): void;
}

// ==================== ARGUS BOT ENGINE ====================

export class ArgusBotEngine extends EventEmitter {
  private config: ArgusBotConfig;
  private state: ArgusBotState;
  private adapter: ArgusAdapter;
  
  // Analysis components
  private orderbookAnalyzer: OrderbookAnalyzer;
  private whaleTracker: WhaleTracker;
  private circuitBreaker: CircuitBreaker;
  
  // Price tracking
  private currentPrice: number = 0;
  private priceHistory: number[] = [];
  
  // Intervals
  private priceCheckInterval: NodeJS.Timeout | null = null;
  private analysisInterval: NodeJS.Timeout | null = null;
  private dailyResetInterval: NodeJS.Timeout | null = null;
  
  // Signals
  private signals: ArgusSignal[] = [];
  private isProcessing: boolean = false;
  
  // Initial balance for circuit breaker
  private initialBalance: number = 10000;

  constructor(config: ArgusBotConfig, adapter: ArgusAdapter, initialBalance?: number) {
    super();
    this.config = config;
    this.adapter = adapter;
    this.initialBalance = initialBalance || 10000;
    
    // Initialize components
    this.orderbookAnalyzer = new OrderbookAnalyzer(config.orderbookConfig);
    this.whaleTracker = new WhaleTracker(config.whaleConfig);
    this.circuitBreaker = new CircuitBreaker(config.circuitBreakerConfig, this.initialBalance);
    
    this.state = this.createInitialState();
  }

  // ==================== LIFECYCLE ====================

  async start(): Promise<{ success: boolean; error?: string }> {
    try {
      this.state.status = 'STARTING';
      this.emitEvent('BOT_STARTED', { config: this.config });

      await this.adapter.connect();
      this.currentPrice = await this.adapter.getCurrentPrice();
      
      // Get initial balance
      const balance = await this.adapter.getBalance();
      this.initialBalance = balance.total;
      this.circuitBreaker.updateBalance(this.initialBalance);
      
      if (this.config.leverage > 1) {
        await this.adapter.setLeverage(this.config.leverage);
      }
      
      this.startMonitoring();
      this.startDailyReset();
      
      this.state.status = 'RUNNING';
      this.state.startedAt = new Date();
      this.state.lastUpdate = new Date();
      
      this.emitEvent('BOT_INITIALIZED', {
        symbol: this.config.symbol,
        leverage: this.config.leverage,
        initialBalance: this.initialBalance,
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
    
    // Clear tracking data
    this.orderbookAnalyzer.clearHistory();
    this.whaleTracker.clear();
    
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
    this.startMonitoring();
    this.emitEvent('BOT_RESUMED', {});
  }

  // ==================== ANALYSIS ====================

  private async analyze(): Promise<ArgusSignal | null> {
    let orderbookSignal: OrderbookSignal | undefined;
    let whaleActivity: WhaleActivity | undefined;
    let orderbookConfirmed = false;
    let whaleConfirmed = false;
    
    // Orderbook analysis
    if (this.config.enableOrderbookAnalysis) {
      try {
        const orderbook = await this.adapter.getOrderbook(20);
        const metrics = this.orderbookAnalyzer.analyze(orderbook);
        orderbookSignal = this.orderbookAnalyzer.generateSignal(metrics);
        this.state.lastOrderbookSignal = orderbookSignal;
        
        // Check for pump/dump confirmation
        if (orderbookSignal.type === 'BULLISH' && 
            orderbookSignal.confidence >= this.config.pumpConfirmationThreshold) {
          orderbookConfirmed = true;
        } else if (orderbookSignal.type === 'BEARISH' && 
            orderbookSignal.confidence >= this.config.dumpConfirmationThreshold) {
          orderbookConfirmed = true;
        }
      } catch (error) {
        console.error('[Argus] Orderbook analysis error:', error);
      }
    }
    
    // Whale tracking
    if (this.config.enableWhaleTracking) {
      try {
        const recentTrades = await this.adapter.getRecentTrades(100);
        
        for (const trade of recentTrades) {
          const whaleOrder = this.whaleTracker.trackOrder({
            timestamp: trade.timestamp,
            symbol: this.config.symbol,
            side: trade.side,
            price: trade.price,
            amount: trade.amount,
            value: trade.price * trade.amount,
            exchange: this.config.exchangeId,
          });
        }
        
        whaleActivity = this.whaleTracker.getActivity(this.config.symbol);
        this.state.lastWhaleActivity = whaleActivity;
        this.state.lastWhaleSentiment = this.whaleTracker.getSentiment(this.config.symbol);
        
        // Check whale confirmation
        const alert = this.whaleTracker.checkAlert(this.config.symbol);
        if (alert.alert && alert.value >= this.config.whaleActivityThreshold) {
          whaleConfirmed = true;
        }
      } catch (error) {
        console.error('[Argus] Whale tracking error:', error);
      }
    }
    
    // Determine signal direction
    let direction: 'LONG' | 'SHORT' = 'LONG';
    let confidence = 0;
    
    if (orderbookSignal) {
      if (orderbookSignal.type === 'BULLISH') {
        direction = 'LONG';
        confidence = orderbookSignal.confidence;
      } else if (orderbookSignal.type === 'BEARISH') {
        direction = 'SHORT';
        confidence = orderbookSignal.confidence;
      }
    }
    
    if (this.state.lastWhaleSentiment) {
      if (this.state.lastWhaleSentiment === 'BULLISH' && direction === 'LONG') {
        confidence = Math.min(100, confidence * 1.2);
      } else if (this.state.lastWhaleSentiment === 'BEARISH' && direction === 'SHORT') {
        confidence = Math.min(100, confidence * 1.2);
      } else if (this.state.lastWhaleSentiment !== 'NEUTRAL') {
        confidence *= 0.7; // Conflicting signals
      }
    }
    
    const bothConfirmed = orderbookConfirmed && whaleConfirmed;
    
    // Check if we should execute
    const shouldExecute = this.config.requireBothConfirmations
      ? bothConfirmed
      : orderbookConfirmed || whaleConfirmed;
    
    const signal: ArgusSignal = {
      id: `argus-${Date.now()}`,
      timestamp: new Date(),
      symbol: this.config.symbol,
      direction,
      confidence,
      orderbookConfirmed,
      whaleConfirmed,
      bothConfirmed,
      orderbookSignal,
      whaleActivity,
      executed: false,
    };
    
    if (shouldExecute && confidence >= 60) {
      this.signals.push(signal);
      this.emitEvent('SIGNAL_GENERATED', { signal });
      
      if (!this.state.position && !this.isProcessing) {
        await this.executeSignal(signal);
      }
    }
    
    return signal;
  }

  // ==================== EXECUTION ====================

  private async executeSignal(signal: ArgusSignal): Promise<void> {
    if (this.isProcessing) return;
    
    // Check circuit breaker
    const canTrade = this.circuitBreaker.canTrade();
    if (!canTrade.allowed) {
      this.emitEvent('CIRCUIT_BREAKER_ACTIVE', { reason: canTrade.reason });
      return;
    }
    
    this.isProcessing = true;
    
    try {
      const quantity = this.config.tradeAmount / this.currentPrice;
      
      const orderResult = await this.adapter.placeOrder({
        symbol: this.config.symbol,
        side: signal.direction === 'LONG' ? 'BUY' : 'SELL',
        type: 'MARKET',
        quantity,
        clientOrderId: `argus_${this.config.id}_${Date.now()}`,
      });
      
      if (!orderResult.success || !orderResult.order) {
        this.emitEvent('ERROR', { error: orderResult.error || 'Failed to execute signal' });
        return;
      }
      
      // Create position
      const position: ArgusPosition = {
        id: `pos_${Date.now()}`,
        symbol: this.config.symbol,
        direction: signal.direction,
        quantity: orderResult.order.filledQuantity || quantity,
        entryPrice: orderResult.order.avgPrice || this.currentPrice,
        avgEntryPrice: orderResult.order.avgPrice || this.currentPrice,
        totalInvested: this.config.tradeAmount,
        entryReason: signal.bothConfirmed 
          ? 'Orderbook + Whale confirmation'
          : signal.orderbookConfirmed 
            ? 'Orderbook confirmation'
            : 'Whale activity confirmation',
        orderbookMetrics: signal.orderbookSignal?.metrics,
        whaleActivity: signal.whaleActivity,
        stopLoss: this.calculateStopLoss(this.currentPrice, signal.direction),
        takeProfit: this.calculateTakeProfit(this.currentPrice, signal.direction),
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        realizedPnl: 0,
        fees: orderResult.order.fee || 0,
        openedAt: new Date(),
        status: 'OPEN',
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
    return direction === 'LONG' 
      ? price * (1 - this.config.stopLossPercent / 100)
      : price * (1 + this.config.stopLossPercent / 100);
  }

  private calculateTakeProfit(price: number, direction: 'LONG' | 'SHORT'): number {
    return direction === 'LONG'
      ? price * (1 + this.config.takeProfitPercent / 100)
      : price * (1 - this.config.takeProfitPercent / 100);
  }

  private async closePosition(reason: ArgusPosition['closeReason']): Promise<void> {
    if (!this.state.position) return;
    
    const position = this.state.position;
    position.status = 'CLOSING';
    
    const orderResult = await this.adapter.placeOrder({
      symbol: this.config.symbol,
      side: position.direction === 'LONG' ? 'SELL' : 'BUY',
      type: 'MARKET',
      quantity: position.quantity,
      clientOrderId: `argus_close_${Date.now()}`,
    });
    
    if (orderResult.success && orderResult.order) {
      const closePrice = orderResult.order.avgPrice || this.currentPrice;
      position.realizedPnl = (closePrice - position.avgEntryPrice) * position.quantity * (position.direction === 'LONG' ? 1 : -1);
      position.status = 'CLOSED';
      position.closeReason = reason;
      position.closedAt = new Date();
      
      // Record trade in circuit breaker
      const cbResult = this.circuitBreaker.recordTrade(position.realizedPnl);
      if (cbResult.triggered) {
        this.state.status = 'CIRCUIT_BREAKER';
        this.emitEvent('CIRCUIT_BREAKER_TRIGGERED', { reason: cbResult.reason });
      }
      
      // Update state
      this.state.totalTrades++;
      this.state.totalPnl += position.realizedPnl;
      this.state.totalFees += position.fees + (orderResult.order.fee || 0);
      this.state.dailyPnl += position.realizedPnl;
      
      if (position.realizedPnl > 0) this.state.winTrades++;
      else this.state.lossTrades++;
      
      this.state.position = undefined;
      
      this.emitEvent('POSITION_CLOSED', { position, closePrice, pnl: position.realizedPnl, reason });
    }
  }

  // ==================== MONITORING ====================

  private startMonitoring(): void {
    // Price monitoring
    this.adapter.subscribePrice((price: number) => {
      this.handlePriceUpdate(price);
    });
    
    // Orderbook monitoring
    if (this.config.enableOrderbookAnalysis) {
      this.adapter.subscribeOrderbook((data: OrderbookData) => {
        this.handleOrderbookUpdate(data);
      }, 20);
    }
    
    // Analysis interval
    this.analysisInterval = setInterval(async () => {
      if (this.state.status !== 'RUNNING') return;
      try {
        await this.analyze();
      } catch (error) {
        console.error('[Argus] Analysis error:', error);
      }
    }, 30000); // Every 30 seconds
    
    // Fallback price check
    this.priceCheckInterval = setInterval(async () => {
      if (this.state.status !== 'RUNNING') return;
      try {
        const price = await this.adapter.getCurrentPrice();
        this.handlePriceUpdate(price);
      } catch (error) {
        console.error('[Argus] Price check error:', error);
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

  private handleOrderbookUpdate(data: OrderbookData): void {
    const metrics = this.orderbookAnalyzer.analyze(data);
    const signal = this.orderbookAnalyzer.generateSignal(metrics);
    this.state.lastOrderbookSignal = signal;
    
    // Check for dump while in position
    if (this.state.position && this.orderbookAnalyzer.isDumpConfirmed(metrics)) {
      if (this.state.position.direction === 'LONG') {
        this.emitEvent('DUMP_DETECTED', { metrics });
        this.closePosition('DUMP_DETECTED');
      }
    }
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
    
    // Stop loss
    if (position.direction === 'LONG' && this.currentPrice <= position.stopLoss) {
      this.closePosition('SL');
      return;
    }
    if (position.direction === 'SHORT' && this.currentPrice >= position.stopLoss) {
      this.closePosition('SL');
      return;
    }
    
    // Take profit
    if (position.direction === 'LONG' && this.currentPrice >= position.takeProfit) {
      this.closePosition('TP');
      return;
    }
    if (position.direction === 'SHORT' && this.currentPrice <= position.takeProfit) {
      this.closePosition('TP');
      return;
    }
    
    // Max drawdown
    const drawdown = Math.abs(position.unrealizedPnlPercent);
    if (drawdown >= this.config.maxDrawdown) {
      this.closePosition('SL');
      return;
    }
    
    // Daily loss limit
    if (Math.abs(this.state.dailyPnl) >= this.config.maxDailyLoss) {
      this.closePosition('SL');
      this.state.status = 'CIRCUIT_BREAKER';
    }
  }

  private startDailyReset(): void {
    // Reset daily counters at midnight
    const resetDaily = () => {
      this.circuitBreaker.resetDaily();
      this.state.dailyPnl = 0;
      this.emitEvent('DAILY_RESET', {});
    };
    
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    
    setTimeout(() => {
      resetDaily();
      this.dailyResetInterval = setInterval(resetDaily, 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
  }

  private stopMonitoring(): void {
    if (this.priceCheckInterval) {
      clearInterval(this.priceCheckInterval);
      this.priceCheckInterval = null;
    }
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }
    if (this.dailyResetInterval) {
      clearInterval(this.dailyResetInterval);
      this.dailyResetInterval = null;
    }
    this.adapter.unsubscribePrice();
    this.adapter.unsubscribeOrderbook();
  }

  // ==================== MANUAL OVERRIDES ====================

  /**
   * Force reset circuit breaker (manual intervention)
   */
  forceResetCircuitBreaker(): void {
    this.circuitBreaker.forceReset();
    if (this.state.status === 'CIRCUIT_BREAKER') {
      this.state.status = 'RUNNING';
    }
    this.emitEvent('CIRCUIT_BREAKER_RESET', {});
  }

  /**
   * Check if manual reset is required
   */
  isManualResetRequired(): boolean {
    return this.circuitBreaker.isManualResetRequired();
  }

  // ==================== HELPERS ====================

  private createInitialState(): ArgusBotState {
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
      dailyPnl: 0,
      circuitBreakerState: this.circuitBreaker.getState(),
      lastUpdate: new Date(),
    };
  }

  private emitEvent(type: string, data: any): void {
    this.emit(type, { type, timestamp: new Date(), botId: this.config.id, data });
    this.emit('event', { type, timestamp: new Date(), botId: this.config.id, data });
  }

  // ==================== GETTERS ====================

  getConfig(): ArgusBotConfig { return this.config; }
  getState(): ArgusBotState { 
    this.state.circuitBreakerState = this.circuitBreaker.getState();
    return { ...this.state }; 
  }
  getSignals(): ArgusSignal[] { return [...this.signals]; }
  getCurrentPrice(): number { return this.currentPrice; }
  getCircuitBreakerState(): CircuitBreakerState { return this.circuitBreaker.getState(); }
}

export default ArgusBotEngine;
