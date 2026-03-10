/**
 * Backup Restore API Route
 * Handle database restoration from backups
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
import { backupService } from '@/lib/backup-service';
import type { RestoreRequest } from '@/lib/backup-service/types';

// ============================================
// Validation Schemas
// ============================================

const RestoreSchema = z.object({
  backupId: z.string().min(1),
  restoreMode: z.enum(['replace', 'merge', 'new_database']).default('replace'),
  targetTables: z.array(z.string()).default([]),
});

// ============================================
// GET - List Restore Records
// ============================================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status');

    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const [records, total] = await Promise.all([
      db.restoreRecord.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      db.restoreRecord.count({ where }),
    ]);

    // Parse JSON fields
    const data = records.map(record => ({
      ...record,
      targetTables: JSON.parse(record.targetTables || '[]'),
    }));

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      success: true,
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
      },
    });
  } catch (error) {
    console.error('[Restore API] GET error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// POST - Execute Restore
// ============================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = RestoreSchema.parse(body);

    // Get backup record
    const backup = await db.backupRecord.findUnique({
      where: { id: data.backupId },
    });

    if (!backup) {
      return NextResponse.json(
        { success: false, error: 'Backup not found' },
        { status: 404 }
      );
    }

    if (backup.status !== 'completed') {
      return NextResponse.json(
        { success: false, error: 'Backup is not in completed status' },
        { status: 400 }
      );
    }

    if (!backup.filePath) {
      return NextResponse.json(
        { success: false, error: 'Backup file not found' },
        { status: 400 }
      );
    }

    // Create restore record
    const restoreRecord = await db.restoreRecord.create({
      data: {
        backupId: backup.id,
        backupName: backup.name,
        status: 'pending',
        restoreMode: data.restoreMode,
        targetScope: backup.scope,
        targetTables: JSON.stringify(data.targetTables),
        triggeredBy: 'manual',
      },
    });

    // Execute restore asynchronously
    backupService.restoreBackup({
      backupId: data.backupId,
      restoreMode: data.restoreMode,
      targetTables: data.targetTables,
    }).then(result => {
      console.log('[Restore] Restore completed:', result);
    }).catch(error => {
      console.error('[Restore] Restore failed:', error);
    });

    return NextResponse.json({
      success: true,
      data: {
        ...restoreRecord,
        targetTables: data.targetTables,
      },
      message: 'Restore operation started',
    }, { status: 201 });
  } catch (error) {
    console.error('[Restore API] POST error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, errors: error.errors }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// DELETE - Cancel Restore
// ============================================

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Restore ID is required' },
        { status: 400 }
      );
    }

    const restore = await db.restoreRecord.findUnique({ where: { id } });
    if (!restore) {
      return NextResponse.json(
        { success: false, error: 'Restore not found' },
        { status: 404 }
      );
    }

    if (restore.status === 'running') {
      // Mark as cancelled
      await db.restoreRecord.update({
        where: { id },
        data: { status: 'cancelled', completedAt: new Date() },
      });

      return NextResponse.json({
        success: true,
        message: 'Restore cancelled',
      });
    }

    // Delete the record if not running
    await db.restoreRecord.delete({ where: { id } });

    return NextResponse.json({
      success: true,
      message: 'Restore record deleted',
    });
  } catch (error) {
    console.error('[Restore API] DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
