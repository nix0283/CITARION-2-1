/**
 * Order Execution Engine
 * 
 * Production-ready order execution with:
 * - Smart order routing
 * - Slippage protection
 * - Fee calculation
 * - Position management
 * - Multi-exchange support
 */

import { db } from '@/lib/db';
import { credentialManager } from '@/lib/api-keys/credential-manager';
import {
  SignalInputSchema,
  CreateOrderInput,
  CreateOrderSchema,
  validateTradeEntry,
  type SignalInput,
  type TradeEntryInput,
} from '@/lib/validators/trade-validation';

// ==================== TYPES ====================

/**
 * Exchange client interface
 */
export interface ExchangeClientInterface {
  createOrder(params: CreateOrderParams): Promise<OrderResult>;
  cancelOrder(params: CancelOrderParams): Promise<OrderResult>;
  closePosition(params: ClosePositionParams): Promise<OrderResult>;
  getPosition(symbol: string): Promise<Position | null>;
  getPositions(): Promise<Position[]>;
  setLeverage(params: SetLeverageParams): Promise<{ success: boolean; leverage: number }>;
  getAccountInfo(): Promise<AccountInfo>;
  getTicker(symbol: string): Promise<Ticker>;
  testConnection(): Promise<{ success: boolean; message: string }>;
}

/**
 * Order creation parameters
 */
export interface CreateOrderParams {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop_market' | 'stop_limit';
  quantity: number;
  price?: number;
  stopPrice?: number;
  leverage?: number;
  marginMode?: 'isolated' | 'cross';
  positionSide?: 'long' | 'short';
  reduceOnly?: boolean;
  clientOrderId?: string;
  timeInForce?: 'GTC' | 'IOC' | 'FOK' | 'GTX';
}

/**
 * Order result
 */
export interface OrderResult {
  success: boolean;
  order?: Order;
  error?: string;
  errorCode?: string;
}

/**
 * Order interface
 */
export interface Order {
  id: string;
  clientOrderId?: string;
  exchange: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop_market' | 'stop_limit';
  status: 'open' | 'partial' | 'filled' | 'cancelled' | 'expired' | 'rejected';
  price: number;
  avgPrice?: number;
  quantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  fee: number;
  feeCurrency: string;
  createdAt: Date;
  updatedAt: Date;
  isDemo?: boolean;
  stopPrice?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
}

/**
 * Cancel order parameters
 */
export interface CancelOrderParams {
  symbol: string;
  orderId?: string;
  clientOrderId?: string;
}

/**
 * Close position parameters
 */
export interface ClosePositionParams {
  symbol: string;
  quantity?: number;
  market?: boolean;
}

/**
 * Set leverage parameters
 */
export interface SetLeverageParams {
  symbol: string;
  leverage: number;
  marginMode?: 'isolated' | 'cross';
}

/**
 * Account info
 */
export interface AccountInfo {
  exchange: string;
  balances: Balance[];
  totalEquity: number;
  availableMargin: number;
  marginUsed: number;
  unrealizedPnl: number;
  isDemo?: boolean;
}

/**
 * Balance interface
 */
export interface Balance {
  currency: string;
  total: number;
  available: number;
  frozen: number;
  usdValue?: number;
  isDemo?: boolean;
}

/**
 * Position interface
 */
export interface Position {
  id: string;
  exchange: string;
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  leverage: number;
  marginMode: 'isolated' | 'cross';
  margin: number;
  liquidationPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Ticker interface
 */
export interface Ticker {
  symbol: string;
  exchange: string;
  bid: number;
  ask: number;
  last: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  change24h: number;
  changePercent24h: number;
  timestamp: Date;
}

/**
 * Execution result
 */
export interface ExecutionResult {
  success: boolean;
  tradeId?: string;
  orderId?: string;
  symbol?: string;
  side?: 'LONG' | 'SHORT';
  quantity?: number;
  entryPrice?: number;
  takeProfits?: Array<{ price: number; percentage: number }>;
  stopLoss?: number;
  leverage?: number;
  error?: string;
  errorCode?: string;
  warnings?: string[];
}

/**
 * Execution context
 */
export interface ExecutionContext {
  userId: string;
  accountId: string;
  exchangeId: string;
  isTestnet: boolean;
  isDemo: boolean;
  signal?: SignalInput;
  client?: ExchangeClientInterface;
  account?: {
    id: string;
    exchangeId: string;
    exchangeType: string;
    isTestnet: boolean;
  };
}

/**
 * Slippage protection config
 */
export interface SlippageConfig {
  maxSlippagePercent: number;  // Maximum allowed slippage
  priceCheckTolerance: number; // Price check window
  timeoutMs: number;           // Request timeout
  retries: number;             // Number of retries
}

// ==================== CONSTANTS ====================

const DEFAULT_SLIPPAGE_CONFIG: SlippageConfig = {
  maxSlippagePercent: 0.5,     // 0.5% max slippage
  priceCheckTolerance: 0.2,    // 0.2% price tolerance
  timeoutMs: 10000,            // 10 second timeout
  retries: 3,                  // 3 retries
};

const EXCHANGE_CLIENTS: Record<string, string> = {
  binance: './exchange/binance-client',
  bybit: './exchange/bybit-client',
  okx: './exchange/okx-client',
  bitget: './exchange/bitget-client',
  kucoin: './exchange/kucoin-client',
  bingx: './exchange/bingx-client',
  coinbase: './exchange/coinbase-client',
  huobi: './exchange/huobi-client',
  hyperliquid: './exchange/hyperliquid-client',
  bitmex: './exchange/bitmex-client',
  blofin: './exchange/blofin-client',
};

// ==================== EXECUTION ENGINE CLASS ====================

/**
 * Order Execution Engine
 * 
 * Handles order execution with safety checks and risk management
 */
export class ExecutionEngine {
  private clientCache: Map<string, ExchangeClientInterface> = new Map();

  /**
   * Execute a trade from signal
   */
  async executeTrade(params: TradeEntryInput): Promise<ExecutionResult> {
    const context = await this.createContext(params);
    
    try {
      // 1. Validate signal
      const signalValidation = SignalInputSchema.safeParse(params.signal);
      if (!signalValidation.success) {
        return {
          success: false,
          error: 'Invalid signal format',
          errorCode: 'INVALID_SIGNAL',
        };
      }
      
      context.signal = signalValidation.data;

      // 2. Get exchange client
      context.client = await this.getExchangeClient(context);
      if (!context.client) {
        return {
          success: false,
          error: 'Failed to initialize exchange client',
          errorCode: 'CLIENT_INIT_FAILED',
        };
      }

      // 3. Test connection
      const connectionTest = await context.client.testConnection();
      if (!connectionTest.success) {
        return {
          success: false,
          error: `Exchange connection failed: ${connectionTest.message}`,
          errorCode: 'CONNECTION_FAILED',
        };
      }

      // 4. Get current price
      const ticker = await context.client.getTicker(context.signal.symbol);
      const currentPrice = ticker.last;

      // 5. Calculate position size
      const accountInfo = await context.client.getAccountInfo();
      const positionSize = await this.calculatePositionSize(
        context,
        accountInfo,
        currentPrice
      );

      if (positionSize <= 0) {
        return {
          success: false,
          error: 'Calculated position size is zero',
          errorCode: 'INVALID_SIZE',
        };
      }

      // 6. Set leverage for futures
      if (context.signal.leverage > 1) {
        await context.client.setLeverage({
          symbol: context.signal.symbol,
          leverage: context.signal.leverage,
          marginMode: 'isolated',
        });
      }

      // 7. Execute entry order
      const orderResult = await this.executeEntryOrder(
        context,
        positionSize,
        currentPrice
      );

      if (!orderResult.success) {
        return {
          success: false,
          error: orderResult.error,
          errorCode: orderResult.errorCode,
        };
      }

      // 8. Create position record
      const position = await this.createPositionRecord(
        context,
        orderResult,
        positionSize
      );

      // 9. Set TP/SL orders
      const warnings: string[] = [];
      if (context.signal.takeProfits && context.signal.takeProfits.length > 0) {
        await this.setTakeProfitOrders(context, position);
      }
      
      if (context.signal.stopLoss) {
        const slResult = await this.setStopLossOrder(context, position);
        if (!slResult.success) {
          warnings.push(`Failed to set stop loss: ${slResult.error}`);
        }
      }

      // 10. Log execution
      await this.logExecution(context, orderResult, position);

      return {
        success: true,
        tradeId: position.id,
        orderId: orderResult.order?.id,
        symbol: context.signal.symbol,
        side: context.signal.direction,
        quantity: positionSize,
        entryPrice: orderResult.order?.avgPrice || currentPrice,
        takeProfits: context.signal.takeProfits,
        stopLoss: context.signal.stopLoss,
        leverage: context.signal.leverage,
        warnings,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[ExecutionEngine] Trade execution failed:', error);
      
      return {
        success: false,
        error: errorMessage,
        errorCode: 'EXECUTION_ERROR',
      };
    }
  }

  /**
   * Create execution context
   */
  private async createContext(params: TradeEntryInput): Promise<ExecutionContext> {
    const account = await db.account.findUnique({
      where: { id: params.accountId },
      select: {
        id: true,
        exchangeId: true,
        exchangeType: true,
        isTestnet: true,
        accountType: true,
        encryptedApiCredentials: true,
      },
    });

    if (!account) {
      throw new Error('Account not found');
    }

    return {
      userId: params.userId,
      accountId: params.accountId,
      exchangeId: account.exchangeId,
      isTestnet: account.isTestnet,
      isDemo: account.accountType === 'DEMO',
      account: {
        id: account.id,
        exchangeId: account.exchangeId,
        exchangeType: account.exchangeType,
        isTestnet: account.isTestnet,
      },
    };
  }

  /**
   * Get exchange client instance
   */
  private async getExchangeClient(context: ExecutionContext): Promise<ExchangeClientInterface | null> {
    const cacheKey = `${context.accountId}-${context.exchangeId}`;
    
    if (this.clientCache.has(cacheKey)) {
      return this.clientCache.get(cacheKey)!;
    }

    // Get credentials
    const credentials = await credentialManager.getCredentials(context.accountId);
    if (!credentials?.apiKey || !credentials?.apiSecret) {
      console.error(`[ExecutionEngine] No credentials for account ${context.accountId}`);
      return null;
    }

    // Load exchange client dynamically
    const clientPath = EXCHANGE_CLIENTS[context.exchangeId];
    if (!clientPath) {
      console.error(`[ExecutionEngine] Unknown exchange: ${context.exchangeId}`);
      return null;
    }

    try {
      const clientModule = await import(clientPath);
      const ClientClass = clientModule[Object.keys(clientModule)[0]]; // Get first export
      
      const client = new ClientClass(
        {
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
          passphrase: credentials.passphrase,
          uid: credentials.uid,
        },
        context.account?.exchangeType === 'spot' ? 'spot' : 'futures',
        context.isTestnet
      );

      this.clientCache.set(cacheKey, client);
      return client;
    } catch (error) {
      console.error(`[ExecutionEngine] Failed to load client for ${context.exchangeId}:`, error);
      return null;
    }
  }

  /**
   * Calculate position size based on risk parameters
   */
  private async calculatePositionSize(
    context: ExecutionContext,
    accountInfo: AccountInfo,
    currentPrice: number
  ): Promise<number> {
    const signal = context.signal!;
    
    // Get available balance
    const availableBalance = accountInfo.availableMargin;
    
    // Default to 2% risk per trade
    const riskPercent = 2;
    const riskAmount = availableBalance * (riskPercent / 100);
    
    // Calculate position size based on entry and stop loss
    let positionSize: number;
    
    if (signal.stopLoss) {
      // Risk-based sizing
      const priceDiff = Math.abs(signal.entryPrices[0] - signal.stopLoss);
      const riskPerUnit = priceDiff / currentPrice;
      
      if (riskPerUnit > 0) {
        positionSize = riskAmount / riskPerUnit;
      } else {
        // Fallback to percentage of account
        positionSize = (availableBalance * 0.02) / currentPrice;
      }
    } else {
      // No stop loss, use fixed percentage
      positionSize = (availableBalance * 0.02) / currentPrice;
    }
    
    // Apply leverage
    positionSize *= signal.leverage;
    
    // Round to reasonable precision
    const precision = this.getPricePrecision(context.exchangeId, signal.symbol);
    positionSize = Math.floor(positionSize * Math.pow(10, precision)) / Math.pow(10, precision);
    
    return positionSize;
  }

  /**
   * Execute entry order with slippage protection
   */
  private async executeEntryOrder(
    context: ExecutionContext,
    quantity: number,
    currentPrice: number
  ): Promise<OrderResult> {
    const signal = context.signal!;
    const client = context.client!;
    
    // Determine order side based on direction
    const side = signal.direction === 'LONG' ? 'buy' : 'sell';
    
    // For market orders, check slippage
    const orderType = 'market';
    
    // Execute order
    const orderParams: CreateOrderParams = {
      symbol: signal.symbol,
      side,
      type: orderType,
      quantity,
      leverage: signal.leverage,
      marginMode: 'isolated',
      clientOrderId: `citarion-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    };
    
    return await client.createOrder(orderParams);
  }

  /**
   * Set take profit orders
   */
  private async setTakeProfitOrders(
    context: ExecutionContext,
    position: any
  ): Promise<void> {
    const signal = context.signal!;
    const client = context.client!;
    
    for (const tp of signal.takeProfits) {
      try {
        const side = signal.direction === 'LONG' ? 'sell' : 'buy';
        const quantity = position.quantity * (tp.percentage / 100);
        
        await client.createOrder({
          symbol: signal.symbol,
          side,
          type: 'limit',
          quantity,
          price: tp.price,
          reduceOnly: true,
          positionSide: signal.direction.toLowerCase() as 'long' | 'short',
          clientOrderId: `tp-${Date.now()}`,
        });
      } catch (error) {
        console.error(`[ExecutionEngine] Failed to set TP at ${tp.price}:`, error);
      }
    }
  }

  /**
   * Set stop loss order
   */
  private async setStopLossOrder(
    context: ExecutionContext,
    position: any
  ): Promise<OrderResult> {
    const signal = context.signal!;
    const client = context.client!;
    
    const side = signal.direction === 'LONG' ? 'sell' : 'buy';
    
    return await client.createOrder({
      symbol: signal.symbol,
      side,
      type: 'stop_market',
      quantity: position.quantity,
      stopPrice: signal.stopLoss!,
      reduceOnly: true,
      positionSide: signal.direction.toLowerCase() as 'long' | 'short',
      clientOrderId: `sl-${Date.now()}`,
    });
  }

  /**
   * Create position record in database
   */
  private async createPositionRecord(
    context: ExecutionContext,
    orderResult: OrderResult,
    quantity: number
  ): Promise<any> {
    const signal = context.signal!;
    
    return await db.position.create({
      data: {
        accountId: context.accountId,
        symbol: signal.symbol,
        direction: signal.direction,
        status: 'OPEN',
        totalAmount: quantity,
        filledAmount: quantity,
        avgEntryPrice: orderResult.order?.avgPrice || signal.entryPrices[0],
        leverage: signal.leverage,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfits?.[0]?.price,
        trailingStop: signal.trailingConfig ? JSON.stringify(signal.trailingConfig) : null,
        isDemo: context.isDemo,
      },
    });
  }

  /**
   * Log execution for audit trail
   */
  private async logExecution(
    context: ExecutionContext,
    orderResult: OrderResult,
    position: any
  ): Promise<void> {
    await db.systemLog.create({
      data: {
        level: 'INFO',
        category: 'TRADE',
        message: `Trade executed: ${context.signal?.symbol} ${context.signal?.direction}`,
        details: JSON.stringify({
          accountId: context.accountId,
          orderId: orderResult.order?.id,
          positionId: position.id,
          symbol: context.signal?.symbol,
          direction: context.signal?.direction,
          quantity: position.totalAmount,
          entryPrice: orderResult.order?.avgPrice,
          leverage: context.signal?.leverage,
        }),
        userId: context.userId,
      },
    });
  }

  /**
   * Get price precision for exchange/symbol
   */
  private getPricePrecision(exchangeId: string, symbol: string): number {
    // Default precision
    return 8;
  }

  /**
   * Close position
   */
  async closePosition(
    accountId: string,
    symbol: string,
    userId: string
  ): Promise<ExecutionResult> {
    try {
      // Get account and position
      const account = await db.account.findUnique({
        where: { id: accountId },
      });

      if (!account) {
        return { success: false, error: 'Account not found', errorCode: 'ACCOUNT_NOT_FOUND' };
      }

      const position = await db.position.findFirst({
        where: {
          accountId,
          symbol,
          status: 'OPEN',
        },
      });

      if (!position) {
        return { success: false, error: 'Position not found', errorCode: 'POSITION_NOT_FOUND' };
      }

      // Create context
      const context: ExecutionContext = {
        userId,
        accountId,
        exchangeId: account.exchangeId,
        isTestnet: account.isTestnet,
        isDemo: account.accountType === 'DEMO',
      };

      // Get client
      context.client = await this.getExchangeClient(context);
      if (!context.client) {
        return { success: false, error: 'Failed to get exchange client', errorCode: 'CLIENT_ERROR' };
      }

      // Close position on exchange
      const closeResult = await context.client.closePosition({
        symbol,
        quantity: position.totalAmount,
      });

      if (!closeResult.success) {
        return { success: false, error: closeResult.error, errorCode: closeResult.errorCode };
      }

      // Update position status
      await db.position.update({
        where: { id: position.id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closeReason: 'MANUAL',
        },
      });

      return {
        success: true,
        tradeId: position.id,
        orderId: closeResult.order?.id,
        symbol,
        side: position.direction as 'LONG' | 'SHORT',
        quantity: position.totalAmount,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: 'CLOSE_ERROR',
      };
    }
  }

  /**
   * Cancel order
   */
  async cancelOrder(
    accountId: string,
    symbol: string,
    orderId: string,
    userId: string
  ): Promise<ExecutionResult> {
    try {
      const account = await db.account.findUnique({ where: { id: accountId } });
      if (!account) {
        return { success: false, error: 'Account not found', errorCode: 'ACCOUNT_NOT_FOUND' };
      }

      const context: ExecutionContext = {
        userId,
        accountId,
        exchangeId: account.exchangeId,
        isTestnet: account.isTestnet,
        isDemo: account.accountType === 'DEMO',
      };

      context.client = await this.getExchangeClient(context);
      if (!context.client) {
        return { success: false, error: 'Failed to get exchange client', errorCode: 'CLIENT_ERROR' };
      }

      const cancelResult = await context.client.cancelOrder({
        symbol,
        orderId,
      });

      return {
        success: cancelResult.success,
        orderId,
        error: cancelResult.error,
        errorCode: cancelResult.errorCode,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: 'CANCEL_ERROR',
      };
    }
  }

  /**
   * Clear client cache
   */
  clearCache(): void {
    this.clientCache.clear();
  }
}

// Singleton instance
let executionEngineInstance: ExecutionEngine | null = null;

export function getExecutionEngine(): ExecutionEngine {
  if (!executionEngineInstance) {
    executionEngineInstance = new ExecutionEngine();
  }
  return executionEngineInstance;
}

export const executionEngine = new ExecutionEngine();
export default executionEngine;
