/**
 * Backup Service Types
 * Production-ready types for backup management
 */

export type BackupType = 'full' | 'incremental' | 'differential';
export type BackupStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type BackupScope = 'database' | 'config' | 'logs' | 'all';
export type BackupFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly';

export interface BackupRecord {
  id: string;
  name: string;
  description?: string;
  type: BackupType;
  status: BackupStatus;
  fileName: string;
  filePath?: string;
  fileSize: number;
  checksum?: string;
  compressed: boolean;
  encrypted: boolean;
  scope: BackupScope;
  tables: string[];
  scheduledAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  errorMessage?: string;
  warningCount: number;
  recordCount: number;
  expiresAt?: Date;
  retentionDays: number;
  triggeredBy: 'manual' | 'scheduled' | 'api';
  triggeredById?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface BackupSchedule {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  frequency: BackupFrequency;
  cronExpression?: string;
  hour: number;
  minute: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
  type: BackupType;
  scope: BackupScope;
  retentionDays: number;
  compress: boolean;
  encrypt: boolean;
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  notifyChannels: string[];
  lastRunAt?: Date;
  lastRunStatus?: BackupStatus;
  nextRunAt?: Date;
  totalRuns: number;
  successCount: number;
  failureCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BackupConfig {
  id: string;
  enabled: boolean;
  storageType: 'local' | 's3' | 'gcs' | 'azure';
  storagePath: string;
  cloudConfig?: CloudStorageConfig;
  defaultRetentionDays: number;
  maxBackups: number;
  minFreeSpace: number;
  encryptionEnabled: boolean;
  encryptionKey?: string;
  compressionEnabled: boolean;
  compressionLevel: number;
  maxConcurrentBackups: number;
  backupTimeout: number;
  notificationEmail?: string;
  notificationTelegram?: string;
  totalBackups: number;
  totalSizeBytes: number;
  lastBackupAt?: Date;
  lastSuccessfulAt?: Date;
}

export interface CloudStorageConfig {
  provider: 's3' | 'gcs' | 'azure';
  bucket?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string;
}

export interface RestoreRecord {
  id: string;
  backupId?: string;
  backupName: string;
  status: BackupStatus;
  restoreMode: 'replace' | 'merge' | 'new_database';
  targetScope: BackupScope;
  targetTables: string[];
  startedAt?: Date;
  completedAt?: Date;
  progress: number;
  recordsRestored: number;
  tablesRestored: number;
  errorMessage?: string;
  triggeredBy: 'manual' | 'scheduled' | 'api';
  triggeredById?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BackupResult {
  success: boolean;
  backupId?: string;
  fileName?: string;
  filePath?: string;
  fileSize?: number;
  checksum?: string;
  recordCount?: number;
  duration?: number;
  error?: string;
  warnings?: string[];
}

export interface RestoreResult {
  success: boolean;
  recordsRestored?: number;
  tablesRestored?: number;
  duration?: number;
  error?: string;
}

export interface BackupListResponse {
  success: boolean;
  data: BackupRecord[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
  };
  stats: BackupStats;
}

export interface BackupStats {
  totalBackups: number;
  totalSize: number;
  successfulBackups: number;
  failedBackups: number;
  lastBackup?: Date;
  lastSuccessful?: Date;
  avgBackupSize: number;
  avgDuration: number;
  upcomingScheduled?: Date;
}

export interface BackupFilter {
  status?: BackupStatus;
  type?: BackupType;
  scope?: BackupScope;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'fileSize' | 'completedAt';
  sortOrder?: 'asc' | 'desc';
}

export interface CreateBackupRequest {
  name?: string;
  description?: string;
  type?: BackupType;
  scope?: BackupScope;
  tables?: string[];
  retentionDays?: number;
  compress?: boolean;
  encrypt?: boolean;
}

export interface CreateScheduleRequest {
  name: string;
  description?: string;
  frequency: BackupFrequency;
  hour?: number;
  minute?: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
  type?: BackupType;
  scope?: BackupScope;
  retentionDays?: number;
  compress?: boolean;
  encrypt?: boolean;
  notifyOnSuccess?: boolean;
  notifyOnFailure?: boolean;
  notifyChannels?: string[];
}

export interface RestoreRequest {
  backupId: string;
  restoreMode?: 'replace' | 'merge' | 'new_database';
  targetTables?: string[];
}
