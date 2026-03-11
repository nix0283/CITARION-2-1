/**
 * DCA Bot Types
 * 
 * Complete type definitions for DCA Bot module.
 */

import { VolatilityLevel, VolatilityReading, ScalingResult } from './volatility-scaler';

// ==================== DCA BOT CONFIG ====================

export interface DCABotConfig {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  
  // Entry settings
  entryType: 'market' | 'limit' | 'scheduled' | 'signal' | 'hybrid';
  entryPrice?: number;
  entryInterval?: number; // minutes for scheduled entries
  
  // Base order settings
  baseOrderType: 'fixed' | 'percent';
  baseOrderAmount: number;
  
  // Leverage
  leverage: number;
  
  // Safety orders
  safetyOrdersEnabled: boolean;
  safetyOrdersCount: number;
  maxSafetyOrders: number;
  safetyOrderPriceDeviation: number;
  safetyOrderVolumeScale: number;
  
  // Take Profit
  takeProfitEnabled: boolean;
  takeProfitType: 'total' | 'perLevel';
  takeProfitPercent: number;
  takeProfitPerLevel?: Array<{ profitPercent: number; closePercent: number }>;
  
  // Stop Loss
  stopLossEnabled: boolean;
  stopLossType: 'total' | 'trailing';
  stopLossPercent: number;
  
  // Trailing Stop
  trailingStopEnabled: boolean;
  trailingStopActivation: number;
  trailingStopDistance: number;
  
  // Averaging
  averagingEnabled: boolean;
  averagingThreshold: number;
  averagingScale: number;
  
  // Risk management
  maxDrawdown: number;
  maxDailyLoss: number;
  maxOpenTime?: number; // hours
  
  // Volatility Scaling (NEW)
  volatilityScalingEnabled: boolean;
  volatilityLookbackPeriod: number;
  minVolatilityThreshold: number;
  maxVolatilityThreshold: number;
  extremeVolatilityThreshold?: number;
}

// ==================== DCA BOT STATE ====================

export interface DCABotState {
  id: string;
  status: DCABotStatus;
  position: DCAPosition | null;
  safetyOrders: SafetyOrder[];
  pendingSafetyOrders: number;
  takeProfitLevels: TakeProfitLevel[];
  
  // Statistics
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  totalPnl: number;
  totalFees: number;
  totalVolume: number;
  
  // Drawdown tracking
  currentDrawdown: number;
  maxDrawdown: number;
  maxDrawdownPercent?: number;
  
  // Daily tracking
  dailyPnl: number;
  dailyLoss: number;
  
  // Price tracking
  currentPrice: number;
  highestPrice: number;
  lowestPrice: number;
  entryPrice?: number;
  lastEntryTime?: Date;
  
  // Trailing stop
  trailingActivated: boolean;
  trailingStopPrice?: number;
  
  // Timestamps
  startedAt?: Date;
  stoppedAt?: Date;
  lastUpdate: Date;
  
  // Volatility Scaling State (NEW)
  lastVolatilityReading: VolatilityReading | null;
  currentVolatilityLevel: VolatilityLevel;
  scalingHistory: ScalingHistoryEntry[];
}

export type DCABotStatus = 
  | 'IDLE' 
  | 'STARTING' 
  | 'RUNNING' 
  | 'IN_POSITION' 
  | 'PAUSED' 
  | 'STOPPING' 
  | 'STOPPED' 
  | 'ERROR';

// ==================== POSITION ====================

export interface DCAPosition {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entries: DCAEntry[];
  totalQuantity: number;
  avgEntryPrice: number;
  totalInvested: number;
  
  // Safety orders tracking
  safetyOrdersUsed: number;
  safetyOrdersRemaining: number;
  
  // PnL
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  realizedPnl: number;
  
  // Costs
  fees: number;
  funding: number;
  
  // Levels
  currentLevel: number;
  nextSafetyOrderPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  
  // Timing
  openedAt: Date;
  lastUpdate: Date;
  durationMinutes: number;
  
  // Status
  status: 'OPEN' | 'CLOSING' | 'CLOSED';
  closeReason?: 'TAKE_PROFIT' | 'STOP_LOSS' | 'MANUAL' | 'MAX_TIME' | 'LIQUIDATION';
}

export interface DCAEntry {
  index: number;
  type: 'BASE' | 'SAFETY' | 'AVERAGING';
  price: number;
  quantity: number;
  amount: number;
  order?: DCAOrder;
  timestamp: Date;
}

export interface DCAOrder {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  status: 'PENDING' | 'FILLED' | 'CANCELLED' | 'FAILED';
  quantity: number;
  filledQuantity: number;
  avgPrice: number;
  price?: number;
  fee: number;
  timestamp: Date;
  clientOrderId?: string;
}

// ==================== SAFETY ORDERS ====================

export interface SafetyOrder {
  level: number;
  triggerPrice: number;
  triggerDeviation: number;
  quantity: number;
  amount: number;
  status: 'PENDING' | 'TRIGGERED' | 'FILLED' | 'CANCELLED';
  order?: DCAOrder;
  triggeredAt?: Date;
  filledAt?: Date;
  filledPrice?: number;
}

// ==================== TAKE PROFIT ====================

export interface TakeProfitLevel {
  level: number;
  profitPercent: number;
  closePercent: number;
  status: 'PENDING' | 'TRIGGERED' | 'FILLED';
  filledAt?: Date;
  filledPrice?: number;
}

// ==================== SIGNAL ====================

export interface DCASignal {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice?: number;
  entryPrices?: number[];
  stopLoss?: number;
  takeProfit?: number;
  takeProfits?: Array<{ price: number; percentage: number }>;
  leverage?: number;
  source: string;
  timestamp: Date;
}

// ==================== METRICS ====================

export interface DCABotMetrics {
  // Returns
  totalReturn: number;
  totalReturnPercent: number;
  avgReturnPerTrade: number;
  
  // Risk metrics
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  
  // Trade stats
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  avgTradeDuration: number;
  
  // DCA specific
  avgSafetyOrdersUsed: number;
  avgEntriesPerPosition: number;
  avgCostReduction: number;
  safetyOrderSuccessRate: number;
  
  // Execution
  totalFees: number;
  avgSlippage: number;
  orderFillRate: number;
}

// ==================== ADAPTER ====================

export interface DCABotAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getCurrentPrice(): Promise<number>;
  subscribePrice(callback: (price: number) => void): void;
  unsubscribePrice(): void;
  setLeverage(leverage: number): Promise<void>;
  placeOrder(request: DCAOrderRequest): Promise<DCAOrderResult>;
  getBalance?(): Promise<number>;
  getPosition?(symbol: string): Promise<DCAPositionInfo | null>;
}

export interface DCAOrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  quantity: number;
  price?: number;
  clientOrderId?: string;
}

export interface DCAOrderResult {
  success: boolean;
  order?: DCAOrder;
  error?: string;
}

export interface DCABalanceInfo {
  availableBalance: number;
  totalBalance: number;
  usedMargin: number;
  unrealizedPnl: number;
}

export interface DCAPositionInfo {
  symbol: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  margin: number;
  liquidationPrice?: number;
}

// ==================== EVENTS ====================

export interface DCABotEvent {
  type: DCABotEventType;
  timestamp: Date;
  botId: string;
  data: any;
}

export type DCABotEventType =
  | 'BOT_STARTED'
  | 'BOT_STOPPED'
  | 'BOT_PAUSED'
  | 'BOT_RESUMED'
  | 'POSITION_OPENED'
  | 'POSITION_CLOSED'
  | 'SAFETY_ORDER_TRIGGERED'
  | 'SAFETY_ORDER_FILLED'
  | 'TAKE_PROFIT_TRIGGERED'
  | 'TAKE_PROFIT_FILLED'
  | 'STOP_LOSS_TRIGGERED'
  | 'TRAILING_STOP_ACTIVATED'
  | 'TRAILING_STOP_UPDATED'
  | 'AVERAGING_TRIGGERED'
  | 'MAX_TIME_REACHED'
  | 'MAX_DRAWDOWN_REACHED'
  | 'PRICE_UPDATE'
  | 'VOLATILITY_UPDATE'
  | 'ERROR';

// ==================== VOLATILITY SCALING HISTORY ====================

export interface ScalingHistoryEntry {
  timestamp: Date;
  atrPercent: number;
  volatilityLevel: VolatilityLevel;
  positionSizeMultiplier: number;
  levelSpacingMultiplier: number;
}

// ==================== DEFAULT CONFIG ====================

export const DEFAULT_DCA_BOT_CONFIG: Partial<DCABotConfig> = {
  direction: 'LONG',
  entryType: 'signal',
  baseOrderType: 'fixed',
  baseOrderAmount: 100,
  leverage: 1,
  safetyOrdersEnabled: true,
  safetyOrdersCount: 5,
  maxSafetyOrders: 5,
  safetyOrderPriceDeviation: 2,
  safetyOrderVolumeScale: 1.5,
  takeProfitEnabled: true,
  takeProfitType: 'total',
  takeProfitPercent: 10,
  stopLossEnabled: false,
  stopLossType: 'total',
  stopLossPercent: 10,
  trailingStopEnabled: false,
  trailingStopActivation: 5,
  trailingStopDistance: 2,
  averagingEnabled: false,
  averagingThreshold: 5,
  averagingScale: 1.5,
  maxDrawdown: 30,
  maxDailyLoss: 10,
  volatilityScalingEnabled: false,
  volatilityLookbackPeriod: 14,
  minVolatilityThreshold: 1.5,
  maxVolatilityThreshold: 3.5,
  extremeVolatilityThreshold: 6.0,
};
