/**
 * Cryptographic Key Encryptor
 * 
 * AES-256-GCM encryption for API keys and sensitive credentials
 * Provides secure storage and retrieval of exchange API credentials
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const ITERATIONS = 100000;

/**
 * Encrypted API key structure
 */
export interface EncryptedData {
  ciphertext: string;    // Hex encoded encrypted data
  iv: string;           // Hex encoded initialization vector
  authTag: string;      // Hex encoded authentication tag
  salt?: string;        // Hex encoded salt (for key derivation)
}

/**
 * Encrypted API key with metadata
 */
export interface EncryptedApiKey {
  ciphertext: string;
  iv: string;
  authTag: string;
  version: number;
  createdAt: number;
}

/**
 * Key encryption configuration
 */
export interface KeyEncryptorConfig {
  encryptionKey?: string;
  algorithm?: string;
  iterations?: number;
}

/**
 * Key Encryptor Class
 * 
 * Provides AES-256-GCM encryption for sensitive data like API keys.
 * Uses PBKDF2 for key derivation from environment variable.
 */
export class KeyEncryptor {
  private key: Buffer;
  private algorithm: string;
  private iterations: number;

  constructor(config?: KeyEncryptorConfig) {
    const envKey = config?.encryptionKey ?? process.env.ENCRYPTION_KEY;
    
    if (!envKey) {
      // Generate a random key for development/demo mode
      // In production, ENCRYPTION_KEY must be set
      console.warn('[KeyEncryptor] WARNING: ENCRYPTION_KEY not set, using generated key. Set ENCRYPTION_KEY in production!');
      this.key = crypto.randomBytes(ENCRYPTION_KEY_LENGTH);
    } else {
      // Derive key from environment variable using PBKDF2
      const salt = process.env.ENCRYPTION_SALT || 'citarion-encryption-salt-2026';
      this.key = crypto.pbkdf2Sync(
        envKey,
        salt,
        config?.iterations ?? ITERATIONS,
        ENCRYPTION_KEY_LENGTH,
        'sha256'
      );
    }
    
    this.algorithm = config?.algorithm ?? ALGORITHM;
    this.iterations = config?.iterations ?? ITERATIONS;
  }

  /**
   * Encrypt a string value
   * 
   * @param value - Plain text to encrypt
   * @returns Encrypted data object
   */
  encrypt(value: string): EncryptedData {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      ciphertext: encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
    };
  }

  /**
   * Decrypt an encrypted value
   * 
   * @param encrypted - Encrypted data object
   * @returns Decrypted plain text
   * @throws Error if decryption fails
   */
  decrypt(encrypted: EncryptedData): string {
    try {
      const ivBuffer = Buffer.from(encrypted.iv, 'hex');
      const authTagBuffer = Buffer.from(encrypted.authTag, 'hex');
      
      const decipher = crypto.createDecipheriv(this.algorithm, this.key, ivBuffer);
      decipher.setAuthTag(authTagBuffer);
      
      let decrypted = decipher.update(encrypted.ciphertext, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Encrypt an API key with metadata
   * 
   * @param key - API key to encrypt
   * @returns Encrypted API key object
   */
  encryptApiKey(key: string): EncryptedApiKey {
    const { ciphertext, iv, authTag } = this.encrypt(key);
    return {
      ciphertext,
      iv,
      authTag,
      version: 1,
      createdAt: Date.now(),
    };
  }

  /**
   * Decrypt an API key
   * 
   * @param encrypted - Encrypted API key object
   * @returns Decrypted API key string
   */
  decryptApiKey(encrypted: EncryptedApiKey): string {
    return this.decrypt({
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    });
  }

  /**
   * Verify encryption is working correctly
   * 
   * @returns True if encryption/decryption works
   */
  verifyEncryption(): boolean {
    const testData = 'test-key-' + Date.now();
    const encrypted = this.encrypt(testData);
    const decrypted = this.decrypt(encrypted);
    return decrypted === testData;
  }

  /**
   * Generate a new encryption key for environment setup
   * 
   * @returns Hex encoded 256-bit key
   */
  static generateKey(): string {
    return crypto.randomBytes(ENCRYPTION_KEY_LENGTH).toString('hex');
  }

  /**
   * Hash a value using SHA-256 (for API key prefix storage)
   * 
   * @param value - Value to hash
   * @returns Hex encoded hash
   */
  static hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  /**
   * Generate a secure random token
   * 
   * @param length - Token length in bytes
   * @returns Hex encoded random token
   */
  static generateToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }
}

// Singleton instance
let keyEncryptorInstance: KeyEncryptor | null = null;

/**
 * Get the singleton KeyEncryptor instance
 */
export function getKeyEncryptor(): KeyEncryptor {
  if (!keyEncryptorInstance) {
    keyEncryptorInstance = new KeyEncryptor();
  }
  return keyEncryptorInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetKeyEncryptor(): void {
  keyEncryptorInstance = null;
}

// Default export
export const keyEncryptor = new KeyEncryptor();
export default keyEncryptor;
