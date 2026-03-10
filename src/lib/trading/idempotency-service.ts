/**
 * Idempotency Service
 * 
 * Prevents duplicate order submissions using idempotency keys
 * Each unique request gets a unique key, and the will return the same response if the same key is used again
 * within the * a short time window (default: 5 minutes)
 */

import { db } from '@/lib/db';
import crypto from 'crypto';

interface CachedResult {
  id: string;
  result: any;
  timestamp: Date;
}

// In-memory cache for fast lookups (backed by DB)
const idempotencyCache = new Map<string, CachedResult>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generate a unique idempotency key for a trade request
 */
export function generateIdempotencyKey(params: {
  userId: string;
  accountId: string;
  symbol: string;
  direction: string;
  amount: number;
  leverage: number;
}): string {
  const dataToHash = JSON.stringify({
    userId: params.userId,
    accountId: params.accountId,
    symbol: params.symbol,
    direction: params.direction,
    amount: params.amount,
    leverage: params.leverage,
    timestamp: new Date().toISOString().split('T')[0], // Same day
  });
  
  return crypto
    .createHash('sha256')
    .update(dataToHash)
    .digest('hex')
    .toString()
    .substring(0, 16); // Shorter key for readability
}

/**
 * Check if a request with the same parameters was already processed
 * Returns the previous result if found, or null if not found
 */
export async function checkIdempotencyKey(
  key: string,
  userId: string
): Promise<{ exists: boolean; result?: any; orderId?: string }> {
  // Check memory cache first (fast)
  const cached = idempotencyCache.get(key);
  if (cached) {
    const age = Date.now() - cached.timestamp.getTime();
    if (age < CACHE_TTL_MS) {
      console.log(`[IdempotencyService] Found in memory cache: ${key}`);
      return { 
        exists: true, 
        result: cached.result,
        orderId: cached.id
      };
    }
  }

  // Check database
  const dbRecord = await db.idempotencyKey.findFirst({
    where: {
      keyHash: crypto
        .createHash('sha256')
        .update(key)
        .digest('hex')
        .toString(),
      userId,
      status: { in: ['COMPLETED', 'PENDING'] }
    }
  });

  if (dbRecord) {
    return {
      exists: true,
      result: JSON.parse(dbRecord.requestJson),
      orderId: dbRecord.orderId || undefined
    };
  }

  return { exists: false };
}

/**
 * Store a new idempotency key to used for a request
 * Returns the unique ID for this request
 */
export async function storeIdempotencyKey(
  key: string,
  userId: string,
  request: any
): Promise<string> {
  const keyHash = crypto
    .createHash('sha256')
    .update(key)
    .digest('hex')
    .toString();

  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS);

  // Store in database
  await db.idempotencyKey.create({
    data: {
    id,
    keyHash,
    key,
    userId,
    requestJson: JSON.stringify(request),
    status: 'PENDING',
    expiresAt
  }
  });

  // Store in memory cache
  idempotencyCache.set(key, {
    id,
    result: request,
    timestamp: new Date()
  });

  return id;
}

/**
 * Complete an idempotency key with the result
 * Called when the trade is successfully executed
 */
export async function completeIdempotencyKey(
  key: string,
  orderId: string,
  result: any
): Promise<void> {
  const keyHash = crypto
    .createHash('sha256')
    .update(key)
    .digest('hex')
    .toString();

  // Update database
  await db.idempotencyKey.updateMany({
    where: {
      keyHash,
      status: 'PENDING'
    },
    data: {
      status: 'COMPLETED',
      orderId
    }
  });

  // Update memory cache
  const cached = idempotencyCache.get(key);
  if (cached) {
    idempotencyCache.set(key, {
      ...cached,
      result: { ...cached.result, ...result }
    });
  }

  console.log(`[IdempotencyService] Completed: ${key} -> Order: ${orderId}`);
}

/**
 * Clean up expired keys from memory cache
 * Should be called periodically
 */
export function cleanupExpiredKeys(): void {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, value] of idempotencyCache.entries()) {
    if (now - value.timestamp.getTime() > CACHE_TTL_MS) {
      idempotencyCache.delete(key);
      cleaned++;
    }
  }

  // Also clean up DB
  db.idempotencyKey.deleteMany({
    where: {
      status: 'PENDING',
      expiresAt: { lt: new Date() }
    }
  }).catch(err => {
    console.error('[IdemptencyService] Cleanup error:', err);
  });

  if (cleaned > 0) {
    console.log(`[IdemptencyService] Cleaned up ${cleaned} expired keys`);
  }
}

// Run cleanup every minute
setInterval(cleanupExpiredKeys, 60000);
