/**
 * Backup Schedules API Route
 * Manage automated backup schedules
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
import { backupScheduler } from '@/lib/backup-service';

// ============================================
// Helper Functions
// ============================================

type BackupFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly';

function calculateNextRunAt(schedule: {
  frequency: BackupFrequency;
  hour: number;
  minute: number;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
}): Date {
  const now = new Date();
  let next = new Date();

  next.setHours(schedule.hour, schedule.minute, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  switch (schedule.frequency) {
    case 'hourly':
      next = new Date(now);
      next.setMinutes(schedule.minute, 0, 0);
      if (next <= now) {
        next.setHours(next.getHours() + 1);
      }
      break;

    case 'daily':
      next = new Date(now);
      next.setHours(schedule.hour, schedule.minute, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      break;

    case 'weekly':
      if (schedule.dayOfWeek !== undefined && schedule.dayOfWeek !== null) {
        next = new Date(now);
        next.setHours(schedule.hour, schedule.minute, 0, 0);

        const currentDay = next.getDay();
        const daysUntil = (schedule.dayOfWeek - currentDay + 7) % 7;

        if (daysUntil === 0 && next <= now) {
          next.setDate(next.getDate() + 7);
        } else {
          next.setDate(next.getDate() + daysUntil);
        }
      }
      break;

    case 'monthly':
      if (schedule.dayOfMonth !== undefined && schedule.dayOfMonth !== null) {
        next = new Date(now);
        next.setDate(schedule.dayOfMonth);
        next.setHours(schedule.hour, schedule.minute, 0, 0);

        if (next <= now || next.getDate() !== schedule.dayOfMonth) {
          next.setMonth(next.getMonth() + 1, schedule.dayOfMonth);
        }
      }
      break;
  }

  return next;
}

// ============================================
// Validation Schemas
// ============================================

const CreateScheduleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  frequency: z.enum(['hourly', 'daily', 'weekly', 'monthly']),
  hour: z.number().min(0).max(23).default(2),
  minute: z.number().min(0).max(59).default(0),
  dayOfWeek: z.number().min(0).max(6).optional(), // 0 = Sunday
  dayOfMonth: z.number().min(1).max(31).optional(),
  type: z.enum(['full', 'incremental', 'differential']).default('full'),
  scope: z.enum(['database', 'config', 'logs', 'all']).default('database'),
  retentionDays: z.number().min(1).max(365).default(30),
  compress: z.boolean().default(true),
  encrypt: z.boolean().default(true),
  notifyOnSuccess: z.boolean().default(true),
  notifyOnFailure: z.boolean().default(true),
  notifyChannels: z.array(z.string()).default([]),
});

const UpdateScheduleSchema = CreateScheduleSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ============================================
// GET - List Schedules
// ============================================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const includeInactive = searchParams.get('includeInactive') === 'true';

    const schedules = await db.backupSchedule.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });

    // Parse JSON fields
    const data = schedules.map(schedule => ({
      ...schedule,
      notifyChannels: JSON.parse(schedule.notifyChannels || '[]'),
    }));

    // Calculate stats
    const stats = {
      total: schedules.length,
      active: schedules.filter(s => s.isActive).length,
      inactive: schedules.filter(s => !s.isActive).length,
      totalRuns: schedules.reduce((sum, s) => sum + s.totalRuns, 0),
      successRate: schedules.reduce((sum, s) => sum + s.totalRuns, 0) > 0
        ? (schedules.reduce((sum, s) => sum + s.successCount, 0) / schedules.reduce((sum, s) => sum + s.totalRuns, 0)) * 100
        : 0,
    };

    return NextResponse.json({
      success: true,
      data,
      stats,
    });
  } catch (error) {
    console.error('[Schedules API] GET error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// POST - Create Schedule
// ============================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = CreateScheduleSchema.parse(body);

    // Validate dayOfWeek for weekly frequency
    if (data.frequency === 'weekly' && data.dayOfWeek === undefined) {
      return NextResponse.json(
        { success: false, error: 'dayOfWeek is required for weekly frequency' },
        { status: 400 }
      );
    }

    // Validate dayOfMonth for monthly frequency
    if (data.frequency === 'monthly' && data.dayOfMonth === undefined) {
      return NextResponse.json(
        { success: false, error: 'dayOfMonth is required for monthly frequency' },
        { status: 400 }
      );
    }

    // Create schedule
    const schedule = await db.backupSchedule.create({
      data: {
        name: data.name,
        description: data.description,
        isActive: true,
        frequency: data.frequency,
        hour: data.hour,
        minute: data.minute,
        dayOfWeek: data.dayOfWeek,
        dayOfMonth: data.dayOfMonth,
        type: data.type,
        scope: data.scope,
        retentionDays: data.retentionDays,
        compress: data.compress,
        encrypt: data.encrypt,
        notifyOnSuccess: data.notifyOnSuccess,
        notifyOnFailure: data.notifyOnFailure,
        notifyChannels: JSON.stringify(data.notifyChannels),
        nextRunAt: calculateNextRunAt({
          frequency: data.frequency,
          hour: data.hour,
          minute: data.minute,
          dayOfWeek: data.dayOfWeek,
          dayOfMonth: data.dayOfMonth,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        ...schedule,
        notifyChannels: data.notifyChannels,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('[Schedules API] POST error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, errors: error.errors }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// PUT - Update Schedule
// ============================================

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...data } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Schedule ID is required' },
        { status: 400 }
      );
    }

    const updateData = UpdateScheduleSchema.parse(data);
    const updateFields: Record<string, unknown> = {};

    if (updateData.name !== undefined) updateFields.name = updateData.name;
    if (updateData.description !== undefined) updateFields.description = updateData.description;
    if (updateData.isActive !== undefined) updateFields.isActive = updateData.isActive;
    if (updateData.frequency !== undefined) updateFields.frequency = updateData.frequency;
    if (updateData.hour !== undefined) updateFields.hour = updateData.hour;
    if (updateData.minute !== undefined) updateFields.minute = updateData.minute;
    if (updateData.dayOfWeek !== undefined) updateFields.dayOfWeek = updateData.dayOfWeek;
    if (updateData.dayOfMonth !== undefined) updateFields.dayOfMonth = updateData.dayOfMonth;
    if (updateData.type !== undefined) updateFields.type = updateData.type;
    if (updateData.scope !== undefined) updateFields.scope = updateData.scope;
    if (updateData.retentionDays !== undefined) updateFields.retentionDays = updateData.retentionDays;
    if (updateData.compress !== undefined) updateFields.compress = updateData.compress;
    if (updateData.encrypt !== undefined) updateFields.encrypt = updateData.encrypt;
    if (updateData.notifyOnSuccess !== undefined) updateFields.notifyOnSuccess = updateData.notifyOnSuccess;
    if (updateData.notifyOnFailure !== undefined) updateFields.notifyOnFailure = updateData.notifyOnFailure;
    if (updateData.notifyChannels !== undefined) updateFields.notifyChannels = JSON.stringify(updateData.notifyChannels);

    // Get current schedule to recalculate next run
    const current = await db.backupSchedule.findUnique({ where: { id } });
    if (!current) {
      return NextResponse.json(
        { success: false, error: 'Schedule not found' },
        { status: 404 }
      );
    }

    // Recalculate next run if timing changed
    const timingChanged = ['frequency', 'hour', 'minute', 'dayOfWeek', 'dayOfMonth', 'isActive']
      .some(field => updateFields[field] !== undefined);

    if (timingChanged) {
      const newIsActive = updateFields.isActive ?? current.isActive;
      if (newIsActive) {
        updateFields.nextRunAt = calculateNextRunAt({
          frequency: (updateFields.frequency as any) ?? current.frequency,
          hour: (updateFields.hour as number) ?? current.hour,
          minute: (updateFields.minute as number) ?? current.minute,
          dayOfWeek: updateFields.dayOfWeek !== undefined ? updateFields.dayOfWeek : current.dayOfWeek,
          dayOfMonth: updateFields.dayOfMonth !== undefined ? updateFields.dayOfMonth : current.dayOfMonth,
        });
      } else {
        updateFields.nextRunAt = null;
      }
    }

    const schedule = await db.backupSchedule.update({
      where: { id },
      data: updateFields,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...schedule,
        notifyChannels: JSON.parse(schedule.notifyChannels || '[]'),
      },
    });
  } catch (error) {
    console.error('[Schedules API] PUT error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, errors: error.errors }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// DELETE - Delete Schedule
// ============================================

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Schedule ID is required' },
        { status: 400 }
      );
    }

    await db.backupSchedule.delete({ where: { id } });

    return NextResponse.json({
      success: true,
      message: 'Schedule deleted successfully',
    });
  } catch (error) {
    console.error('[Schedules API] DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// PATCH - Trigger Schedule
// ============================================

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, action } = body;

    if (!id || !action) {
      return NextResponse.json(
        { success: false, error: 'Schedule ID and action are required' },
        { status: 400 }
      );
    }

    if (action === 'trigger') {
      const result = await backupScheduler.triggerSchedule(id);
      return NextResponse.json(result);
    }

    if (action === 'toggle') {
      const current = await db.backupSchedule.findUnique({ where: { id } });
      if (!current) {
        return NextResponse.json(
          { success: false, error: 'Schedule not found' },
          { status: 404 }
        );
      }

      const schedule = await db.backupSchedule.update({
        where: { id },
        data: {
          isActive: !current.isActive,
          nextRunAt: !current.isActive ? calculateNextRunAt(current) : null,
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          ...schedule,
          notifyChannels: JSON.parse(schedule.notifyChannels || '[]'),
        },
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[Schedules API] PATCH error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
