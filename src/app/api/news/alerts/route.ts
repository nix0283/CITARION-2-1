/**
 * News Alerts API - Manage user news alerts
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';

// ============================================
// Validation Schemas
// ============================================

const CreateAlertSchema = z.object({
  name: z.string().min(1).max(100),
  keywords: z.array(z.string()).min(1).max(20),
  symbols: z.array(z.string()).default([]),
  sources: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  sentiment: z.enum(['bullish', 'bearish', 'neutral', 'any']).optional(),
  minImportance: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  notifyVia: z.enum(['app', 'email', 'telegram']).default('app'),
  isActive: z.boolean().default(true),
});

const UpdateAlertSchema = CreateAlertSchema.partial();

// Demo user ID (replace with actual auth)
const DEMO_USER_ID = 'demo-user';

// ============================================
// GET - List News Alerts
// ============================================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const isActive = searchParams.get('isActive');

    const where: Record<string, unknown> = { userId: DEMO_USER_ID };
    if (isActive !== null) {
      where.isActive = isActive === 'true';
    }

    const alerts = await db.newsAlert.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
    });

    // Parse JSON fields
    const parsedAlerts = alerts.map(alert => ({
      ...alert,
      keywords: JSON.parse(alert.keywords || '[]'),
      symbols: JSON.parse(alert.symbols || '[]'),
      sources: JSON.parse(alert.sources || '[]'),
      categories: JSON.parse(alert.categories || '[]'),
    }));

    return NextResponse.json({
      success: true,
      data: parsedAlerts,
      stats: {
        total: alerts.length,
        active: alerts.filter(a => a.isActive).length,
      },
    });
  } catch (error) {
    console.error('[News Alerts API] GET error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// POST - Create News Alert
// ============================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = CreateAlertSchema.parse(body);

    const alert = await db.newsAlert.create({
      data: {
        userId: DEMO_USER_ID,
        name: data.name,
        keywords: JSON.stringify(data.keywords),
        symbols: JSON.stringify(data.symbols),
        sources: JSON.stringify(data.sources),
        categories: JSON.stringify(data.categories),
        sentiment: data.sentiment || null,
        minImportance: data.minImportance,
        notifyVia: data.notifyVia,
        isActive: data.isActive,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        ...alert,
        keywords: data.keywords,
        symbols: data.symbols,
        sources: data.sources,
        categories: data.categories,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('[News Alerts API] POST error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, errors: error.errors }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// PUT - Update News Alert
// ============================================

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...data } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Alert ID is required' },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    
    if (data.name) updateData.name = data.name;
    if (data.keywords) updateData.keywords = JSON.stringify(data.keywords);
    if (data.symbols) updateData.symbols = JSON.stringify(data.symbols);
    if (data.sources) updateData.sources = JSON.stringify(data.sources);
    if (data.categories) updateData.categories = JSON.stringify(data.categories);
    if (data.sentiment !== undefined) updateData.sentiment = data.sentiment;
    if (data.minImportance) updateData.minImportance = data.minImportance;
    if (data.notifyVia) updateData.notifyVia = data.notifyVia;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    const alert = await db.newsAlert.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ success: true, data: alert });
  } catch (error) {
    console.error('[News Alerts API] PUT error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// DELETE - Remove News Alert
// ============================================

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Alert ID is required' },
        { status: 400 }
      );
    }

    await db.newsAlert.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, message: 'Alert deleted' });
  } catch (error) {
    console.error('[News Alerts API] DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
