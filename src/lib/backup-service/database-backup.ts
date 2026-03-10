/**
 * Backup Service - Database Backup Implementation
 * Production-ready backup with encryption, compression, and scheduling
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { db } from '@/lib/db';
import type {
  BackupRecord,
  BackupResult,
  BackupStats,
  BackupFilter,
  CreateBackupRequest,
  RestoreResult,
  RestoreRequest,
} from './types';

const execAsync = promisify(exec);
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Default backup configuration
const DEFAULT_CONFIG = {
  backupDir: './backups',
  retentionDays: 30,
  compress: true,
  encrypt: true,
  compressionLevel: 6,
};

/**
 * Database Backup Service
 * Handles SQLite database backup with encryption and compression
 */
export class DatabaseBackupService {
  private backupDir: string;
  private retentionDays: number;
  private encrypt: boolean;
  private compressionLevel: number;

  constructor(config?: Partial<typeof DEFAULT_CONFIG>) {
    this.backupDir = config?.backupDir || DEFAULT_CONFIG.backupDir;
    this.retentionDays = config?.retentionDays || DEFAULT_CONFIG.retentionDays;
    this.encrypt = config?.encrypt ?? DEFAULT_CONFIG.encrypt;
    this.compressionLevel = config?.compressionLevel || DEFAULT_CONFIG.compressionLevel;
  }

  /**
   * Create a database backup
   */
  async createBackup(options: CreateBackupRequest & { id: string }): Promise<BackupResult> {
    const startTime = Date.now();
    const warnings: string[] = [];
    
    try {
      // Ensure backup directory exists
      await fs.mkdir(this.backupDir, { recursive: true });

      // Generate backup filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const name = options.name || `backup-${timestamp}`;
      const fileName = `${name}.db${this.encrypt ? '.enc' : ''}${DEFAULT_CONFIG.compress ? '.gz' : ''}`;
      const filePath = path.join(this.backupDir, fileName);

      // Get database path from environment
      const dbPath = process.env.DATABASE_URL?.replace('file:', '') || './db/custom.db';
      
      // Read the database file
      const dbData = await fs.readFile(dbPath);
      let processedData = dbData;
      let fileSize = dbData.length;
      let checksum = this.calculateChecksum(dbData);

      // Compress if enabled
      if (DEFAULT_CONFIG.compress) {
        processedData = await gzip(processedData, { level: this.compressionLevel });
        fileSize = processedData.length;
      }

      // Encrypt if enabled
      if (this.encrypt) {
        const key = this.getEncryptionKey();
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        
        processedData = Buffer.concat([
          iv,
          cipher.update(processedData),
          cipher.final(),
          cipher.getAuthTag(),
        ]);
        fileSize = processedData.length;
      }

      // Write backup file
      await fs.writeFile(filePath, processedData);

      // Calculate record count from database
      const recordCount = await this.getDatabaseRecordCount();

      // Calculate duration
      const duration = Date.now() - startTime;

      // Update backup record in database
      await db.backupRecord.update({
        where: { id: options.id },
        data: {
          status: 'completed',
          fileName,
          filePath,
          fileSize,
          checksum,
          compressed: DEFAULT_CONFIG.compress,
          encrypted: this.encrypt,
          completedAt: new Date(),
          recordCount,
          warningCount: warnings.length,
          metadata: JSON.stringify({ duration, warnings }),
        },
      });

      // Update backup config stats
      await this.updateBackupStats(fileSize, true);

      // Clean up old backups
      await this.deleteOldBackups();

      return {
        success: true,
        backupId: options.id,
        fileName,
        filePath,
        fileSize,
        checksum,
        recordCount,
        duration,
        warnings,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Backup failed';
      
      // Update backup record with error
      await db.backupRecord.update({
        where: { id: options.id },
        data: {
          status: 'failed',
          errorMessage,
          completedAt: new Date(),
        },
      });

      // Update backup config stats
      await this.updateBackupStats(0, false);

      return {
        success: false,
        error: errorMessage,
        warnings,
      };
    }
  }

  /**
   * Restore database from backup
   */
  async restoreBackup(request: RestoreRequest): Promise<RestoreResult> {
    try {
      // Get backup record
      const backup = await db.backupRecord.findUnique({
        where: { id: request.backupId },
      });

      if (!backup || !backup.filePath) {
        return { success: false, error: 'Backup not found or no file path' };
      }

      // Read backup file
      let data = await fs.readFile(backup.filePath);

      // Decrypt if encrypted
      if (backup.encrypted) {
        const key = this.getEncryptionKey();
        const iv = data.slice(0, 16);
        const authTag = data.slice(-16);
        const encrypted = data.slice(16, -16);
        
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        
        data = Buffer.concat([
          decipher.update(encrypted),
          decipher.final(),
        ]);
      }

      // Decompress if compressed
      if (backup.compressed) {
        data = await gunzip(data);
      }

      // Verify checksum
      const checksum = this.calculateChecksum(data);
      if (backup.checksum && checksum !== backup.checksum) {
        return { success: false, error: 'Checksum verification failed - backup may be corrupted' };
      }

      // Create restore record
      const restoreRecord = await db.restoreRecord.create({
        data: {
          backupId: backup.id,
          backupName: backup.name,
          status: 'running',
          startedAt: new Date(),
          restoreMode: request.restoreMode || 'replace',
          targetScope: backup.scope as any,
          targetTables: request.targetTables || JSON.parse(backup.tables || '[]'),
          triggeredBy: 'manual',
        },
      });

      // Get current database path
      const dbPath = process.env.DATABASE_URL?.replace('file:', '') || './db/custom.db';

      // Create a backup of current database before restore
      const currentBackup = `${dbPath}.pre-restore-${Date.now()}`;
      await fs.copyFile(dbPath, currentBackup);

      try {
        // Write restored database
        await fs.writeFile(dbPath, data);

        // Update restore record
        await db.restoreRecord.update({
          where: { id: restoreRecord.id },
          data: {
            status: 'completed',
            completedAt: new Date(),
            progress: 100,
            recordsRestored: backup.recordCount,
            tablesRestored: JSON.parse(backup.tables || '[]').length || 1,
          },
        });

        return {
          success: true,
          recordsRestored: backup.recordCount,
          tablesRestored: JSON.parse(backup.tables || '[]').length || 1,
        };
      } catch (writeError) {
        // Restore original database on failure
        await fs.copyFile(currentBackup, dbPath);
        throw writeError;
      } finally {
        // Clean up pre-restore backup
        try {
          await fs.unlink(currentBackup);
        } catch {}
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Restore failed';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * List backups with filtering
   */
  async listBackups(filter?: BackupFilter): Promise<{
    data: BackupRecord[];
    meta: { total: number; page: number; limit: number; totalPages: number };
    stats: BackupStats;
  }> {
    const page = filter?.page || 1;
    const limit = filter?.limit || 20;
    const sortBy = filter?.sortBy || 'createdAt';
    const sortOrder = filter?.sortOrder || 'desc';

    // Build where clause
    const where: Record<string, unknown> = {};
    if (filter?.status) where.status = filter.status;
    if (filter?.type) where.type = filter.type;
    if (filter?.scope) where.scope = filter.scope;
    if (filter?.startDate || filter?.endDate) {
      where.createdAt = {};
      if (filter?.startDate) (where.createdAt as Record<string, unknown>).gte = filter.startDate;
      if (filter?.endDate) (where.createdAt as Record<string, unknown>).lte = filter.endDate;
    }
    if (filter?.search) {
      where.OR = [
        { name: { contains: filter.search } },
        { description: { contains: filter.search } },
      ];
    }

    // Execute queries
    const [records, total, stats] = await Promise.all([
      db.backupRecord.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      db.backupRecord.count({ where }),
      this.getBackupStats(),
    ]);

    // Parse JSON fields
    const data = records.map(record => ({
      ...record,
      tables: JSON.parse(record.tables || '[]'),
      metadata: JSON.parse(record.metadata || '{}'),
    })) as BackupRecord[];

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      stats,
    };
  }

  /**
   * Get backup statistics
   */
  async getBackupStats(): Promise<BackupStats> {
    const [total, successful, failed, sizes, lastBackup, lastSuccessful] = await Promise.all([
      db.backupRecord.count(),
      db.backupRecord.count({ where: { status: 'completed' } }),
      db.backupRecord.count({ where: { status: 'failed' } }),
      db.backupRecord.aggregate({
        where: { status: 'completed' },
        _sum: { fileSize: true },
        _avg: { fileSize: true },
      }),
      db.backupRecord.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      db.backupRecord.findFirst({
        where: { status: 'completed' },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      }),
    ]);

    const nextScheduled = await db.backupSchedule.findFirst({
      where: { isActive: true, nextRunAt: { gte: new Date() } },
      orderBy: { nextRunAt: 'asc' },
    });

    return {
      totalBackups: total,
      totalSize: sizes._sum.fileSize || 0,
      successfulBackups: successful,
      failedBackups: failed,
      lastBackup: lastBackup?.createdAt,
      lastSuccessful: lastSuccessful?.completedAt,
      avgBackupSize: sizes._avg.fileSize || 0,
      avgDuration: 0,
      upcomingScheduled: nextScheduled?.nextRunAt,
    };
  }

  /**
   * Delete old backups based on retention policy
   */
  async deleteOldBackups(): Promise<number> {
    const cutoffDate = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);
    let deletedCount = 0;

    try {
      const oldBackups = await db.backupRecord.findMany({
        where: {
          createdAt: { lt: cutoffDate },
          OR: [
            { expiresAt: { lt: new Date() } },
            { expiresAt: null },
          ],
        },
      });

      for (const backup of oldBackups) {
        try {
          // Delete file
          if (backup.filePath) {
            await fs.unlink(backup.filePath).catch(() => {});
          }
          
          // Delete record
          await db.backupRecord.delete({ where: { id: backup.id } });
          deletedCount++;
        } catch (error) {
          console.error(`[Backup] Failed to delete backup ${backup.id}:`, error);
        }
      }

      // Enforce max backups limit
      const config = await this.getOrCreateConfig();
      if (config.maxBackups > 0) {
        const allBackups = await db.backupRecord.findMany({
          where: { status: 'completed' },
          orderBy: { createdAt: 'desc' },
          select: { id: true, filePath: true },
        });

        if (allBackups.length > config.maxBackups) {
          const toDelete = allBackups.slice(config.maxBackups);
          for (const backup of toDelete) {
            try {
              if (backup.filePath) {
                await fs.unlink(backup.filePath).catch(() => {});
              }
              await db.backupRecord.delete({ where: { id: backup.id } });
              deletedCount++;
            } catch (error) {
              console.error(`[Backup] Failed to delete excess backup ${backup.id}:`, error);
            }
          }
        }
      }
    } catch (error) {
      console.error('[Backup] Cleanup error:', error);
    }

    return deletedCount;
  }

  /**
   * Calculate SHA-256 checksum
   */
  private calculateChecksum(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Get encryption key (from env or generate)
   */
  private getEncryptionKey(): Buffer {
    const key = process.env.BACKUP_ENCRYPTION_KEY || 'default-backup-encryption-key-32b';
    return crypto.createHash('sha256').update(key).digest();
  }

  /**
   * Get database record count
   */
  private async getDatabaseRecordCount(): Promise<number> {
    try {
      // Count records in key tables
      const counts = await Promise.all([
        db.user.count(),
        db.trade.count(),
        db.position.count(),
        db.signal.count(),
        db.botConfig.count(),
        db.journalEntry.count(),
        db.newsArticle.count(),
      ]);
      return counts.reduce((sum, count) => sum + count, 0);
    } catch {
      return 0;
    }
  }

  /**
   * Update backup config statistics
   */
  private async updateBackupStats(size: number, success: boolean): Promise<void> {
    try {
      const config = await this.getOrCreateConfig();
      await db.backupConfig.update({
        where: { id: config.id },
        data: {
          totalBackups: { increment: 1 },
          totalSizeBytes: { increment: size },
          lastBackupAt: new Date(),
          ...(success && { lastSuccessfulAt: new Date() }),
        },
      });
    } catch (error) {
      console.error('[Backup] Failed to update stats:', error);
    }
  }

  /**
   * Get or create backup config
   */
  async getOrCreateConfig() {
    let config = await db.backupConfig.findFirst();
    if (!config) {
      config = await db.backupConfig.create({
        data: {
          enabled: true,
          storageType: 'local',
          storagePath: this.backupDir,
          defaultRetentionDays: this.retentionDays,
        },
      });
    }
    return config;
  }
}

// Export singleton instance
export const backupService = new DatabaseBackupService();
