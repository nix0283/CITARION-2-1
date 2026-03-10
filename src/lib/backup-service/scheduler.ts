/**
 * Backup Scheduler Service
 * Manages automated backup schedules with cron-like execution
 */

import { db } from '@/lib/db';
import { backupService } from './database-backup';
import type { BackupSchedule, CreateScheduleRequest, BackupFrequency } from './types';

/**
 * Calculate next run time based on schedule configuration
 */
export function calculateNextRunAt(schedule: {
  frequency: BackupFrequency;
  hour: number;
  minute: number;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
}): Date {
  const now = new Date();
  let next = new Date();
  
  // Set the time
  next.setHours(schedule.hour, schedule.minute, 0, 0);
  
  // If time has passed today, start from tomorrow
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  
  switch (schedule.frequency) {
    case 'hourly':
      // Run every hour at the specified minute
      next = new Date(now);
      next.setMinutes(schedule.minute, 0, 0);
      if (next <= now) {
        next.setHours(next.getHours() + 1);
      }
      break;
      
    case 'daily':
      // Run daily at the specified time
      next = new Date(now);
      next.setHours(schedule.hour, schedule.minute, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      break;
      
    case 'weekly':
      // Run on specified day of week
      if (schedule.dayOfWeek !== undefined && schedule.dayOfWeek !== null) {
        next = new Date(now);
        next.setHours(schedule.hour, schedule.minute, 0, 0);
        
        const currentDay = next.getDay();
        const daysUntil = (schedule.dayOfWeek - currentDay + 7) % 7;
        
        if (daysUntil === 0 && next <= now) {
          // Today is the day but time has passed
          next.setDate(next.getDate() + 7);
        } else {
          next.setDate(next.getDate() + daysUntil);
        }
      }
      break;
      
    case 'monthly':
      // Run on specified day of month
      if (schedule.dayOfMonth !== undefined && schedule.dayOfMonth !== null) {
        next = new Date(now);
        next.setDate(schedule.dayOfMonth);
        next.setHours(schedule.hour, schedule.minute, 0, 0);
        
        if (next <= now || next.getDate() !== schedule.dayOfMonth) {
          // Day has passed this month or day doesn't exist, go to next month
          next.setMonth(next.getMonth() + 1, schedule.dayOfMonth);
        }
      }
      break;
  }
  
  return next;
}

/**
 * Backup Scheduler Class
 * Manages schedule CRUD and execution
 */
export class BackupScheduler {
  /**
   * Create a new backup schedule
   */
  async createSchedule(data: CreateScheduleRequest): Promise<BackupSchedule> {
    const schedule = await db.backupSchedule.create({
      data: {
        name: data.name,
        description: data.description,
        isActive: true,
        frequency: data.frequency,
        hour: data.hour ?? 2,
        minute: data.minute ?? 0,
        dayOfWeek: data.dayOfWeek,
        dayOfMonth: data.dayOfMonth,
        type: data.type ?? 'full',
        scope: data.scope ?? 'database',
        retentionDays: data.retentionDays ?? 30,
        compress: data.compress ?? true,
        encrypt: data.encrypt ?? true,
        notifyOnSuccess: data.notifyOnSuccess ?? true,
        notifyOnFailure: data.notifyOnFailure ?? true,
        notifyChannels: JSON.stringify(data.notifyChannels ?? []),
        nextRunAt: null, // Will be calculated below
      },
    });

    // Calculate next run time
    const nextRunAt = calculateNextRunAt(schedule);
    await db.backupSchedule.update({
      where: { id: schedule.id },
      data: { nextRunAt },
    });

    return {
      ...schedule,
      notifyChannels: JSON.parse(schedule.notifyChannels || '[]'),
      nextRunAt,
    } as BackupSchedule;
  }

  /**
   * Update a backup schedule
   */
  async updateSchedule(id: string, data: Partial<CreateScheduleRequest & { isActive: boolean }>): Promise<BackupSchedule | null> {
    const updateData: Record<string, unknown> = {};
    
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.frequency !== undefined) updateData.frequency = data.frequency;
    if (data.hour !== undefined) updateData.hour = data.hour;
    if (data.minute !== undefined) updateData.minute = data.minute;
    if (data.dayOfWeek !== undefined) updateData.dayOfWeek = data.dayOfWeek;
    if (data.dayOfMonth !== undefined) updateData.dayOfMonth = data.dayOfMonth;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.scope !== undefined) updateData.scope = data.scope;
    if (data.retentionDays !== undefined) updateData.retentionDays = data.retentionDays;
    if (data.compress !== undefined) updateData.compress = data.compress;
    if (data.encrypt !== undefined) updateData.encrypt = data.encrypt;
    if (data.notifyOnSuccess !== undefined) updateData.notifyOnSuccess = data.notifyOnSuccess;
    if (data.notifyOnFailure !== undefined) updateData.notifyOnFailure = data.notifyOnFailure;
    if (data.notifyChannels !== undefined) updateData.notifyChannels = JSON.stringify(data.notifyChannels);

    const schedule = await db.backupSchedule.update({
      where: { id },
      data: updateData,
    });

    // Recalculate next run time if schedule changed
    if (Object.keys(updateData).some(k => ['frequency', 'hour', 'minute', 'dayOfWeek', 'dayOfMonth', 'isActive'].includes(k))) {
      const nextRunAt = schedule.isActive ? calculateNextRunAt(schedule) : null;
      await db.backupSchedule.update({
        where: { id: schedule.id },
        data: { nextRunAt },
      });
    }

    return {
      ...schedule,
      notifyChannels: JSON.parse(schedule.notifyChannels || '[]'),
    } as BackupSchedule;
  }

  /**
   * Delete a backup schedule
   */
  async deleteSchedule(id: string): Promise<boolean> {
    try {
      await db.backupSchedule.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get all schedules
   */
  async getSchedules(includeInactive: boolean = false): Promise<BackupSchedule[]> {
    const schedules = await db.backupSchedule.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });

    return schedules.map(s => ({
      ...s,
      notifyChannels: JSON.parse(s.notifyChannels || '[]'),
    })) as BackupSchedule[];
  }

  /**
   * Get schedule by ID
   */
  async getSchedule(id: string): Promise<BackupSchedule | null> {
    const schedule = await db.backupSchedule.findUnique({ where: { id } });
    if (!schedule) return null;
    
    return {
      ...schedule,
      notifyChannels: JSON.parse(schedule.notifyChannels || '[]'),
    } as BackupSchedule;
  }

  /**
   * Execute due schedules
   * Should be called periodically (e.g., every minute) by a cron job or timer
   */
  async executeDueSchedules(): Promise<{ executed: number; results: Array<{ scheduleId: string; success: boolean; error?: string }> }> {
    const now = new Date();
    const results: Array<{ scheduleId: string; success: boolean; error?: string }> = [];
    
    // Find schedules that are due
    const dueSchedules = await db.backupSchedule.findMany({
      where: {
        isActive: true,
        nextRunAt: { lte: now },
      },
    });

    for (const schedule of dueSchedules) {
      try {
        // Create backup record
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `${schedule.name}-${timestamp}`;
        
        const backupRecord = await db.backupRecord.create({
          data: {
            name: backupName,
            description: `Scheduled backup: ${schedule.name}`,
            type: schedule.type,
            status: 'running',
            fileName: '', // Will be updated after backup
            scope: schedule.scope,
            retentionDays: schedule.retentionDays,
            compressed: schedule.compress,
            encrypted: schedule.encrypt,
            triggeredBy: 'scheduled',
            scheduledAt: now,
            startedAt: now,
          },
        });

        // Execute backup
        const result = await backupService.createBackup({
          id: backupRecord.id,
          name: backupName,
          type: schedule.type as any,
          scope: schedule.scope as any,
          retentionDays: schedule.retentionDays,
          compress: schedule.compress,
          encrypt: schedule.encrypt,
        });

        // Update schedule stats
        await db.backupSchedule.update({
          where: { id: schedule.id },
          data: {
            lastRunAt: now,
            lastRunStatus: result.success ? 'completed' : 'failed',
            totalRuns: { increment: 1 },
            ...(result.success 
              ? { successCount: { increment: 1 } }
              : { failureCount: { increment: 1 } }
            ),
            nextRunAt: calculateNextRunAt(schedule),
          },
        });

        results.push({ scheduleId: schedule.id, success: result.success, error: result.error });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({ scheduleId: schedule.id, success: false, error: errorMessage });
      }
    }

    return { executed: dueSchedules.length, results };
  }

  /**
   * Manually trigger a schedule
   */
  async triggerSchedule(id: string): Promise<{ success: boolean; backupId?: string; error?: string }> {
    const schedule = await db.backupSchedule.findUnique({ where: { id } });
    if (!schedule) {
      return { success: false, error: 'Schedule not found' };
    }

    if (!schedule.isActive) {
      return { success: false, error: 'Schedule is not active' };
    }

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupName = `${schedule.name}-manual-${timestamp}`;
      
      const backupRecord = await db.backupRecord.create({
        data: {
          name: backupName,
          description: `Manual trigger of: ${schedule.name}`,
          type: schedule.type,
          status: 'running',
          fileName: '',
          scope: schedule.scope,
          retentionDays: schedule.retentionDays,
          compressed: schedule.compress,
          encrypted: schedule.encrypt,
          triggeredBy: 'manual',
          startedAt: new Date(),
        },
      });

      const result = await backupService.createBackup({
        id: backupRecord.id,
        name: backupName,
        type: schedule.type as any,
        scope: schedule.scope as any,
        retentionDays: schedule.retentionDays,
        compress: schedule.compress,
        encrypt: schedule.encrypt,
      });

      // Update schedule stats
      await db.backupSchedule.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: result.success ? 'completed' : 'failed',
          totalRuns: { increment: 1 },
          ...(result.success 
            ? { successCount: { increment: 1 } }
            : { failureCount: { increment: 1 } }
          ),
        },
      });

      return {
        success: result.success,
        backupId: backupRecord.id,
        error: result.error,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  }
}

// Export singleton instance
export const backupScheduler = new BackupScheduler();
