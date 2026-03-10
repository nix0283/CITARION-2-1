/**
 * Backup API Route - CRUD Operations
 * Production-ready backup management with scheduling and restore
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
import { backupService } from '@/lib/backup-service';
import type { BackupStatus, BackupType, BackupScope } from '@/lib/backup-service/types';

// ============================================
// Validation Schemas
// ============================================

const QuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']).optional(),
  type: z.enum(['full', 'incremental', 'differential']).optional(),
  scope: z.enum(['database', 'config', 'logs', 'all']).optional(),
  search: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sortBy: z.enum(['createdAt', 'fileSize', 'completedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

const CreateBackupSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  type: z.enum(['full', 'incremental', 'differential']).default('full'),
  scope: z.enum(['database', 'config', 'logs', 'all']).default('database'),
  tables: z.array(z.string()).optional(),
  retentionDays: z.number().min(1).max(365).default(30),
  compress: z.boolean().default(true),
  encrypt: z.boolean().default(true),
});

// ============================================
// GET - List Backups
// ============================================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = QuerySchema.parse(Object.fromEntries(searchParams.entries()));

    // Build where clause
    const where: Record<string, unknown> = {};

    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.scope) where.scope = query.scope;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search } },
        { description: { contains: query.search } },
      ];
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) (where.createdAt as Record<string, unknown>).gte = new Date(query.startDate);
      if (query.endDate) (where.createdAt as Record<string, unknown>).lte = new Date(query.endDate);
    }

    // Execute queries in parallel
    const [records, total, stats] = await Promise.all([
      db.backupRecord.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { [query.sortBy]: query.sortOrder },
      }),
      db.backupRecord.count({ where }),
      getBackupStats(),
    ]);

    // Parse JSON fields
    const data = records.map(record => ({
      ...record,
      tables: JSON.parse(record.tables || '[]'),
      metadata: JSON.parse(record.metadata || '{}'),
    }));

    const totalPages = Math.ceil(total / query.limit);

    return NextResponse.json({
      success: true,
      data,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPrevPage: query.page > 1,
      },
      stats,
    });
  } catch (error) {
    console.error('[Backup API] GET error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, errors: error.errors }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// POST - Create Backup
// ============================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = CreateBackupSchema.parse(body);

    // Generate backup name if not provided
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = data.name || `backup-${timestamp}`;

    // Create backup record
    const record = await db.backupRecord.create({
      data: {
        name,
        description: data.description,
        type: data.type,
        status: 'pending',
        fileName: '', // Will be updated after backup
        scope: data.scope,
        tables: JSON.stringify(data.tables || []),
        retentionDays: data.retentionDays,
        compressed: data.compress,
        encrypted: data.encrypt,
        triggeredBy: 'manual',
      },
    });

    // Execute backup asynchronously (don't wait)
    backupService.createBackup({
      id: record.id,
      name,
      description: data.description,
      type: data.type,
      scope: data.scope,
      tables: data.tables,
      retentionDays: data.retentionDays,
      compress: data.compress,
      encrypt: data.encrypt,
    }).then(result => {
      console.log('[Backup] Backup completed:', result);
    }).catch(error => {
      console.error('[Backup] Backup failed:', error);
    });

    return NextResponse.json({
      success: true,
      data: {
        ...record,
        tables: data.tables || [],
      },
      message: 'Backup started successfully',
    }, { status: 201 });
  } catch (error) {
    console.error('[Backup API] POST error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, errors: error.errors }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// DELETE - Delete Backup
// ============================================

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Backup ID is required' },
        { status: 400 }
      );
    }

    const backup = await db.backupRecord.findUnique({ where: { id } });
    if (!backup) {
      return NextResponse.json(
        { success: false, error: 'Backup not found' },
        { status: 404 }
      );
    }

    // Delete file if exists
    if (backup.filePath) {
      try {
        const fs = await import('fs/promises');
        await fs.unlink(backup.filePath);
      } catch {
        // File might not exist, ignore
      }
    }

    // Delete record
    await db.backupRecord.delete({ where: { id } });

    return NextResponse.json({
      success: true,
      message: 'Backup deleted successfully',
    });
  } catch (error) {
    console.error('[Backup API] DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// Helper Functions
// ============================================

async function getBackupStats() {
  const [total, successful, failed, sizeStats, lastBackup, lastSuccessful, upcomingSchedule] = await Promise.all([
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
    db.backupSchedule.findFirst({
      where: { isActive: true, nextRunAt: { gte: new Date() } },
      orderBy: { nextRunAt: 'asc' },
      select: { nextRunAt: true },
    }),
  ]);

  return {
    totalBackups: total,
    totalSize: sizeStats._sum.fileSize || 0,
    successfulBackups: successful,
    failedBackups: failed,
    lastBackup: lastBackup?.createdAt,
    lastSuccessful: lastSuccessful?.completedAt,
    avgBackupSize: sizeStats._avg.fileSize || 0,
    avgDuration: 0,
    upcomingScheduled: upcomingSchedule?.nextRunAt,
  };
}
