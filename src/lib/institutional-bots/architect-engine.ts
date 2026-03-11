/**
 * ArchitectBot Engine - Market Maker Bot
 * 
 * Strategy: Market Making with Inventory Risk Management
 * Algorithm: Provides liquidity by placing bid/ask orders while managing inventory risk
 * 
 * Key Features:
 * - Symmetric and asymmetric spread management
 * - Inventory-skewed quoting (reduce inventory via price adjustments)
 * - Dynamic spread adjustment based on volatility
 * - Position delta hedging
 */

import { BaseBotEngine, BotConfig, MarketData, Signal, IndicatorValues, RiskCheckResult, BotEngineResult } from './types';

export interface ArchitectConfig extends BotConfig {
  baseSpreadBps: number; // Base spread in basis points
  minSpreadBps: number; // Minimum spread
  maxSpreadBps: number; // Maximum spread
  maxInventory: number; // Maximum inventory in base currency
  targetInventory: number; // Target inventory level
  inventorySkewFactor: number; // How much to skew quotes based on inventory
  orderRefreshInterval: number; // Milliseconds between order refreshes
  volatilityMultiplier: number; // Spread adjustment based on volatility
}

export interface Quote {
  bidPrice: number;
  askPrice: number;
  bidSize: number;
  askSize: number;
  spread: number;
  timestamp: Date;
}

export class ArchitectEngine extends BaseBotEngine {
  readonly botType = 'MM' as const;
  
  private architectConfig: ArchitectConfig | null = null;
  private currentQuote: Quote | null = null;
  private inventoryValue: number = 0;
  private orderBook: { bids: Array<[number, number]>; asks: Array<[number, number]> } = { bids: [], asks: [] };
  private lastRefreshTime: number = 0;
  private volatilityCache: number = 0;

  async initialize(config: BotConfig): Promise<void> {
    this.config = config;
    this.architectConfig = {
      ...config,
      baseSpreadBps: 10,
      minSpreadBps: 5,
      maxSpreadBps: 50,
      maxInventory: 1000,
      targetInventory: 0,
      inventorySkewFactor: 0.1,
      orderRefreshInterval: 1000,
      volatilityMultiplier: 1.5,
    };
    this.state = {
      status: 'stopped',
      positions: [],
      totalTrades: 0,
      winRate: 0,
      totalPnl: 0,
      maxDrawdown: 0,
    };
    this.signals = [];
    this.priceHistory = [];
    this.inventoryValue = 0;
  }

  async onMarketData(data: MarketData): Promise<BotEngineResult> {
    if (!this.architectConfig || this.state.status !== 'running') {
      return { success: false, error: 'Bot not running or not configured' };
    }

    this.addPriceData(data);

    const indicators = this.calculateIndicators();
    
    // Generate quotes periodically
    const now = Date.now();
    if (now - this.lastRefreshTime >= this.architectConfig.orderRefreshInterval) {
      this.lastRefreshTime = now;
      
      // Generate new quote
      const quote = this.generateQuote(indicators);
      this.currentQuote = quote;

      // Create signals for the quotes
      const signal = this.createQuoteSignals(quote, data);
      if (signal) {
        this.addSignal(signal);
        return { success: true, signal, metadata: { indicators, quote } };
      }
    }

    return { success: true, metadata: { indicators, currentQuote: this.currentQuote } };
  }

  protected calculateIndicators(): IndicatorValues {
    if (!this.architectConfig || this.priceHistory.length < 2) {
      return {};
    }

    const closes = this.priceHistory.map(d => d.close);
    const highs = this.priceHistory.map(d => d.high);
    const lows = this.priceHistory.map(d => d.low);
    const volumes = this.priceHistory.map(d => d.volume);
    const currentPrice = closes[closes.length - 1];

    // Volatility (ATR-based)
    const atr = this.calculateATR(highs, lows, closes, 14);
    this.volatilityCache = atr;

    // Volatility as percentage of price
    const volatilityPercent = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;

    // Volume profile
    const avgVolume = this.calculateSMA(volumes, 20);
    const volumeRatio = avgVolume > 0 ? volumes[volumes.length - 1] / avgVolume : 1;

    // Inventory metrics
    const inventoryDeviation = this.inventoryValue - (this.architectConfig.targetInventory || 0);
    const inventoryPercent = this.architectConfig.maxInventory > 0 
      ? this.inventoryValue / this.architectConfig.maxInventory 
      : 0;

    // Spread calculation
    const baseSpread = this.architectConfig.baseSpreadBps / 10000 * currentPrice;
    const volatilitySpread = baseSpread * this.volatilityMultiplier * (volatilityPercent / 2);
    const inventorySpread = this.calculateInventorySpreadAdjustment(currentPrice);
    const effectiveSpread = Math.max(
      this.architectConfig.minSpreadBps / 10000 * currentPrice,
      Math.min(
        this.architectConfig.maxSpreadBps / 10000 * currentPrice,
        baseSpread + volatilitySpread + inventorySpread
      )
    );

    return {
      currentPrice,
      atr,
      volatilityPercent,
      avgVolume,
      volumeRatio,
      inventoryValue: this.inventoryValue,
      inventoryDeviation,
      inventoryPercent,
      baseSpread,
      effectiveSpread,
      spreadBps: (effectiveSpread / currentPrice) * 10000,
    };
  }

  protected generateSignals(indicators: IndicatorValues): Signal | null {
    // ArchitectBot generates quotes, not direct signals
    // Signals are created in createQuoteSignals
    return null;
  }

  protected validateSignal(signal: Signal): RiskCheckResult {
    if (!this.architectConfig) {
      return { allowed: false, reason: 'Bot not configured' };
    }

    // Check inventory limits
    if (signal.direction === 'LONG') {
      const newInventory = this.inventoryValue + signal.quantity;
      if (newInventory > this.architectConfig.maxInventory) {
        return { 
          allowed: false, 
          reason: `Inventory would exceed maximum: ${newInventory} > ${this.architectConfig.maxInventory}` 
        };
      }
    } else if (signal.direction === 'SHORT') {
      const newInventory = this.inventoryValue - signal.quantity;
      if (Math.abs(newInventory) > this.architectConfig.maxInventory) {
        return { 
          allowed: false, 
          reason: `Short inventory would exceed maximum` 
        };
      }
    }

    return { allowed: true };
  }

  private generateQuote(indicators: IndicatorValues): Quote {
    if (!this.architectConfig) {
      throw new Error('Bot not configured');
    }

    const midPrice = indicators.currentPrice as number;
    const spread = indicators.effectiveSpread as number;
    const inventoryDeviation = indicators.inventoryDeviation as number;

    // Calculate inventory skew
    // If long inventory, skew quotes lower (worse bid, better ask) to encourage selling
    // If short inventory, skew quotes higher (better bid, worse ask) to encourage buying
    const skew = this.calculateInventorySkew(inventoryDeviation, midPrice);

    const halfSpread = spread / 2;
    const bidPrice = midPrice - halfSpread + skew;
    const askPrice = midPrice + halfSpread + skew;

    // Adjust sizes based on inventory
    const { bidSize, askSize } = this.calculateOrderSizes(inventoryDeviation);

    return {
      bidPrice,
      askPrice,
      bidSize,
      askSize,
      spread: askPrice - bidPrice,
      timestamp: new Date(),
    };
  }

  private calculateInventorySkew(inventoryDeviation: number, midPrice: number): number {
    if (!this.architectConfig) return 0;

    const maxInv = this.architectConfig.maxInventory;
    const skewFactor = this.architectConfig.inventorySkewFactor;

    // Normalized inventory deviation (-1 to 1)
    const normalizedDeviation = maxInv > 0 ? inventoryDeviation / maxInv : 0;

    // Skew amount in price terms
    return normalizedDeviation * skewFactor * midPrice * 0.01;
  }

  private calculateInventorySpreadAdjustment(price: number): number {
    if (!this.architectConfig) return 0;

    const invPercent = Math.abs(this.inventoryValue) / this.architectConfig.maxInventory;
    
    // Increase spread as inventory approaches limits
    return invPercent * price * 0.001;
  }

  private calculateOrderSizes(inventoryDeviation: number): { bidSize: number; askSize: number } {
    if (!this.architectConfig) {
      return { bidSize: 0, askSize: 0 };
    }

    const baseSize = this.architectConfig.maxPositionSize;
    const maxInv = this.architectConfig.maxInventory;

    // Reduce size on the side that would increase inventory
    const inventoryRatio = maxInv > 0 ? inventoryDeviation / maxInv : 0;

    let bidSize = baseSize;
    let askSize = baseSize;

    // If we have positive inventory, reduce bid size (don't want to buy more)
    if (inventoryRatio > 0) {
      bidSize = baseSize * (1 - inventoryRatio);
    }
    // If we have negative inventory (short), reduce ask size (don't want to sell more)
    else if (inventoryRatio < 0) {
      askSize = baseSize * (1 + inventoryRatio);
    }

    return { 
      bidSize: Math.max(bidSize, baseSize * 0.1), 
      askSize: Math.max(askSize, baseSize * 0.1) 
    };
  }

  private createQuoteSignals(quote: Quote, data: MarketData): Signal | null {
    if (!this.architectConfig) return null;

    const symbol = data.symbol;
    
    // Create a quote signal that represents the market making opportunity
    return {
      id: `MM-${Date.now()}-${symbol}`,
      symbol,
      direction: 'LONG', // Neutral - we're providing both sides
      type: 'ENTRY',
      price: (quote.bidPrice + quote.askPrice) / 2, // Mid price
      quantity: (quote.bidSize + quote.askSize) / 2,
      confidence: 0.7,
      reason: `Market making quote: Bid ${quote.bidSize.toFixed(4)} @ ${quote.bidPrice.toFixed(2)}, Ask ${quote.askSize.toFixed(4)} @ ${quote.askPrice.toFixed(2)}, Spread ${(quote.spread * 10000 / quote.bidPrice).toFixed(1)} bps`,
      timestamp: new Date(),
      metadata: {
        strategy: 'MARKET_MAKING',
        quote,
        inventoryValue: this.inventoryValue,
        volatility: this.volatilityCache,
      },
    };
  }

  // Update inventory from filled orders
  updateInventory(fill: { direction: 'LONG' | 'SHORT'; quantity: number; price: number }): void {
    if (fill.direction === 'LONG') {
      this.inventoryValue += fill.quantity;
    } else {
      this.inventoryValue -= fill.quantity;
    }

    // Update state
    if (this.state) {
      this.state.totalTrades++;
    }
  }

  // Get current quote
  getCurrentQuote(): Quote | null {
    return this.currentQuote;
  }

  // Get inventory status
  getInventoryStatus(): { value: number; percentOfMax: number; deviation: number } {
    if (!this.architectConfig) {
      return { value: 0, percentOfMax: 0, deviation: 0 };
    }

    return {
      value: this.inventoryValue,
      percentOfMax: Math.abs(this.inventoryValue) / this.architectConfig.maxInventory,
      deviation: this.inventoryValue - this.architectConfig.targetInventory,
    };
  }

  updateArchitectConfig(updates: Partial<ArchitectConfig>): void {
    if (this.architectConfig) {
      this.architectConfig = { ...this.architectConfig, ...updates };
    }
  }

  // Set target inventory
  setTargetInventory(target: number): void {
    if (this.architectConfig) {
      this.architectConfig.targetInventory = target;
    }
  }
}

// Export singleton factory
let architectEngineInstance: ArchitectEngine | null = null;

export function getArchitectEngine(): ArchitectEngine {
  if (!architectEngineInstance) {
    architectEngineInstance = new ArchitectEngine();
  }
  return architectEngineInstance;
}
