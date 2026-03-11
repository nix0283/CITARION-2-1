// Institutional Bots - Common Types and Interfaces

export type BotStatus = 'stopped' | 'starting' | 'running' | 'pausing' | 'paused' | 'stopping' | 'error';
export type BotAlgorithm = 'SPECTRUM' | 'STA' | 'MM' | 'MR' | 'TRF';

export interface Signal {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  type: 'ENTRY' | 'EXIT' | 'STOP_LOSS' | 'TAKE_PROFIT';
  price: number;
  quantity: number;
  confidence: number;
  reason: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface Position {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  leverage: number;
  stopLoss?: number;
  takeProfit?: number;
  openedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface BotConfig {
  id: string;
  name: string;
  symbol: string;
  leverage: number;
  maxPositionSize: number;
  riskPerTrade: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BotState {
  status: BotStatus;
  lastError?: string;
  lastSignal?: Signal;
  positions: Position[];
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  maxDrawdown: number;
  startedAt?: Date;
  stoppedAt?: Date;
}

export interface MarketData {
  symbol: string;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorValues {
  [key: string]: number | number[];
}

export interface BotEngineResult {
  success: boolean;
  signal?: Signal;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  adjustedQuantity?: number;
}

// Base Engine Interface
export interface IBotEngine {
  readonly botType: BotAlgorithm;
  initialize(config: BotConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  onMarketData(data: MarketData): Promise<BotEngineResult>;
  getState(): BotState;
  getSignals(): Signal[];
  getPositions(): Position[];
  updateConfig(config: Partial<BotConfig>): Promise<void>;
}

// Abstract Base Engine
export abstract class BaseBotEngine implements IBotEngine {
  abstract readonly botType: BotAlgorithm;
  
  protected config: BotConfig | null = null;
  protected state: BotState = {
    status: 'stopped',
    positions: [],
    totalTrades: 0,
    winRate: 0,
    totalPnl: 0,
    maxDrawdown: 0,
  };
  protected signals: Signal[] = [];
  protected priceHistory: MarketData[] = [];
  protected readonly MAX_PRICE_HISTORY = 500;

  abstract initialize(config: BotConfig): Promise<void>;
  abstract onMarketData(data: MarketData): Promise<BotEngineResult>;
  protected abstract calculateIndicators(): IndicatorValues;
  protected abstract generateSignals(indicators: IndicatorValues): Signal | null;
  protected abstract validateSignal(signal: Signal): RiskCheckResult;

  async start(): Promise<void> {
    if (this.state.status === 'running') {
      throw new Error('Bot is already running');
    }
    this.state.status = 'starting';
    try {
      await this.onStart();
      this.state.status = 'running';
      this.state.startedAt = new Date();
    } catch (error) {
      this.state.status = 'error';
      this.state.lastError = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.state.status === 'stopped') {
      return;
    }
    this.state.status = 'stopping';
    try {
      await this.onStop();
      this.state.status = 'stopped';
      this.state.stoppedAt = new Date();
    } catch (error) {
      this.state.status = 'error';
      this.state.lastError = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  async pause(): Promise<void> {
    if (this.state.status !== 'running') {
      throw new Error('Can only pause a running bot');
    }
    this.state.status = 'paused';
    await this.onPause();
  }

  async resume(): Promise<void> {
    if (this.state.status !== 'paused') {
      throw new Error('Can only resume a paused bot');
    }
    this.state.status = 'running';
    await this.onResume();
  }

  getState(): BotState {
    return { ...this.state };
  }

  getSignals(): Signal[] {
    return [...this.signals];
  }

  getPositions(): Position[] {
    return [...this.state.positions];
  }

  async updateConfig(config: Partial<BotConfig>): Promise<void> {
    if (!this.config) {
      throw new Error('Bot not initialized');
    }
    this.config = { ...this.config, ...config };
    await this.onConfigUpdate(config);
  }

  // Protected lifecycle hooks
  protected async onStart(): Promise<void> {}
  protected async onStop(): Promise<void> {}
  protected async onPause(): Promise<void> {}
  protected async onResume(): Promise<void> {}
  protected async onConfigUpdate(_config: Partial<BotConfig>): Promise<void> {}

  // Protected helper methods
  protected addPriceData(data: MarketData): void {
    this.priceHistory.push(data);
    if (this.priceHistory.length > this.MAX_PRICE_HISTORY) {
      this.priceHistory.shift();
    }
  }

  protected addSignal(signal: Signal): void {
    this.signals.push(signal);
    this.state.lastSignal = signal;
    // Keep only last 100 signals
    if (this.signals.length > 100) {
      this.signals.shift();
    }
  }

  protected calculateSMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1] || 0;
    const slice = prices.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  protected calculateEMA(prices: number[], period: number): number {
    if (prices.length === 0) return 0;
    const multiplier = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }
    return ema;
  }

  protected calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }
    
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
  }

  protected calculateMACD(prices: number[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9): {
    macd: number;
    signal: number;
    histogram: number;
  } {
    const emaFast = this.calculateEMA(prices, fastPeriod);
    const emaSlow = this.calculateEMA(prices, slowPeriod);
    const macd = emaFast - emaSlow;
    
    // Simple signal line approximation
    const signal = macd * 0.9; // Simplified
    
    return {
      macd,
      signal,
      histogram: macd - signal,
    };
  }

  protected calculateATR(highs: number[], lows: number[], closes: number[], period: number = 14): number {
    if (highs.length < period) return 0;
    
    const trueRanges: number[] = [];
    for (let i = 1; i < highs.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trueRanges.push(tr);
    }
    
    return this.calculateSMA(trueRanges, period);
  }

  protected calculateBollingerBands(prices: number[], period: number = 20, stdDev: number = 2): {
    upper: number;
    middle: number;
    lower: number;
    bandwidth: number;
  } {
    const middle = this.calculateSMA(prices, period);
    const slice = prices.slice(-period);
    
    // Calculate standard deviation
    const squaredDiffs = slice.map(p => Math.pow(p - middle, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / slice.length;
    const std = Math.sqrt(avgSquaredDiff);
    
    const upper = middle + stdDev * std;
    const lower = middle - stdDev * std;
    const bandwidth = (upper - lower) / middle * 100;
    
    return { upper, middle, lower, bandwidth };
  }

  protected calculateADX(highs: number[], lows: number[], closes: number[], period: number = 14): number {
    if (highs.length < period * 2) return 25; // Default neutral value
    
    const trueRanges: number[] = [];
    const plusDMs: number[] = [];
    const minusDMs: number[] = [];
    
    for (let i = 1; i < highs.length; i++) {
      const upMove = highs[i] - highs[i - 1];
      const downMove = lows[i - 1] - lows[i];
      
      trueRanges.push(Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      ));
      
      plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
    
    const smoothedTR = this.calculateSMA(trueRanges.slice(-period), period);
    const smoothedPlusDM = this.calculateSMA(plusDMs.slice(-period), period);
    const smoothedMinusDM = this.calculateSMA(minusDMs.slice(-period), period);
    
    if (smoothedTR === 0) return 25;
    
    const plusDI = (smoothedPlusDM / smoothedTR) * 100;
    const minusDI = (smoothedMinusDM / smoothedTR) * 100;
    
    const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
    
    return dx;
  }
}
