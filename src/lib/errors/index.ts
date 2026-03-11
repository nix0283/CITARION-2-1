/**
 * Error Handling Module
 * 
 * Production-ready error handling for trading operations.
 */

export {
  TradingErrorCodes,
  type TradingErrorCode,
  TradingError,
  
  // Error factories
  unauthorizedError,
  forbiddenError,
  invalidApiKeyError,
  accountNotFoundError,
  insufficientBalanceError,
  invalidSymbolError,
  orderRejectedError,
  positionNotFoundError,
  leverageExceededError,
  exchangeUnavailableError,
  exchangeRateLimitError,
  exchangeError,
  signalParseError,
  symbolNotAllowedError,
  internalError,
  timeoutError,
  
  // Utilities
  withErrorHandler,
  isRetryableError,
  getRetryDelay,
  logTradingError,
} from "./trading-errors";
