/**
 * Unified Notification Service
 * 
 * Production-ready notification system supporting multiple channels:
 * - Telegram
 * - In-App (WebSocket)
 * - Email (stub for future)
 * 
 * Features:
 * - Priority-based notifications
 * - Rate limiting to prevent spam
 * - User notification preferences
 * - Template-based messages
 */

import { db } from '@/lib/db';

// ==================== TYPES ====================

export type NotificationChannel = 'telegram' | 'in_app' | 'email';
export type NotificationPriority = 'critical' | 'high' | 'medium' | 'low';
export type NotificationType = 
  | 'order_placed'
  | 'order_filled'
  | 'order_cancelled'
  | 'order_rejected'
  | 'position_opened'
  | 'position_closed'
  | 'tp_hit'
  | 'sl_hit'
  | 'trailing_activated'
  | 'bot_started'
  | 'bot_stopped'
  | 'bot_error'
  | 'risk_alert'
  | 'daily_summary';

export interface NotificationPayload {
  type: NotificationType;
  priority: NotificationPriority;
  userId: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  channels?: NotificationChannel[];
  templateVars?: Record<string, unknown>;
}

export interface NotificationResult {
  success: boolean;
  notificationId?: string;
  channels: {
    channel: NotificationChannel;
    success: boolean;
    error?: string;
  }[];
}

export interface NotificationPreferences {
  userId: string;
  enabled: boolean;
  channels: {
    telegram: boolean;
    inApp: boolean;
    email: boolean;
  };
  priorities: {
    critical: boolean;
    high: boolean;
    medium: boolean;
    low: boolean;
  };
  types: Record<NotificationType, boolean>;
  quietHours?: {
    enabled: boolean;
    start: string; // HH:mm
    end: string; // HH:mm
    timezone: string;
  };
  rateLimit: {
    maxPerHour: number;
    maxPerDay: number;
  };
}

// ==================== RATE LIMITER ====================

class NotificationRateLimiter {
  private hourlyCounts: Map<string, number[]> = new Map();
  private dailyCounts: Map<string, number[]> = new Map();

  canSend(userId: string, maxPerHour: number, maxPerDay: number): boolean {
    const now = Date.now();
    const hourAgo = now - 3600000;
    const dayAgo = now - 86400000;

    // Check hourly limit
    const hourlyKey = `${userId}_hourly`;
    let hourlyTimestamps = this.hourlyCounts.get(hourlyKey) || [];
    hourlyTimestamps = hourlyTimestamps.filter(t => t > hourAgo);
    
    if (hourlyTimestamps.length >= maxPerHour) {
      return false;
    }

    // Check daily limit
    const dailyKey = `${userId}_daily`;
    let dailyTimestamps = this.dailyCounts.get(dailyKey) || [];
    dailyTimestamps = dailyTimestamps.filter(t => t > dayAgo);
    
    if (dailyTimestamps.length >= maxPerDay) {
      return false;
    }

    return true;
  }

  recordSent(userId: string): void {
    const now = Date.now();
    
    const hourlyKey = `${userId}_hourly`;
    let hourlyTimestamps = this.hourlyCounts.get(hourlyKey) || [];
    hourlyTimestamps.push(now);
    this.hourlyCounts.set(hourlyKey, hourlyTimestamps);

    const dailyKey = `${userId}_daily`;
    let dailyTimestamps = this.dailyCounts.get(dailyKey) || [];
    dailyTimestamps.push(now);
    this.dailyCounts.set(dailyKey, dailyTimestamps);
  }

  cleanup(): void {
    const now = Date.now();
    const hourAgo = now - 3600000;
    const dayAgo = now - 86400000;

    for (const [key, timestamps] of this.hourlyCounts.entries()) {
      const filtered = timestamps.filter(t => t > hourAgo);
      if (filtered.length === 0) {
        this.hourlyCounts.delete(key);
      } else {
        this.hourlyCounts.set(key, filtered);
      }
    }

    for (const [key, timestamps] of this.dailyCounts.entries()) {
      const filtered = timestamps.filter(t => t > dayAgo);
      if (filtered.length === 0) {
        this.dailyCounts.delete(key);
      } else {
        this.dailyCounts.set(key, filtered);
      }
    }
  }
}

// ==================== NOTIFICATION SERVICE ====================

class NotificationService {
  private rateLimiter = new NotificationRateLimiter();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Cleanup rate limiter every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.rateLimiter.cleanup();
    }, 300000);
  }

  /**
   * Send notification through configured channels
   */
  async send(payload: NotificationPayload): Promise<NotificationResult> {
    const { userId, type, priority, channels } = payload;
    
    // Get user preferences
    const preferences = await this.getUserPreferences(userId);
    
    // Check if notifications are enabled
    if (!preferences.enabled) {
      return {
        success: false,
        channels: [],
      };
    }

    // Check if this type is enabled
    if (!preferences.types[type]) {
      return {
        success: false,
        channels: [],
      };
    }

    // Check priority
    if (!preferences.priorities[priority]) {
      return {
        success: false,
        channels: [],
      };
    }

    // Check quiet hours
    if (this.isQuietHours(preferences) && priority !== 'critical') {
      return {
        success: false,
        channels: [],
      };
    }

    // Check rate limits
    if (!this.rateLimiter.canSend(
      userId,
      preferences.rateLimit.maxPerHour,
      preferences.rateLimit.maxPerDay
    )) {
      console.warn(`[Notifications] Rate limit exceeded for user ${userId}`);
      return {
        success: false,
        channels: [],
      };
    }

    // Determine channels
    const targetChannels = channels || this.getDefaultChannels(preferences);
    const results: NotificationResult['channels'] = [];

    // Create notification record
    const notification = await db.notification.create({
      data: {
        userId,
        type,
        priority,
        title: payload.title,
        message: payload.message,
        data: payload.data || {},
        channels: targetChannels,
        status: 'pending',
      },
    });

    // Send through each channel
    for (const channel of targetChannels) {
      if (!preferences.channels[channel === 'in_app' ? 'inApp' : channel]) {
        continue;
      }

      try {
        switch (channel) {
          case 'telegram':
            await this.sendTelegram(payload);
            results.push({ channel, success: true });
            break;
          case 'in_app':
            await this.sendInApp(payload);
            results.push({ channel, success: true });
            break;
          case 'email':
            // Stub for future implementation
            results.push({ channel, success: false, error: 'Email not implemented' });
            break;
        }
      } catch (error) {
        results.push({
          channel,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Record rate limit
    this.rateLimiter.recordSent(userId);

    // Update notification status
    const allSuccess = results.every(r => r.success);
    await db.notification.update({
      where: { id: notification.id },
      data: {
        status: allSuccess ? 'sent' : 'partial',
        sentAt: new Date(),
      },
    });

    return {
      success: allSuccess,
      notificationId: notification.id,
      channels: results,
    };
  }

  /**
   * Send notification via Telegram
   */
  private async sendTelegram(payload: NotificationPayload): Promise<void> {
    // Get user's Telegram ID
    const user = await db.user.findUnique({
      where: { id: payload.userId },
      select: { telegramId: true },
    });

    if (!user?.telegramId) {
      throw new Error('User has no Telegram ID');
    }

    // Format message with emoji based on type
    const emoji = this.getTypeEmoji(payload.type);
    const formattedMessage = `${emoji} *${payload.title}*\n\n${payload.message}`;

    // Send via Telegram service (we'll use fetch to our own endpoint)
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/telegram/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: user.telegramId,
        message: formattedMessage,
        parseMode: 'Markdown',
      }),
    });

    if (!response.ok) {
      throw new Error(`Telegram send failed: ${response.statusText}`);
    }
  }

  /**
   * Send notification via in-app WebSocket
   */
  private async sendInApp(payload: NotificationPayload): Promise<void> {
    // Emit to trade events service which handles in-app notifications
    const response = await fetch(`http://localhost:3003/?XTransformPort=3003`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'notification',
        data: {
          userId: payload.userId,
          type: payload.type,
          priority: payload.priority,
          title: payload.title,
          message: payload.message,
          data: payload.data,
          timestamp: new Date().toISOString(),
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`In-app notification failed: ${response.statusText}`);
    }
  }

  /**
   * Get user notification preferences
   */
  private async getUserPreferences(userId: string): Promise<NotificationPreferences> {
    try {
      const prefs = await db.notificationPreference.findUnique({
        where: { userId },
      });

      if (prefs) {
        return {
          userId: prefs.userId,
          enabled: prefs.enabled,
          channels: {
            telegram: prefs.telegramEnabled,
            inApp: prefs.inAppEnabled,
            email: prefs.emailEnabled,
          },
          priorities: {
            critical: prefs.notifyCritical,
            high: prefs.notifyHigh,
            medium: prefs.notifyMedium,
            low: prefs.notifyLow,
          },
          types: prefs.typesEnabled as Record<NotificationType, boolean>,
          quietHours: prefs.quietHoursEnabled ? {
            enabled: true,
            start: prefs.quietHoursStart || '22:00',
            end: prefs.quietHoursEnd || '08:00',
            timezone: prefs.quietHoursTimezone || 'UTC',
          } : undefined,
          rateLimit: {
            maxPerHour: prefs.maxPerHour,
            maxPerDay: prefs.maxPerDay,
          },
        };
      }
    } catch (error) {
      console.error('[Notifications] Error getting preferences:', error);
    }

    // Return default preferences
    return this.getDefaultPreferences(userId);
  }

  /**
   * Get default preferences
   */
  private getDefaultPreferences(userId: string): NotificationPreferences {
    return {
      userId,
      enabled: true,
      channels: {
        telegram: true,
        inApp: true,
        email: false,
      },
      priorities: {
        critical: true,
        high: true,
        medium: true,
        low: false,
      },
      types: {
        order_placed: true,
        order_filled: true,
        order_cancelled: true,
        order_rejected: true,
        position_opened: true,
        position_closed: true,
        tp_hit: true,
        sl_hit: true,
        trailing_activated: false,
        bot_started: false,
        bot_stopped: true,
        bot_error: true,
        risk_alert: true,
        daily_summary: false,
      },
      rateLimit: {
        maxPerHour: 20,
        maxPerDay: 100,
      },
    };
  }

  /**
   * Check if current time is within quiet hours
   */
  private isQuietHours(preferences: NotificationPreferences): boolean {
    if (!preferences.quietHours?.enabled) {
      return false;
    }

    const now = new Date();
    const currentTime = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: preferences.quietHours.timezone,
    });

    const { start, end } = preferences.quietHours;
    
    // Handle overnight quiet hours (e.g., 22:00 - 08:00)
    if (start > end) {
      return currentTime >= start || currentTime <= end;
    }
    
    return currentTime >= start && currentTime <= end;
  }

  /**
   * Get default channels based on priority
   */
  private getDefaultChannels(preferences: NotificationPreferences): NotificationChannel[] {
    const channels: NotificationChannel[] = [];
    
    if (preferences.channels.telegram) {
      channels.push('telegram');
    }
    if (preferences.channels.inApp) {
      channels.push('in_app');
    }
    
    return channels;
  }

  /**
   * Get emoji for notification type
   */
  private getTypeEmoji(type: NotificationType): string {
    const emojis: Record<NotificationType, string> = {
      order_placed: '📝',
      order_filled: '✅',
      order_cancelled: '❌',
      order_rejected: '⚠️',
      position_opened: '🟢',
      position_closed: '🔴',
      tp_hit: '🎯',
      sl_hit: '🛑',
      trailing_activated: '📈',
      bot_started: '🤖',
      bot_stopped: '⏹️',
      bot_error: '⚠️',
      risk_alert: '🚨',
      daily_summary: '📊',
    };
    return emojis[type] || '📢';
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

// ==================== SINGLETON EXPORT ====================

export const notificationService = new NotificationService();

// ==================== HELPER FUNCTIONS ====================

/**
 * Send trade notification
 */
export async function sendTradeNotification(
  userId: string,
  type: NotificationType,
  data: {
    symbol: string;
    direction?: 'LONG' | 'SHORT';
    price?: number;
    quantity?: number;
    pnl?: number;
    pnlPercent?: number;
    reason?: string;
  }
): Promise<NotificationResult> {
  const titles: Record<NotificationType, string> = {
    order_placed: 'Order Placed',
    order_filled: 'Order Filled',
    order_cancelled: 'Order Cancelled',
    order_rejected: 'Order Rejected',
    position_opened: 'Position Opened',
    position_closed: 'Position Closed',
    tp_hit: 'Take Profit Hit!',
    sl_hit: 'Stop Loss Hit',
    trailing_activated: 'Trailing Activated',
    bot_started: 'Bot Started',
    bot_stopped: 'Bot Stopped',
    bot_error: 'Bot Error',
    risk_alert: 'Risk Alert',
    daily_summary: 'Daily Summary',
  };

  const messages: Record<NotificationType, string> = {
    order_placed: `${data.direction || ''} ${data.symbol} @ ${data.price}`,
    order_filled: `${data.direction || ''} ${data.symbol} filled @ ${data.price}`,
    order_cancelled: `${data.symbol} order cancelled`,
    order_rejected: `${data.symbol} order rejected: ${data.reason || 'Unknown reason'}`,
    position_opened: `${data.direction || ''} ${data.symbol} @ ${data.price} (${data.quantity} qty)`,
    position_closed: `${data.symbol} closed @ ${data.price}\nPnL: ${data.pnl?.toFixed(2)} USDT (${data.pnlPercent?.toFixed(2)}%)`,
    tp_hit: `${data.symbol} TP hit!\nProfit: ${data.pnl?.toFixed(2)} USDT (${data.pnlPercent?.toFixed(2)}%)`,
    sl_hit: `${data.symbol} SL hit\nLoss: ${data.pnl?.toFixed(2)} USDT (${data.pnlPercent?.toFixed(2)}%)`,
    trailing_activated: `${data.symbol} trailing stop activated`,
    bot_started: `${data.symbol} bot started`,
    bot_stopped: `${data.symbol} bot stopped: ${data.reason || 'Manual'}`,
    bot_error: `${data.symbol} bot error: ${data.reason || 'Unknown'}`,
    risk_alert: `Risk alert for ${data.symbol}: ${data.reason}`,
    daily_summary: `Daily trading summary`,
  };

  const priorities: Record<NotificationType, NotificationPriority> = {
    order_placed: 'medium',
    order_filled: 'medium',
    order_cancelled: 'low',
    order_rejected: 'high',
    position_opened: 'medium',
    position_closed: 'medium',
    tp_hit: 'high',
    sl_hit: 'high',
    trailing_activated: 'low',
    bot_started: 'low',
    bot_stopped: 'medium',
    bot_error: 'high',
    risk_alert: 'critical',
    daily_summary: 'low',
  };

  return notificationService.send({
    type,
    priority: priorities[type],
    userId,
    title: titles[type],
    message: messages[type],
    data,
  });
}

/**
 * Send bot notification
 */
export async function sendBotNotification(
  userId: string,
  botName: string,
  event: 'started' | 'stopped' | 'error' | 'signal',
  details?: Record<string, unknown>
): Promise<NotificationResult> {
  const typeMap: Record<string, NotificationType> = {
    started: 'bot_started',
    stopped: 'bot_stopped',
    error: 'bot_error',
    signal: 'order_placed',
  };

  return sendTradeNotification(userId, typeMap[event], {
    symbol: (details?.symbol as string) || 'N/A',
    reason: (details?.reason as string) || (details?.error as string),
  });
}

// ==================== EXPORTS ====================

export default notificationService;
