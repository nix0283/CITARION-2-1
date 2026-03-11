/**
 * Trading Error Handling - Production Ready
 * 
 * Structured error handling for trading operations.
 * Provides error codes, recovery strategies, and logging.
 * 
 * Based on Kimi_Solutions.md recommendations
 */

import { NextResponse } from "next/server";

// ==================== ERROR CODES ====================

export const TradingErrorCodes = {
  // Authentication & Authorization
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  INVALID_API_KEY: "INVALID_API_KEY",
  API_KEY_EXPIRED: "API_KEY_EXPIRED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  
  // Account & Balance
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  INSUFFICIENT_MARGIN: "INSUFFICIENT_MARGIN",
  BALANCE_FETCH_FAILED: "BALANCE_FETCH_FAILED",
  
  // Trading
  INVALID_SYMBOL: "INVALID_SYMBOL",
  INVALID_QUANTITY: "INVALID_QUANTITY",
  INVALID_PRICE: "INVALID_PRICE",
  INVALID_LEVERAGE: "INVALID_LEVERAGE",
  ORDER_NOT_FOUND: "ORDER_NOT_FOUND",
  ORDER_REJECTED: "ORDER_REJECTED",
  ORDER_TIMEOUT: "ORDER_TIMEOUT",
  POSITION_NOT_FOUND: "POSITION_NOT_FOUND",
  POSITION_SIZE_EXCEEDED: "POSITION_SIZE_EXCEEDED",
  MAX_LEVERAGE_EXCEEDED: "MAX_LEVERAGE_EXCEEDED",
  
  // Exchange
  EXCHANGE_UNAVAILABLE: "EXCHANGE_UNAVAILABLE",
  EXCHANGE_RATE_LIMIT: "EXCHANGE_RATE_LIMIT",
  EXCHANGE_MAINTENANCE: "EXCHANGE_MAINTENANCE",
  EXCHANGE_ERROR: "EXCHANGE_ERROR",
  
  // Signal Parsing
  SIGNAL_PARSE_FAILED: "SIGNAL_PARSE_FAILED",
  SIGNAL_INVALID_FORMAT: "SIGNAL_INVALID_FORMAT",
  SIGNAL_SYMBOL_NOT_ALLOWED: "SIGNAL_SYMBOL_NOT_ALLOWED",
  
  // Bot Configuration
  BOT_NOT_FOUND: "BOT_NOT_FOUND",
  BOT_INACTIVE: "BOT_INACTIVE",
  BOT_CONFIG_INVALID: "BOT_CONFIG_INVALID",
  
  // System
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  TIMEOUT: "TIMEOUT",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

export type TradingErrorCode = typeof TradingErrorCodes[keyof typeof TradingErrorCodes];

// ==================== TRADING ERROR CLASS ====================

export class TradingError extends Error {
  code: TradingErrorCode;
  recoverable: boolean;
  retryAfter?: number;
  details?: Record<string, unknown>;
  httpStatus: number;

  constructor(
    message: string,
    code: TradingErrorCode = "UNKNOWN_ERROR",
    recoverable: boolean = false,
    httpStatus: number = 500,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "TradingError";
    this.code = code;
    this.recoverable = recoverable;
    this.httpStatus = httpStatus;
    this.details = details;
  }

  /**
   * Create a JSON representation for API responses
   */
  toJSON() {
    return {
      error: this.message,
      code: this.code,
      recoverable: this.recoverable,
      retryAfter: this.retryAfter,
      details: this.details,
    };
  }

  /**
   * Convert to Next.js API response
   */
  toResponse() {
    return NextResponse.json(
      { success: false, ...this.toJSON() },
      { status: this.httpStatus }
    );
  }
}

// ==================== ERROR FACTORY FUNCTIONS ====================

/**
 * Authentication errors
 */
export function unauthorizedError(message = "Unauthorized"): TradingError {
  return new TradingError(message, "UNAUTHORIZED", false, 401);
}

export function forbiddenError(message = "Access denied"): TradingError {
  return new TradingError(message, "FORBIDDEN", false, 403);
}

export function invalidApiKeyError(message = "Invalid API key", details?: Record<string, unknown>): TradingError {
  return new TradingError(message, "INVALID_API_KEY", false, 401, details);
}

/**
 * Account & Balance errors
 */
export function accountNotFoundError(accountId?: string): TradingError {
  return new TradingError(
    "Account not found",
    "ACCOUNT_NOT_FOUND",
    false,
    404,
    accountId ? { accountId } : undefined
  );
}

export function insufficientBalanceError(
  required: number,
  available: number,
  currency = "USDT"
): TradingError {
  return new TradingError(
    `Insufficient ${currency} balance. Required: ${required}, Available: ${available}`,
    "INSUFFICIENT_BALANCE",
    false,
    400,
    { required, available, currency }
  );
}

/**
 * Trading errors
 */
export function invalidSymbolError(symbol: string): TradingError {
  return new TradingError(
    `Invalid symbol: ${symbol}`,
    "INVALID_SYMBOL",
    false,
    400,
    { symbol }
  );
}

export function orderRejectedError(reason: string, details?: Record<string, unknown>): TradingError {
  return new TradingError(
    `Order rejected: ${reason}`,
    "ORDER_REJECTED",
    false,
    400,
    details
  );
}

export function positionNotFoundError(symbol: string): TradingError {
  return new TradingError(
    `Position not found for ${symbol}`,
    "POSITION_NOT_FOUND",
    false,
    404,
    { symbol }
  );
}

export function leverageExceededError(requested: number, max: number): TradingError {
  return new TradingError(
    `Requested leverage ${requested}x exceeds maximum ${max}x`,
    "MAX_LEVERAGE_EXCEEDED",
    false,
    400,
    { requested, max }
  );
}

/**
 * Exchange errors
 */
export function exchangeUnavailableError(exchange: string): TradingError {
  return new TradingError(
    `Exchange ${exchange} is currently unavailable`,
    "EXCHANGE_UNAVAILABLE",
    true,
    503,
    { exchange }
  );
}

export function exchangeRateLimitError(retryAfter = 60): TradingError {
  const error = new TradingError(
    "Exchange rate limit exceeded",
    "EXCHANGE_RATE_LIMIT",
    true,
    429
  );
  error.retryAfter = retryAfter;
  return error;
}

export function exchangeError(
  exchange: string,
  originalError: string,
  details?: Record<string, unknown>
): TradingError {
  return new TradingError(
    `${exchange} error: ${originalError}`,
    "EXCHANGE_ERROR",
    true,
    500,
    { exchange, originalError, ...details }
  );
}

/**
 * Signal parsing errors
 */
export function signalParseError(message: string): TradingError {
  return new TradingError(message, "SIGNAL_PARSE_FAILED", false, 400);
}

export function symbolNotAllowedError(symbol: string, reason?: string): TradingError {
  return new TradingError(
    `Symbol ${symbol} is not allowed${reason ? `: ${reason}` : ""}`,
    "SIGNAL_SYMBOL_NOT_ALLOWED",
    false,
    400,
    { symbol, reason }
  );
}

/**
 * System errors
 */
export function internalError(message = "Internal server error", details?: Record<string, unknown>): TradingError {
  return new TradingError(message, "INTERNAL_ERROR", false, 500, details);
}

export function timeoutError(operation: string, timeout: number): TradingError {
  return new TradingError(
    `Operation ${operation} timed out after ${timeout}ms`,
    "TIMEOUT",
    true,
    504,
    { operation, timeout }
  );
}

// ==================== ERROR HANDLER WRAPPER ====================

/**
 * Wrap API handler with error handling
 */
export async function withErrorHandler<T>(
  handler: () => Promise<T>
): Promise<T | NextResponse> {
  try {
    return await handler();
  } catch (error) {
    console.error("[API Error]:", error);

    if (error instanceof TradingError) {
      return error.toResponse();
    }

    if (error && typeof error === 'object' && 'name' in error && error.name === "ZodError") {
      return NextResponse.json(
        {
          success: false,
          error: "Validation error",
          code: "VALIDATION_ERROR",
          details: (error as any).errors,
        },
        { status: 400 }
      );
    }

    // Generic error
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        code: "UNKNOWN_ERROR",
      },
      { status: 500 }
    );
  }
}

/**
 * Determine if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof TradingError) {
    return error.recoverable;
  }

  if (error instanceof Error) {
    // Network errors are usually retryable
    const retryableMessages = [
      "ECONNRESET",
      "ETIMEDOUT",
      "ENOTFOUND",
      "rate limit",
      "timeout",
      "temporarily unavailable",
      "service unavailable",
    ];

    return retryableMessages.some(msg =>
      error.message.toLowerCase().includes(msg.toLowerCase())
    );
  }

  return false;
}

/**
 * Get retry delay for error
 */
export function getRetryDelay(error: unknown): number {
  if (error instanceof TradingError && error.retryAfter) {
    return error.retryAfter * 1000;
  }

  // Exponential backoff for rate limits
  if (error instanceof TradingError && error.code === "EXCHANGE_RATE_LIMIT") {
    return 60000; // 1 minute
  }

  // Default retry delay
  return 5000; // 5 seconds
}

// ==================== LOGGING HELPERS ====================

/**
 * Log trading error with context
 */
export function logTradingError(
  error: unknown,
  context: {
    operation: string;
    userId?: string;
    accountId?: string;
    symbol?: string;
    exchange?: string;
  }
): void {
  const timestamp = new Date().toISOString();
  
  if (error instanceof TradingError) {
    console.error(JSON.stringify({
      timestamp,
      level: "ERROR",
      type: "TRADING_ERROR",
      code: error.code,
      message: error.message,
      recoverable: error.recoverable,
      context,
      details: error.details,
    }));
  } else {
    console.error(JSON.stringify({
      timestamp,
      level: "ERROR",
      type: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
      context,
      stack: error instanceof Error ? error.stack : undefined,
    }));
  }
}
