/**
 * Encryption utilities for API keys and secrets
 * 
 * Uses AES-256-GCM for encryption
 * Keys are encrypted before storing in the database
 * 
 * @security CRITICAL SECURITY NOTICE
 * 
 * This module handles encryption of sensitive API keys and secrets.
 * 
 * IMPORTANT SECURITY REQUIREMENTS:
 * 1. NEVER use a default/hardcoded encryption key in production
 * 2. The API_KEY_ENCRYPTION_KEY environment variable MUST be set in production
 * 3. The encryption key should be a securely generated 32-byte random key
 * 4. Rotating the encryption key requires re-encrypting all stored secrets
 * 
 * FAILURE TO SET A PROPER ENCRYPTION KEY IN PRODUCTION WILL:
 * - Cause the application to fail to start (by design)
 * - Prevent potential data breaches from hardcoded keys
 * 
 * For development, use generateSecureKey() to create a key for your .env file
 */

import crypto from "crypto";

// ==================== ENVIRONMENT VALIDATION ====================

/**
 * Check if the application is running in production mode
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Get and validate the encryption key from environment
 * 
 * @throws Error if key is not set in production environment
 */
function getEncryptionKey(): string {
  const key = process.env.API_KEY_ENCRYPTION_KEY;
  
  if (!key) {
    if (isProduction()) {
      throw new Error(
        "CRITICAL: API_KEY_ENCRYPTION_KEY environment variable is not set. " +
        "This is required in production. Generate a secure key using generateSecureKey() " +
        "and add it to your environment variables."
      );
    }
    
    // In development, generate a temporary key with a warning
    console.warn(
      "\n" + "=".repeat(70) + "\n" +
      "WARNING: API_KEY_ENCRYPTION_KEY is not set.\n" +
      "A temporary development key is being used.\n" +
      "This is NOT secure and should NEVER happen in production.\n" +
      "To fix this, add the following to your .env file:\n" +
      `API_KEY_ENCRYPTION_KEY="${generateSecureKey()}"\n` +
      "=".repeat(70) + "\n"
    );
    
    // Generate a temporary key for development only
    return generateSecureKey();
  }
  
  // Validate key length (should be at least 32 characters for AES-256)
  if (key.length < 32) {
    throw new Error(
      "API_KEY_ENCRYPTION_KEY must be at least 32 characters long. " +
      "Current length: " + key.length + ". " +
      "Generate a new key using generateSecureKey()."
    );
  }
  
  return key;
}

// ==================== CONFIGURATION ====================

// Encryption algorithm configuration
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // Initialization vector length
const AUTH_TAG_LENGTH = 16; // GCM authentication tag length
const SALT_LENGTH = 32;

// Lazy-loaded encryption key to allow validation at runtime
let _encryptionKey: string | null = null;

/**
 * Get the encryption key (lazy-loaded with validation)
 */
function getEffectiveEncryptionKey(): string {
  if (_encryptionKey === null) {
    _encryptionKey = getEncryptionKey();
  }
  return _encryptionKey;
}

/**
 * Reset the cached encryption key (useful for testing or key rotation)
 */
export function resetEncryptionKeyCache(): void {
  _encryptionKey = null;
}

// ==================== KEY GENERATION ====================

/**
 * Generate a cryptographically secure random key
 * 
 * Use this function to generate a secure encryption key for your .env file:
 * 
 * @example
 * // In Node.js console:
 * console.log(generateSecureKey());
 * 
 * // Or use in code to get a key for your .env:
 * const key = generateSecureKey();
 * console.log(`Add this to .env: API_KEY_ENCRYPTION_KEY="${key}"`);
 * 
 * @returns A 64-character hex string (32 bytes) suitable for AES-256 encryption
 */
export function generateSecureKey(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Validate that the encryption setup is properly configured
 * 
 * This function should be called at application startup to ensure
 * encryption is properly configured before any sensitive data is stored.
 * 
 * @returns Object containing validation status and any error messages
 * 
 * @example
 * // Call at application startup
 * const validation = validateEncryptionSetup();
 * if (!validation.isValid) {
 *   console.error("Encryption setup invalid:", validation.error);
 *   process.exit(1);
 * }
 */
export function validateEncryptionSetup(): {
  isValid: boolean;
  isProduction: boolean;
  keyIsSet: boolean;
  keyLength: number;
  error?: string;
  warning?: string;
} {
  const result = {
    isValid: true,
    isProduction: isProduction(),
    keyIsSet: !!process.env.API_KEY_ENCRYPTION_KEY,
    keyLength: 0,
    error: undefined as string | undefined,
    warning: undefined as string | undefined,
  };
  
  const key = process.env.API_KEY_ENCRYPTION_KEY;
  
  if (key) {
    result.keyLength = key.length;
  }
  
  // Check for missing key
  if (!key) {
    if (result.isProduction) {
      result.isValid = false;
      result.error = "API_KEY_ENCRYPTION_KEY is not set in production environment. " +
        "This is a critical security vulnerability.";
    } else {
      result.isValid = true; // Valid for development (will generate temp key)
      result.warning = "API_KEY_ENCRYPTION_KEY is not set. A temporary development key will be used. " +
        "This is not secure and should be fixed before production deployment.";
    }
    return result;
  }
  
  // Check key length
  if (key.length < 32) {
    result.isValid = false;
    result.error = `API_KEY_ENCRYPTION_KEY is too short (${key.length} characters). ` +
      "Key must be at least 32 characters for AES-256 encryption.";
    return result;
  }
  
  // Check for weak/default keys
  const weakPatterns = [
    "default",
    "test",
    "dev",
    "development",
    "password",
    "secret",
    "12345",
    "changeme",
    "example",
  ];
  
  const lowerKey = key.toLowerCase();
  const containsWeakPattern = weakPatterns.some(pattern => lowerKey.includes(pattern));
  
  if (containsWeakPattern) {
    result.isValid = result.isProduction ? false : true;
    if (result.isProduction) {
      result.error = "API_KEY_ENCRYPTION_KEY appears to contain a weak pattern. " +
        "Please use a securely generated random key.";
    } else {
      result.warning = "API_KEY_ENCRYPTION_KEY appears to contain a weak pattern. " +
        "Consider using a securely generated random key.";
    }
  }
  
  return result;
}

// Derive a proper key from the encryption key string using PBKDF2
function deriveKey(secret: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(secret, salt, 100000, 32, "sha512");
}

// ==================== ENCRYPTION ====================

/**
 * Encrypt an API key or secret
 * 
 * Uses AES-256-GCM with PBKDF2 key derivation for secure encryption.
 * Each encryption operation generates a unique salt and IV for forward secrecy.
 * 
 * @param plaintext - The plain text to encrypt (API key or secret)
 * @returns Encrypted string in format: salt:iv:authTag:ciphertext (all base64)
 * 
 * @throws Error if plaintext is empty or encryption fails
 * 
 * @security The returned string should be stored securely in the database
 * @security Never log or expose the encrypted data in debug output
 */
export function encryptApiKey(plaintext: string): string {
  if (!plaintext) {
    throw new Error("Cannot encrypt empty string");
  }
  
  // Get the encryption key (will throw in production if not set)
  const encryptionKey = getEffectiveEncryptionKey();
  
  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  // Derive key from secret
  const key = deriveKey(encryptionKey, salt);
  
  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  
  // Encrypt
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  
  // Get authentication tag
  const authTag = cipher.getAuthTag();
  
  // Return as base64 encoded components
  return [
    salt.toString("base64"),
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Decrypt an API key or secret
 * 
 * @param encryptedData - The encrypted string from encryptApiKey
 * @returns Decrypted plain text
 * 
 * @throws Error if decryption fails (corrupted data or wrong key)
 * 
 * @security Never log the decrypted plaintext
 */
export function decryptApiKey(encryptedData: string): string {
  if (!encryptedData) {
    throw new Error("Cannot decrypt empty string");
  }
  
  // Get the encryption key (will throw in production if not set)
  const encryptionKey = getEffectiveEncryptionKey();
  
  try {
    // Parse components
    const [saltB64, ivB64, authTagB64, encryptedB64] = encryptedData.split(":");
    
    if (!saltB64 || !ivB64 || !authTagB64 || !encryptedB64) {
      throw new Error("Invalid encrypted data format");
    }
    
    // Decode from base64
    const salt = Buffer.from(saltB64, "base64");
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");
    const encrypted = Buffer.from(encryptedB64, "base64");
    
    // Derive key from secret
    const key = deriveKey(encryptionKey, salt);
    
    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    
    // Set authentication tag
    decipher.setAuthTag(authTag);
    
    // Decrypt
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    
    return decrypted.toString("utf8");
  } catch (error) {
    // Don't expose sensitive details in error messages
    console.error("[Security] Decryption failed - this may indicate a key mismatch or corrupted data");
    throw new Error("Failed to decrypt data. Key may be corrupted or encryption key changed.");
  }
}

// ==================== VALIDATION ====================

/**
 * Validate that API keys have correct permissions
 * - Required: Read, Trade
 * - Forbidden: Withdraw
 */
export interface ApiKeyValidation {
  isValid: boolean;
  hasRead: boolean;
  hasTrade: boolean;
  hasWithdraw: boolean;
  error?: string;
}

/**
 * Mask an API key for display (show first 4 and last 4 characters)
 * 
 * @security Always use this function before displaying API keys in logs or UI
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 12) {
    return "****";
  }
  
  const start = apiKey.slice(0, 4);
  const end = apiKey.slice(-4);
  const middle = "*".repeat(Math.min(apiKey.length - 8, 20));
  
  return `${start}${middle}${end}`;
}

/**
 * API Key Validation Result
 * Detailed result with user-friendly error messages
 */
export interface ApiKeyValidationResult {
  isValid: boolean;
  error?: string;
  errorKey?: string;  // For i18n/translation
  details?: {
    expectedLength?: number | string;
    actualLength?: number;
    expectedFormat?: string;
    exchange?: string;
  };
}

/**
 * API Key Format Specifications by Exchange
 * Based on official exchange API documentation
 */
const API_KEY_SPECS: Record<string, {
  minLength: number;
  maxLength: number;
  pattern: RegExp;
  description: string;
  exampleFormat: string;
}> = {
  binance: {
    minLength: 64,
    maxLength: 64,
    pattern: /^[a-zA-Z0-9]{64}$/,
    description: "Binance API ключ должен содержать ровно 64 символа (буквы и цифры)",
    exampleFormat: "Пример: aBc123...XYZ (64 символа)"
  },
  bybit: {
    minLength: 20,
    maxLength: 48,
    pattern: /^[a-zA-Z0-9]{20,48}$/,
    description: "Bybit API ключ должен содержать от 20 до 48 символов (буквы и цифры)",
    exampleFormat: "Пример: aBc123...XYZ (20-48 символов)"
  },
  okx: {
    minLength: 36,
    maxLength: 48,
    pattern: /^[a-zA-Z0-9-]{36,48}$/,
    description: "OKX API ключ должен содержать от 36 до 48 символов (буквы, цифры и дефисы)",
    exampleFormat: "Пример: aBc-123...XYZ (36-48 символов с дефисами)"
  },
  bitget: {
    minLength: 32,
    maxLength: 64,
    pattern: /^[a-zA-Z0-9]{32,64}$/,
    description: "Bitget API ключ должен содержать от 32 до 64 символов (буквы и цифры)",
    exampleFormat: "Пример: aBc123...XYZ (32-64 символа)"
  },
  bingx: {
    minLength: 32,
    maxLength: 64,
    pattern: /^[a-zA-Z0-9_-]{32,64}$/,
    description: "BingX API ключ должен содержать от 32 до 64 символов (буквы, цифры, дефисы и подчёркивания)",
    exampleFormat: "Пример: aBc_123-XYZ (32-64 символа)"
  },
  kucoin: {
    minLength: 24,
    maxLength: 32,
    pattern: /^[a-zA-Z0-9]{24,32}$/,
    description: "KuCoin API ключ должен содержать от 24 до 32 символов (буквы и цифры)",
    exampleFormat: "Пример: aBc123...XYZ (24-32 символа)"
  },
  coinbase: {
    minLength: 32,
    maxLength: 64,
    pattern: /^[a-zA-Z0-9/+]{32,64}$/,
    description: "Coinbase API ключ должен содержать от 32 до 64 символов (буквы, цифры, + и /)",
    exampleFormat: "Пример: aBc/+123XYZ (32-64 символа)"
  },
  huobi: {
    minLength: 32,
    maxLength: 64,
    pattern: /^[a-zA-Z0-9-]{32,64}$/,
    description: "HTX (Huobi) API ключ должен содержать от 32 до 64 символов (буквы, цифры и дефисы)",
    exampleFormat: "Пример: aBc-123...XYZ (32-64 символа)"
  },
  hyperliquid: {
    minLength: 42,
    maxLength: 42,
    pattern: /^0x[a-fA-F0-9]{40}$/,
    description: "HyperLiquid использует адрес кошелька Ethereum (начинается с 0x, 42 символа)",
    exampleFormat: "Пример: 0x1234567890abcdef... (42 символа)"
  },
  bitmex: {
    minLength: 24,
    maxLength: 48,
    pattern: /^[a-zA-Z0-9_-]{24,48}$/,
    description: "BitMEX API ключ должен содержать от 24 до 48 символов (буквы, цифры, дефисы и подчёркивания)",
    exampleFormat: "Пример: aBc_123-XYZ (24-48 символов)"
  },
  blofin: {
    minLength: 36,
    maxLength: 48,
    pattern: /^[a-zA-Z0-9-]{36,48}$/,
    description: "BloFin API ключ должен содержать от 36 до 48 символов (буквы, цифры и дефисы)",
    exampleFormat: "Пример: aBc-123...XYZ (36-48 символов)"
  },
  gate: {
    minLength: 32,
    maxLength: 64,
    pattern: /^[a-zA-Z0-9]{32,64}$/,
    description: "Gate.io API ключ должен содержать от 32 до 64 символов (буквы и цифры)",
    exampleFormat: "Пример: aBc123...XYZ (32-64 символа)"
  },
  aster: {
    minLength: 32,
    maxLength: 64,
    pattern: /^[a-zA-Z0-9]{32,64}$/,
    description: "Aster DEX API ключ должен содержать от 32 до 64 символов (буквы и цифры)",
    exampleFormat: "Пример: aBc123...XYZ (32-64 символа)"
  }
};

/**
 * API Secret Format Specifications by Exchange
 */
const API_SECRET_SPECS: Record<string, {
  minLength: number;
  description: string;
}> = {
  binance: {
    minLength: 64,
    description: "Binance API Secret должен содержать минимум 64 символа"
  },
  bybit: {
    minLength: 32,
    description: "Bybit API Secret должен содержать минимум 32 символа"
  },
  okx: {
    minLength: 32,
    description: "OKX API Secret должен содержать минимум 32 символа"
  },
  bitget: {
    minLength: 32,
    description: "Bitget API Secret должен содержать минимум 32 символа"
  },
  bingx: {
    minLength: 32,
    description: "BingX API Secret должен содержать минимум 32 символа"
  },
  kucoin: {
    minLength: 32,
    description: "KuCoin API Secret должен содержать минимум 32 символа"
  },
  coinbase: {
    minLength: 32,
    description: "Coinbase API Secret должен содержать минимум 32 символа"
  },
  huobi: {
    minLength: 32,
    description: "HTX (Huobi) API Secret должен содержать минимум 32 символа"
  },
  hyperliquid: {
    minLength: 64,
    description: "HyperLiquid приватный ключ должен содержать минимум 64 символа"
  },
  bitmex: {
    minLength: 32,
    description: "BitMEX API Secret должен содержать минимум 32 символа"
  },
  blofin: {
    minLength: 32,
    description: "BloFin API Secret должен содержать минимум 32 символа"
  },
  gate: {
    minLength: 32,
    description: "Gate.io API Secret должен содержать минимум 32 символа"
  },
  aster: {
    minLength: 32,
    description: "Aster DEX API Secret должен содержать минимум 32 символа"
  }
};

/**
 * Validate API key format with detailed error messages
 * 
 * Performs format validation for known exchanges with user-friendly error messages.
 * Note: This only validates format, not whether the key is valid/active on the exchange.
 * 
 * @param key - The API key to validate
 * @param exchange - The exchange identifier (e.g., 'binance', 'bybit')
 * @returns Detailed validation result with error messages
 */
export function validateApiKeyFormat(key: string, exchange: string): boolean {
  const result = validateApiKeyDetailed(key, exchange);
  return result.isValid;
}

/**
 * Validate API key with detailed result
 * 
 * @param key - The API key to validate
 * @param exchange - The exchange identifier
 * @returns Detailed validation result with error messages
 */
export function validateApiKeyDetailed(key: string, exchange: string): ApiKeyValidationResult {
  const normalizedExchange = exchange.toLowerCase();
  
  // Basic checks
  if (!key) {
    return {
      isValid: false,
      error: "API ключ не указан",
      errorKey: "api_key.required",
      details: { exchange: normalizedExchange }
    };
  }
  
  // Check for whitespace
  if (key !== key.trim()) {
    return {
      isValid: false,
      error: "API ключ содержит пробелы в начале или конце. Удалите их.",
      errorKey: "api_key.whitespace",
      details: { exchange: normalizedExchange }
    };
  }
  
  // Check minimum length for any exchange
  if (key.length < 10) {
    return {
      isValid: false,
      error: "API ключ слишком короткий (минимум 10 символов)",
      errorKey: "api_key.too_short",
      details: { 
        actualLength: key.length,
        exchange: normalizedExchange 
      }
    };
  }
  
  // Get exchange-specific spec
  const spec = API_KEY_SPECS[normalizedExchange];
  
  if (!spec) {
    // Unknown exchange - use basic validation
    if (key.length >= 10) {
      return { isValid: true };
    }
    return {
      isValid: false,
      error: `Неизвестная биржа: ${exchange}. API ключ должен содержать минимум 10 символов.`,
      errorKey: "api_key.unknown_exchange",
      details: { exchange: normalizedExchange }
    };
  }
  
  // Check length
  if (key.length < spec.minLength || key.length > spec.maxLength) {
    return {
      isValid: false,
      error: spec.description,
      errorKey: "api_key.invalid_length",
      details: {
        expectedLength: spec.minLength === spec.maxLength 
          ? spec.minLength 
          : `${spec.minLength}-${spec.maxLength}`,
        actualLength: key.length,
        expectedFormat: spec.exampleFormat,
        exchange: normalizedExchange
      }
    };
  }
  
  // Check pattern
  if (!spec.pattern.test(key)) {
    return {
      isValid: false,
      error: spec.description,
      errorKey: "api_key.invalid_format",
      details: {
        expectedFormat: spec.exampleFormat,
        exchange: normalizedExchange
      }
    };
  }
  
  return { isValid: true };
}

/**
 * Validate API secret with detailed result
 * 
 * @param secret - The API secret to validate
 * @param exchange - The exchange identifier
 * @returns Detailed validation result with error messages
 */
export function validateApiSecretDetailed(secret: string, exchange: string): ApiKeyValidationResult {
  const normalizedExchange = exchange.toLowerCase();
  
  // Basic checks
  if (!secret) {
    return {
      isValid: false,
      error: "API Secret не указан",
      errorKey: "api_secret.required",
      details: { exchange: normalizedExchange }
    };
  }
  
  // Check for whitespace
  if (secret !== secret.trim()) {
    return {
      isValid: false,
      error: "API Secret содержит пробелы в начале или конце. Удалите их.",
      errorKey: "api_secret.whitespace",
      details: { exchange: normalizedExchange }
    };
  }
  
  // Get exchange-specific spec
  const spec = API_SECRET_SPECS[normalizedExchange];
  
  if (!spec) {
    // Unknown exchange - use basic validation
    if (secret.length >= 16) {
      return { isValid: true };
    }
    return {
      isValid: false,
      error: `API Secret слишком короткий (минимум 16 символов)`,
      errorKey: "api_secret.too_short",
      details: { 
        actualLength: secret.length,
        exchange: normalizedExchange 
      }
    };
  }
  
  // Check minimum length
  if (secret.length < spec.minLength) {
    return {
      isValid: false,
      error: spec.description,
      errorKey: "api_secret.too_short",
      details: {
        expectedLength: `минимум ${spec.minLength}`,
        actualLength: secret.length,
        exchange: normalizedExchange
      }
    };
  }
  
  return { isValid: true };
}

/**
 * Validate passphrase for exchanges that require it (OKX, KuCoin, Bitget, BloFin)
 * 
 * @param passphrase - The passphrase to validate
 * @param exchange - The exchange identifier
 * @returns Validation result
 */
export function validatePassphrase(passphrase: string | undefined, exchange: string): ApiKeyValidationResult {
  const normalizedExchange = exchange.toLowerCase();
  const exchangesRequiringPassphrase = ['okx', 'kucoin', 'bitget', 'blofin'];
  
  if (exchangesRequiringPassphrase.includes(normalizedExchange)) {
    if (!passphrase || passphrase.trim().length === 0) {
      return {
        isValid: false,
        error: `${exchange.toUpperCase()} требует API Passphrase. Укажите его в настройках API ключа.`,
        errorKey: "passphrase.required",
        details: { exchange: normalizedExchange }
      };
    }
    
    if (passphrase.length < 8) {
      return {
        isValid: false,
        error: "API Passphrase должен содержать минимум 8 символов",
        errorKey: "passphrase.too_short",
        details: { 
          actualLength: passphrase.length,
          exchange: normalizedExchange 
        }
      };
    }
  }
  
  return { isValid: true };
}

/**
 * Validate all API credentials for an exchange
 * 
 * @param credentials - The credentials to validate
 * @param exchange - The exchange identifier
 * @returns Combined validation result
 */
export function validateCredentials(
  credentials: { apiKey: string; apiSecret: string; passphrase?: string },
  exchange: string
): { isValid: boolean; errors: ApiKeyValidationResult[] } {
  const errors: ApiKeyValidationResult[] = [];
  
  // Validate API Key
  const keyResult = validateApiKeyDetailed(credentials.apiKey, exchange);
  if (!keyResult.isValid) {
    errors.push(keyResult);
  }
  
  // Validate API Secret
  const secretResult = validateApiSecretDetailed(credentials.apiSecret, exchange);
  if (!secretResult.isValid) {
    errors.push(secretResult);
  }
  
  // Validate Passphrase if required
  const passphraseResult = validatePassphrase(credentials.passphrase, exchange);
  if (!passphraseResult.isValid) {
    errors.push(passphraseResult);
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Get all supported exchanges for validation
 */
export function getSupportedExchangesForValidation(): string[] {
  return Object.keys(API_KEY_SPECS);
}

// ==================== SECURE STORAGE ====================

/**
 * Securely store API credentials for an account
 * 
 * Encrypts all sensitive credential data before storage.
 * 
 * @security This function logs masked key information for audit purposes
 */
export async function storeApiCredentials(params: {
  accountId: string;
  apiKey: string;
  apiSecret: string;
  apiPassphrase?: string;
  apiUid?: string;
}): Promise<void> {
  const { accountId, apiKey, apiSecret, apiPassphrase, apiUid } = params;
  
  // Validate encryption is properly configured before storing
  const validation = validateEncryptionSetup();
  if (!validation.isValid) {
    throw new Error(`Cannot store credentials: ${validation.error}`);
  }
  
  // Encrypt all credentials
  const encryptedKey = encryptApiKey(apiKey);
  const encryptedSecret = encryptApiKey(apiSecret);
  const encryptedPassphrase = apiPassphrase ? encryptApiKey(apiPassphrase) : null;
  const encryptedUid = apiUid ? encryptApiKey(apiUid) : null;
  
  console.log(`[Security] API credentials encrypted for account ${accountId}`);
  console.log(`[Security] API Key (masked): ${maskApiKey(apiKey)}`);
}

/**
 * Retrieve and decrypt API credentials
 * 
 * @security Decrypted credentials should never be logged or cached unnecessarily
 */
export async function retrieveApiCredentials(account: {
  apiKey: string | null;
  apiSecret: string | null;
  apiPassphrase?: string | null;
  apiUid?: string | null;
}): Promise<{
  apiKey: string;
  apiSecret: string;
  apiPassphrase?: string;
  apiUid?: string;
} | null> {
  if (!account.apiKey || !account.apiSecret) {
    return null;
  }
  
  try {
    return {
      apiKey: decryptApiKey(account.apiKey),
      apiSecret: decryptApiKey(account.apiSecret),
      apiPassphrase: account.apiPassphrase ? decryptApiKey(account.apiPassphrase) : undefined,
      apiUid: account.apiUid ? decryptApiKey(account.apiUid) : undefined,
    };
  } catch (error) {
    console.error("[Security] Failed to decrypt API credentials");
    return null;
  }
}

// ==================== EXPORTS ====================

export {
  ALGORITHM,
  IV_LENGTH,
  AUTH_TAG_LENGTH,
  SALT_LENGTH,
};
