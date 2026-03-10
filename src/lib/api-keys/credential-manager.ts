/**
 * Credential Manager
 * 
 * Secure management of exchange API credentials
 * Handles encryption, storage, retrieval, and validation of API keys
 */

import { db } from '@/lib/db';
import keyEncryptor, { EncryptedApiKey, EncryptedData } from '@/lib/crypto/key-encryptor';

/**
 * API Credentials interface
 */
export interface ApiCredentials {
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string;
  uid?: string;
}

/**
 * Credential validation result
 */
export interface CredentialValidationResult {
  valid: boolean;
  error?: string;
  permissions?: string[];
  accountId?: string;
}

/**
 * Exchange configuration for validation
 */
export interface ExchangeConfig {
  name: string;
  requiresPassphrase: boolean;
  requiresUid: boolean;
  testUrl: string;
  liveUrl: string;
}

/**
 * Exchange configurations for credential validation
 */
const EXCHANGE_CONFIGS: Record<string, ExchangeConfig> = {
  binance: {
    name: 'Binance',
    requiresPassphrase: false,
    requiresUid: false,
    testUrl: 'https://testnet.binance.vision',
    liveUrl: 'https://api.binance.com',
  },
  bybit: {
    name: 'Bybit',
    requiresPassphrase: false,
    requiresUid: false,
    testUrl: 'https://api-testnet.bybit.com',
    liveUrl: 'https://api.bybit.com',
  },
  okx: {
    name: 'OKX',
    requiresPassphrase: true,
    requiresUid: false,
    testUrl: 'https://www.okx.com',
    liveUrl: 'https://www.okx.com',
  },
  bitget: {
    name: 'Bitget',
    requiresPassphrase: true,
    requiresUid: false,
    testUrl: 'https://api.bitget.com',
    liveUrl: 'https://api.bitget.com',
  },
  kucoin: {
    name: 'KuCoin',
    requiresPassphrase: true,
    requiresUid: false,
    testUrl: 'https://openapi-sandbox.kucoin.com',
    liveUrl: 'https://api.kucoin.com',
  },
  bingx: {
    name: 'BingX',
    requiresPassphrase: false,
    requiresUid: false,
    testUrl: 'https://open-api.bingx.com',
    liveUrl: 'https://open-api.bingx.com',
  },
  coinbase: {
    name: 'Coinbase',
    requiresPassphrase: true,
    requiresUid: false,
    testUrl: 'https://api-public.sandbox.exchange.coinbase.com',
    liveUrl: 'https://api.exchange.coinbase.com',
  },
  huobi: {
    name: 'Huobi',
    requiresPassphrase: false,
    requiresUid: false,
    testUrl: 'https://api.huobi.pro',
    liveUrl: 'https://api.huobi.pro',
  },
  hyperliquid: {
    name: 'HyperLiquid',
    requiresPassphrase: false,
    requiresUid: false,
    testUrl: 'https://api.hyperliquid-testnet.xyz',
    liveUrl: 'https://api.hyperliquid.xyz',
  },
  bitmex: {
    name: 'BitMEX',
    requiresPassphrase: false,
    requiresUid: false,
    testUrl: 'https://testnet.bitmex.com',
    liveUrl: 'https://www.bitmex.com',
  },
  blofin: {
    name: 'BloFin',
    requiresPassphrase: true,
    requiresUid: false,
    testUrl: 'https://openapi.blofin.com',
    liveUrl: 'https://openapi.blofin.com',
  },
};

/**
 * Credential Manager Class
 * 
 * Handles secure storage and retrieval of exchange API credentials
 */
export class CredentialManager {
  private static instance: CredentialManager | null = null;
  private encryptionVersion = 1;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): CredentialManager {
    if (!CredentialManager.instance) {
      CredentialManager.instance = new CredentialManager();
    }
    return CredentialManager.instance;
  }

  /**
   * Encrypt credentials to a JSON string for database storage
   * 
   * @param credentials - API credentials to encrypt
   * @returns JSON string with encrypted credentials
   */
  encryptCredentials(credentials: ApiCredentials): string {
    const encrypted: Record<string, EncryptedApiKey> = {};

    if (credentials.apiKey) {
      const encryptedKey = keyEncryptor.encryptApiKey(credentials.apiKey);
      encrypted.encryptedApiKey = {
        ...encryptedKey,
        version: this.encryptionVersion,
        createdAt: Date.now(),
      };
    }

    if (credentials.apiSecret) {
      const encryptedSecret = keyEncryptor.encryptApiKey(credentials.apiSecret);
      encrypted.encryptedApiSecret = {
        ...encryptedSecret,
        version: this.encryptionVersion,
        createdAt: Date.now(),
      };
    }

    if (credentials.passphrase) {
      const encryptedPassphrase = keyEncryptor.encryptApiKey(credentials.passphrase);
      encrypted.encryptedPassphrase = {
        ...encryptedPassphrase,
        version: this.encryptionVersion,
        createdAt: Date.now(),
      };
    }

    if (credentials.uid) {
      const encryptedUid = keyEncryptor.encryptApiKey(credentials.uid);
      encrypted.encryptedUid = {
        ...encryptedUid,
        version: this.encryptionVersion,
        createdAt: Date.now(),
      };
    }

    return JSON.stringify({
      version: this.encryptionVersion,
      ...encrypted,
    });
  }

  /**
   * Decrypt credentials from database storage
   * 
   * @param encryptedString - JSON string with encrypted credentials
   * @returns Decrypted API credentials
   */
  decryptCredentials(encryptedString: string): ApiCredentials {
    if (!encryptedString) {
      return {};
    }

    try {
      const parsed = JSON.parse(encryptedString);
      const credentials: ApiCredentials = {};

      if (parsed.encryptedApiKey) {
        credentials.apiKey = keyEncryptor.decryptApiKey({
          ciphertext: parsed.encryptedApiKey.ciphertext,
          iv: parsed.encryptedApiKey.iv,
          authTag: parsed.encryptedApiKey.authTag,
        });
      }

      if (parsed.encryptedApiSecret) {
        credentials.apiSecret = keyEncryptor.decryptApiKey({
          ciphertext: parsed.encryptedApiSecret.ciphertext,
          iv: parsed.encryptedApiSecret.iv,
          authTag: parsed.encryptedApiSecret.authTag,
        });
      }

      if (parsed.encryptedPassphrase) {
        credentials.passphrase = keyEncryptor.decryptApiKey({
          ciphertext: parsed.encryptedPassphrase.ciphertext,
          iv: parsed.encryptedPassphrase.iv,
          authTag: parsed.encryptedPassphrase.authTag,
        });
      }

      if (parsed.encryptedUid) {
        credentials.uid = keyEncryptor.decryptApiKey({
          ciphertext: parsed.encryptedUid.ciphertext,
          iv: parsed.encryptedUid.iv,
          authTag: parsed.encryptedUid.authTag,
        });
      }

      return credentials;
    } catch (error) {
      console.error('[CredentialManager] Failed to decrypt credentials:', error);
      return {};
    }
  }

  /**
   * Save credentials to database (encrypted)
   * 
   * @param accountId - Account ID
   * @param credentials - API credentials to save
   */
  async saveCredentials(accountId: string, credentials: ApiCredentials): Promise<void> {
    const encryptedString = this.encryptCredentials(credentials);

    await db.account.update({
      where: { id: accountId },
      data: {
        encryptedApiCredentials: encryptedString,
        encryptionVersion: this.encryptionVersion,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Get credentials from database (decrypted)
   * 
   * @param accountId - Account ID
   * @returns Decrypted API credentials
   */
  async getCredentials(accountId: string): Promise<ApiCredentials | null> {
    const account = await db.account.findUnique({
      where: { id: accountId },
      select: {
        encryptedApiCredentials: true,
        encryptionVersion: true,
      },
    });

    if (!account || !account.encryptedApiCredentials) {
      return null;
    }

    return this.decryptCredentials(account.encryptedApiCredentials);
  }

  /**
   * Check if credentials exist for an account
   * 
   * @param accountId - Account ID
   * @returns True if credentials exist
   */
  async hasCredentials(accountId: string): Promise<boolean> {
    const account = await db.account.findUnique({
      where: { id: accountId },
      select: {
        encryptedApiCredentials: true,
      },
    });

    return !!account?.encryptedApiCredentials;
  }

  /**
   * Delete credentials from database
   * 
   * @param accountId - Account ID
   */
  async deleteCredentials(accountId: string): Promise<void> {
    await db.account.update({
      where: { id: accountId },
      data: {
        encryptedApiCredentials: null,
        encryptionVersion: null,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Validate credentials format
   * 
   * @param exchangeId - Exchange identifier
   * @param credentials - Credentials to validate
   * @returns Validation result
   */
  validateFormat(
    exchangeId: string,
    credentials: ApiCredentials
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const config = EXCHANGE_CONFIGS[exchangeId];

    if (!config) {
      errors.push(`Unknown exchange: ${exchangeId}`);
      return { valid: false, errors };
    }

    // Check required fields
    if (!credentials.apiKey) {
      errors.push('API Key is required');
    } else if (credentials.apiKey.length < 16) {
      errors.push('API Key appears to be too short');
    }

    if (!credentials.apiSecret) {
      errors.push('API Secret is required');
    } else if (credentials.apiSecret.length < 16) {
      errors.push('API Secret appears to be too short');
    }

    // Check exchange-specific requirements
    if (config.requiresPassphrase && !credentials.passphrase) {
      errors.push(`${config.name} requires a passphrase`);
    }

    if (config.requiresUid && !credentials.uid) {
      errors.push(`${config.name} requires a UID`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get masked API key for display (shows only first 8 and last 4 characters)
   * 
   * @param apiKey - API key to mask
   * @returns Masked API key
   */
  maskApiKey(apiKey: string): string {
    if (!apiKey || apiKey.length < 12) {
      return '****';
    }
    return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
  }

  /**
   * Get exchange configuration
   * 
   * @param exchangeId - Exchange identifier
   * @returns Exchange configuration or undefined
   */
  getExchangeConfig(exchangeId: string): ExchangeConfig | undefined {
    return EXCHANGE_CONFIGS[exchangeId];
  }

  /**
   * Get all supported exchanges
   * 
   * @returns List of supported exchanges
   */
  getSupportedExchanges(): ExchangeConfig[] {
    return Object.values(EXCHANGE_CONFIGS);
  }

  /**
   * Migrate legacy plaintext credentials to encrypted format
   * 
   * @param accountId - Account ID
   * @param legacyApiKey - Legacy plaintext API key
   * @param legacyApiSecret - Legacy plaintext API secret
   * @param legacyPassphrase - Legacy plaintext passphrase
   * @param legacyUid - Legacy plaintext UID
   */
  async migrateLegacyCredentials(
    accountId: string,
    legacyApiKey?: string | null,
    legacyApiSecret?: string | null,
    legacyPassphrase?: string | null,
    legacyUid?: string | null
  ): Promise<void> {
    // Check if already migrated
    const account = await db.account.findUnique({
      where: { id: accountId },
      select: { encryptedApiCredentials: true },
    });

    if (account?.encryptedApiCredentials) {
      console.log(`[CredentialManager] Account ${accountId} already has encrypted credentials`);
      return;
    }

    // Check if has legacy credentials
    if (!legacyApiKey && !legacyApiSecret) {
      console.log(`[CredentialManager] No legacy credentials to migrate for account ${accountId}`);
      return;
    }

    // Encrypt and save
    const credentials: ApiCredentials = {};
    if (legacyApiKey) credentials.apiKey = legacyApiKey;
    if (legacyApiSecret) credentials.apiSecret = legacyApiSecret;
    if (legacyPassphrase) credentials.passphrase = legacyPassphrase;
    if (legacyUid) credentials.uid = legacyUid;

    await this.saveCredentials(accountId, credentials);

    // Clear legacy fields
    await db.account.update({
      where: { id: accountId },
      data: {
        apiKey: null,
        apiSecret: null,
        apiPassphrase: null,
        apiUid: null,
      },
    });

    console.log(`[CredentialManager] Migrated credentials for account ${accountId}`);
  }

  /**
   * Migrate all accounts with legacy credentials
   * 
   * @returns Number of accounts migrated
   */
  async migrateAllLegacyCredentials(): Promise<number> {
    const accounts = await db.account.findMany({
      where: {
        OR: [
          { apiKey: { not: null } },
          { apiSecret: { not: null } },
        ],
        encryptedApiCredentials: null,
      },
      select: {
        id: true,
        apiKey: true,
        apiSecret: true,
        apiPassphrase: true,
        apiUid: true,
      },
    });

    let migrated = 0;
    for (const account of accounts) {
      try {
        await this.migrateLegacyCredentials(
          account.id,
          account.apiKey,
          account.apiSecret,
          account.apiPassphrase,
          account.apiUid
        );
        migrated++;
      } catch (error) {
        console.error(`[CredentialManager] Failed to migrate account ${account.id}:`, error);
      }
    }

    return migrated;
  }
}

// Export singleton instance
export const credentialManager = CredentialManager.getInstance();
export default credentialManager;
