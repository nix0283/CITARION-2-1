/**
 * Order Retry Handler
 * 
 * Implements exponential backoff retry logic for failed orders
 * Handles different error types with appropriate retry strategies
 */

import { db } from '@/lib/db';
import type { ExchangeClient } from '@/lib/exchange';

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retriableErrors: string[];
}

export interface RetryResult {
  success: boolean;
  attempts: number;
  lastError?: string;
  result?: any;
}

// Default retry configuration
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 500, // Start with 500ms
  maxDelayMs: 10000, // Max 10 seconds
  backoffMultiplier: 2,
  retriableErrors: [
    'RATE_LIMIT',
    'TOO_MANY_REQUESTS',
    'SERVICE_UNAVAILABLE',
    'INTERNAL_ERROR',
    'TIMEOUT',
    'ETIMEDOUT',
    'ECONNRESET',
    'ENOTFOUND',
    'ENETDOWN',
    'INSUFFICIENT_FUNDS', // Special: will not retry but give clear message
  ]
};

/**
 * Check if an error is retriable
 */
export function isRetriableError(error: any): { retriable: boolean; code?: string } {
  const errorString = (error?.message || error?.toString() || '').toUpperCase();
  const errorCode = error?.code || error?.body?.code || 'UNKNOWN';
  
  // Check for specific error codes
  for (const code of DEFAULT_RETRY_CONFIG.retriableErrors) {
    if (errorString.includes(code) || errorCode === code) {
      // Special case: insufficient funds is NOT retriable
      if (code === 'INSUFFICIENT_FUNDS') {
        return { retriable: false, code };
      }
      return { retriable: true, code };
    }
  }

  // Check for network errors
  if (errorString.includes('NETWORK') || 
      errorString.includes('CONNECTION') ||
      errorString.includes('ECONNREFUSED') ||
      errorString.includes('SOCKET')) {
    return { retriable: true, code: 'NETWORK_ERROR' };
  }

  // Check for rate limit (429 status)
  if (errorString.includes('429') || errorString.includes('RATE') || errorString.includes('LIMIT')) {
    return { retriable: true, code: 'RATE_LIMIT' };
  }

  return { retriable: false, code: errorCode };
}

/**
 * Calculate delay for next retry attempt using exponential backoff
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a trade with retry logic
 */
export async function executeWithRetry(
  operation: () => Promise<any>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: string | undefined;
  
  for (let attempt = 1; attempt <= finalConfig.maxRetries; attempt++) {
    try {
      const result = await operation();
      
      return {
        success: true,
        attempts: attempt,
        result
      };
    } catch (error: any) {
      lastError = error instanceof Error ? error.message : String(error);
      const { retriable, code } = isRetriableError(error);

      console.error(`[OrderRetry] Attempt ${attempt} failed:`, {
        error: lastError,
        code,
        retriable
      });

      // If not retriable or max retries reached, break
      if (!retriable) {
        return {
          success: false,
          attempts: attempt,
          lastError: `Non-retriable error: ${code} - ${lastError}`
        };
      }

      if (attempt >= finalConfig.maxRetries) {
        return {
          success: false,
          attempts: attempt,
          lastError: `Max retries (${finalConfig.maxRetries}) reached. Last error: ${lastError}`
        };
      }

      // Wait before next retry
      const delay = calculateDelay(attempt, finalConfig);
      console.log(`[OrderRetry] Waiting ${delay}ms before retry ${attempt + 1}...`);
      await sleep(delay);
    }
  }

  // Should not reach here
  return {
    success: false,
    attempts: finalConfig.maxRetries,
    lastError: lastError || 'Unknown error'
  };
}

/**
 * Log an order rejection for debugging and analysis
 */
export async function logOrderRejection(params: {
  userId: string;
  accountId: string;
  symbol: string;
  reason: string;
  errorCode: string;
  requestParams?: any;
}): Promise<void> {
  try {
    await db.exchangeTransactionLog.create({
      data: {
        userId: params.userId,
        accountId: params.accountId,
        exchange: 'unknown', // Will be updated
        endpoint: 'order/create',
        method: 'POST',
        requestParams: JSON.stringify(params.requestParams || {}),
        status: 'FAILED',
        errorCode: params.errorCode,
        errorMessage: params.reason,
        requestTime: new Date(),
        responseTime: new Date()
      }
    });

    // Also log to system log
    await db.systemLog.create({
      data: {
        level: 'WARNING',
        category: 'TRADE',
        userId: params.userId,
        message: `[ORDER_REJECTED] ${params.symbol}: ${params.reason}`,
        details: JSON.stringify({
          accountId: params.accountId,
          symbol: params.symbol,
          errorCode: params.errorCode,
          reason: params.reason
        })
      }
    });
  } catch (logError) {
    console.error('[OrderRetry] Failed to log rejection:', logError);
  }
}

/**
 * Create an exchange transaction log entry
 */
export async function logExchangeTransaction(params: {
  userId: string;
  accountId: string;
  exchange: string;
  endpoint: string;
  method: string;
  requestParams?: any;
  clientOrderId?: string;
  responseStatus?: number;
  responseBody?: any;
  exchangeOrderId?: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'RETRY';
  errorCode?: string;
  errorMessage?: string;
}): Promise<string> {
  const log = await db.exchangeTransactionLog.create({
    data: {
      userId: params.userId,
      accountId: params.accountId,
      exchange: params.exchange,
      marketType: 'futures',
      endpoint: params.endpoint,
      method: params.method,
      requestParams: JSON.stringify(params.requestParams || {}),
      clientOrderId: params.clientOrderId,
      responseStatus: params.responseStatus,
      responseBody: JSON.stringify(params.responseBody || {}),
      exchangeOrderId: params.exchangeOrderId,
      status: params.status,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
      requestTime: new Date()
    }
  });

  return log.id;
}

/**
 * Update an exchange transaction log entry
 */
export async function updateExchangeTransaction(
  logId: string,
  updates: {
    responseStatus?: number;
    responseBody?: any;
    exchangeOrderId?: string;
    status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'RETRY';
    errorCode?: string;
    errorMessage?: string;
  }
): Promise<void> {
  await db.exchangeTransactionLog.update({
    where: { id: logId },
    data: {
      ...updates,
      responseTime: new Date()
    }
  });
}
