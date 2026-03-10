/**
 * Trade Validation Schemas
 * 
 * Zod schemas for comprehensive validation of trade-related inputs
 * Provides security against SQL injection, XSS, and input manipulation
 */

import { z } from 'zod';

// ==================== ENUMS ====================

/**
 * Valid trade directions
 */
export const DirectionSchema = z.enum(['LONG', 'SHORT']);

/**
 * Valid order types
 */
export const OrderTypeSchema = z.enum(['market', 'limit', 'stop_market', 'stop_limit', 'trigger']);

/**
 * Valid order sides
 */
export const OrderSideSchema = z.enum(['buy', 'sell']);

/**
 * Valid position sides
 */
export const PositionSideSchema = z.enum(['long', 'short', 'both']);

/**
 * Valid margin modes
 */
export const MarginModeSchema = z.enum(['isolated', 'cross']);

/**
 * Valid market types
 */
export const MarketTypeSchema = z.enum(['spot', 'futures', 'inverse']);

/**
 * Valid signal sources
 */
export const SignalSourceSchema = z.enum(['TELEGRAM', 'DISCORD', 'TRADINGVIEW', 'MANUAL', 'APP']);

/**
 * Valid leverage types
 */
export const LeverageTypeSchema = z.enum(['ISOLATED', 'CROSS']);

/**
 * Valid TP strategies
 */
export const TPStrategySchema = z.enum([
  'EVENLY_DIVIDED',
  'ONE_TARGET',
  'TWO_TARGETS',
  'THREE_TARGETS',
  'FIFTY_ON_FIRST',
  'DECREASING_EXP',
  'INCREASING_EXP',
  'SKIP_FIRST',
  'CUSTOM_RATIOS',
]);

/**
 * Valid trailing stop types
 */
export const TrailingStopTypeSchema = z.enum([
  'BREAKEVEN',
  'MOVING_TARGET',
  'MOVING_2_TARGET',
  'PERCENT_BELOW_TRIGGERS',
  'PERCENT_BELOW_HIGHEST',
]);

/**
 * Valid trailing trigger types
 */
export const TrailingTriggerTypeSchema = z.enum([
  'TARGET_REACHED',
  'PERCENT_ABOVE_ENTRY',
]);

// ==================== BASE SCHEMAS ====================

/**
 * Symbol validation - must be uppercase, alphanumeric
 */
export const SymbolSchema = z
  .string()
  .min(1, 'Symbol is required')
  .max(20, 'Symbol too long')
  .regex(/^[A-Z0-9]+$/, 'Symbol must be uppercase alphanumeric (e.g., BTCUSDT)');

/**
 * Price validation - must be positive number
 */
export const PriceSchema = z
  .number()
  .positive('Price must be positive')
  .max(1_000_000_000, 'Price exceeds maximum');

/**
 * Quantity validation - must be positive number
 */
export const QuantitySchema = z
  .number()
  .positive('Quantity must be positive')
  .max(1_000_000_000, 'Quantity exceeds maximum');

/**
 * Percentage validation - must be between 0 and 100
 */
export const PercentageSchema = z
  .number()
  .min(0, 'Percentage cannot be negative')
  .max(100, 'Percentage cannot exceed 100');

/**
 * Leverage validation - must be between 1 and 125
 */
export const LeverageSchema = z
  .number()
  .int('Leverage must be integer')
  .min(1, 'Leverage must be at least 1')
  .max(125, 'Leverage cannot exceed 125');

/**
 * Account ID validation
 */
export const AccountIdSchema = z
  .string()
  .min(1, 'Account ID is required')
  .max(50, 'Account ID too long');

/**
 * User ID validation
 */
export const UserIdSchema = z
  .string()
  .min(1, 'User ID is required')
  .max(50, 'User ID too long');

/**
 * Exchange ID validation
 */
export const ExchangeIdSchema = z.enum([
  'binance',
  'bybit',
  'okx',
  'bitget',
  'kucoin',
  'bingx',
  'coinbase',
  'huobi',
  'hyperliquid',
  'bitmex',
  'blofin',
]);

// ==================== COMPLEX SCHEMAS ====================

/**
 * Take Profit level schema
 */
export const TakeProfitLevelSchema = z.object({
  price: PriceSchema,
  percentage: PercentageSchema,
});

/**
 * Entry price level schema
 */
export const EntryLevelSchema = z.object({
  price: PriceSchema,
  weight: z.number().min(1).max(100).optional(),
});

/**
 * Trailing stop configuration schema
 */
export const TrailingStopConfigSchema = z.object({
  type: TrailingStopTypeSchema,
  triggerType: TrailingTriggerTypeSchema.optional(),
  triggerValue: z.number().positive().optional(), // Target number or percentage
  trailingPercent: PercentageSchema.optional(),
  activated: z.boolean().default(false),
  highestPrice: PriceSchema.optional(),
});

// ==================== SIGNAL SCHEMAS ====================

/**
 * Signal input schema for parsing trading signals
 */
export const SignalInputSchema = z.object({
  symbol: SymbolSchema,
  direction: DirectionSchema,
  marketType: MarketTypeSchema.default('futures'),
  
  // Entry prices
  entryPrices: z.array(PriceSchema).min(1).max(10),
  entryWeights: z.array(z.number().min(1).max(100)).optional(),
  
  // Take profits
  takeProfits: z.array(TakeProfitLevelSchema).min(1).max(10),
  
  // Stop loss
  stopLoss: PriceSchema.optional(),
  
  // Leverage
  leverage: LeverageSchema.default(1),
  leverageType: LeverageTypeSchema.default('ISOLATED'),
  
  // Trailing stop
  trailingConfig: TrailingStopConfigSchema.optional(),
  
  // Signal metadata
  signalSource: SignalSourceSchema.optional(),
  signalText: z.string().max(10000).optional(),
  
  // Exchange targets
  exchanges: z.array(ExchangeIdSchema).optional(),
});

/**
 * Trade entry input schema
 */
export const TradeEntrySchema = z.object({
  signal: SignalInputSchema,
  accountId: AccountIdSchema,
  userId: UserIdSchema,
  botConfigId: z.string().max(50).optional(),
  
  // Override settings
  overrideLeverage: LeverageSchema.optional(),
  overrideMarginMode: MarginModeSchema.optional(),
  overrideAmount: QuantitySchema.optional(),
  
  // Options
  skipValidation: z.boolean().default(false),
  testMode: z.boolean().default(false),
});

/**
 * Trade close input schema
 */
export const TradeCloseSchema = z.object({
  tradeId: z.string().min(1),
  accountId: AccountIdSchema,
  userId: UserIdSchema,
  
  // Close options
  closeReason: z.enum(['TP', 'SL', 'MANUAL', 'SIGNAL', 'LIQUIDATION', 'TIMEOUT']).optional(),
  closePercentage: PercentageSchema.default(100),
  market: z.boolean().default(true),
  
  // Validation
  skipValidation: z.boolean().default(false),
});

// ==================== ORDER SCHEMAS ====================

/**
 * Order creation schema
 */
export const CreateOrderSchema = z.object({
  symbol: SymbolSchema,
  side: OrderSideSchema,
  type: OrderTypeSchema,
  
  // Quantity
  quantity: QuantitySchema,
  
  // Price (for limit orders)
  price: PriceSchema.optional(),
  
  // Stop price (for stop orders)
  stopPrice: PriceSchema.optional(),
  
  // Position settings
  positionSide: PositionSideSchema.optional(),
  leverage: LeverageSchema.optional(),
  marginMode: MarginModeSchema.optional(),
  
  // Order settings
  timeInForce: z.enum(['GTC', 'IOC', 'FOK', 'GTX']).default('GTC'),
  reduceOnly: z.boolean().default(false),
  postOnly: z.boolean().default(false),
  clientOrderId: z.string().max(50).optional(),
  
  // Risk management
  takeProfitPrice: PriceSchema.optional(),
  stopLossPrice: PriceSchema.optional(),
  
  // Metadata
  accountId: AccountIdSchema,
});

/**
 * Order cancellation schema
 */
export const CancelOrderSchema = z.object({
  orderId: z.string().min(1).optional(),
  clientOrderId: z.string().max(50).optional(),
  symbol: SymbolSchema,
  accountId: AccountIdSchema,
});

// ==================== BOT CONFIG SCHEMAS ====================

/**
 * Amount per trade configuration
 */
export const AmountPerTradeSchema = z.object({
  type: z.enum(['FIXED', 'PERCENTAGE', 'RISK_PERCENTAGE', 'FIXED_BTC', 'FIXED_USD']),
  value: z.number().positive(),
});

/**
 * DCA configuration schema
 */
export const DCAConfigSchema = z.object({
  enabled: z.boolean().default(false),
  maxSafetyOrders: z.number().int().min(1).max(20).default(5),
  safetyOrderStepPercent: PercentageSchema.default(2),
  safetyOrderScale: z.number().min(1).max(10).default(1.5),
  takeProfitPerLevel: z.boolean().default(false),
});

/**
 * Grid bot configuration schema
 */
export const GridConfigSchema = z.object({
  lowerPrice: PriceSchema,
  upperPrice: PriceSchema,
  gridCount: z.number().int().min(2).max(100),
  gridType: z.enum(['ARITHMETIC', 'GEOMETRIC']).default('ARITHMETIC'),
  totalInvestment: QuantitySchema,
  leverage: LeverageSchema.default(1),
  marginMode: MarginModeSchema.default('isolated'),
});

/**
 * Bot configuration creation schema
 */
export const BotConfigCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  
  // Exchange settings
  exchangeId: ExchangeIdSchema.default('binance'),
  exchangeType: MarketTypeSchema.default('futures'),
  
  // Amount settings
  tradeAmount: QuantitySchema.default(100),
  amountType: z.enum(['FIXED', 'PERCENTAGE']).default('FIXED'),
  
  // Leverage settings
  leverage: LeverageSchema.default(1),
  marginMode: MarginModeSchema.default('isolated'),
  
  // Risk management
  maxOpenTrades: z.number().int().min(1).max(50).default(5),
  allowedSymbols: z.array(SymbolSchema).optional(),
  blacklistedSymbols: z.array(SymbolSchema).optional(),
  
  // TP/SL settings
  tpStrategy: TPStrategySchema.default('EVENLY_DIVIDED'),
  defaultStopLoss: PercentageSchema.optional(),
  
  // Signal settings
  autoExecuteEnabled: z.boolean().default(false),
  signalSources: z.array(SignalSourceSchema).optional(),
  
  // Account
  accountId: AccountIdSchema.optional(),
});

// ==================== API KEY SCHEMAS ====================

/**
 * API credentials schema
 */
export const ApiCredentialsSchema = z.object({
  apiKey: z.string()
    .min(16, 'API key too short')
    .max(200, 'API key too long')
    .regex(/^[A-Za-z0-9_-]+$/, 'API key contains invalid characters'),
  
  apiSecret: z.string()
    .min(16, 'API secret too short')
    .max(500, 'API secret too long'),
  
  passphrase: z.string()
    .min(1, 'Passphrase too short')
    .max(100, 'Passphrase too long')
    .optional(),
  
  uid: z.string()
    .min(1, 'UID too short')
    .max(100, 'UID too long')
    .optional(),
});

/**
 * Account connection schema
 */
export const AccountConnectSchema = z.object({
  exchangeId: ExchangeIdSchema,
  exchangeType: MarketTypeSchema.default('futures'),
  accountType: z.enum(['REAL', 'DEMO']).default('DEMO'),
  
  credentials: ApiCredentialsSchema,
  
  isTestnet: z.boolean().default(false),
  subAccount: z.string().max(50).optional(),
  
  // Validation options
  validateConnection: z.boolean().default(true),
  storeEncrypted: z.boolean().default(true),
});

// ==================== PAGINATION SCHEMAS ====================

/**
 * Pagination parameters schema
 */
export const PaginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.string().max(50).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * Date range schema
 */
export const DateRangeSchema = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

// ==================== EXPORT TYPES ====================

export type SignalInput = z.infer<typeof SignalInputSchema>;
export type TradeEntryInput = z.infer<typeof TradeEntrySchema>;
export type TradeCloseInput = z.infer<typeof TradeCloseSchema>;
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
export type CancelOrderInput = z.infer<typeof CancelOrderSchema>;
export type BotConfigCreateInput = z.infer<typeof BotConfigCreateSchema>;
export type ApiCredentialsInput = z.infer<typeof ApiCredentialsSchema>;
export type AccountConnectInput = z.infer<typeof AccountConnectSchema>;
export type PaginationInput = z.infer<typeof PaginationSchema>;
export type DateRangeInput = z.infer<typeof DateRangeSchema>;
export type DCAConfigInput = z.infer<typeof DCAConfigSchema>;
export type GridConfigInput = z.infer<typeof GridConfigSchema>;
export type AmountPerTradeInput = z.infer<typeof AmountPerTradeSchema>;

// ==================== VALIDATION HELPER FUNCTIONS ====================

/**
 * Validate trade entry with detailed error messages
 */
export function validateTradeEntry(data: unknown): {
  success: boolean;
  data?: TradeEntryInput;
  errors?: string[];
} {
  const result = TradeEntrySchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  const errors = result.error.errors.map(err => 
    `${err.path.join('.')}: ${err.message}`
  );
  return { success: false, errors };
}

/**
 * Validate signal input
 */
export function validateSignal(data: unknown): {
  success: boolean;
  data?: SignalInput;
  errors?: string[];
} {
  const result = SignalInputSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  const errors = result.error.errors.map(err => 
    `${err.path.join('.')}: ${err.message}`
  );
  return { success: false, errors };
}

/**
 * Validate API credentials format
 */
export function validateApiCredentials(data: unknown): {
  success: boolean;
  data?: ApiCredentialsInput;
  errors?: string[];
} {
  const result = ApiCredentialsSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  const errors = result.error.errors.map(err => 
    `${err.path.join('.')}: ${err.message}`
  );
  return { success: false, errors };
}

/**
 * Sanitize string input (remove potential XSS)
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .trim();
}

/**
 * Validate and sanitize signal text
 */
export function validateSignalText(text: string): {
  valid: boolean;
  sanitized: string;
  error?: string;
} {
  if (!text || typeof text !== 'string') {
    return { valid: false, sanitized: '', error: 'Signal text is required' };
  }
  
  if (text.length > 50000) {
    return { valid: false, sanitized: '', error: 'Signal text too long (max 50000 chars)' };
  }
  
  const sanitized = sanitizeString(text);
  
  return { valid: true, sanitized };
}

export default {
  // Schemas
  SignalInputSchema,
  TradeEntrySchema,
  TradeCloseSchema,
  CreateOrderSchema,
  CancelOrderSchema,
  BotConfigCreateSchema,
  ApiCredentialsSchema,
  AccountConnectSchema,
  PaginationSchema,
  DateRangeSchema,
  
  // Helpers
  validateTradeEntry,
  validateSignal,
  validateApiCredentials,
  validateSignalText,
  sanitizeString,
};
