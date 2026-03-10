/**
 * News Sources API - Manage news sources
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';

// ============================================
// Validation Schemas
// ============================================

const CreateSourceSchema = z.object({
  name: z.string().min(1).max(50),
  displayName: z.string().min(1).max(100),
  url: z.string().url(),
  rssUrl: z.string().url().optional(),
  apiUrl: z.string().url().optional(),
  enabled: z.boolean().default(true),
  fetchInterval: z.number().min(5).max(1440).default(30),
  rateLimit: z.number().min(1).max(1000).default(60),
  priority: z.number().min(1).max(10).default(5),
});

const UpdateSourceSchema = CreateSourceSchema.partial();

// ============================================
// GET - List News Sources
// ============================================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const enabled = searchParams.get('enabled');

    const where: Record<string, unknown> = {};
    if (enabled !== null) {
      where.enabled = enabled === 'true';
    }

    const sources = await db.newsSource.findMany({
      where,
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    });

    const stats = {
      total: sources.length,
      active: sources.filter(s => s.enabled && s.status === 'active').length,
      paused: sources.filter(s => !s.enabled).length,
      error: sources.filter(s => s.status === 'error').length,
    };

    return NextResponse.json({
      success: true,
      data: sources,
      stats,
    });
  } catch (error) {
    console.error('[News Sources API] GET error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// POST - Create News Source
// ============================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = CreateSourceSchema.parse(body);

    // Check if source already exists
    const existing = await db.newsSource.findUnique({
      where: { name: data.name },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Source with this name already exists' },
        { status: 400 }
      );
    }

    const source = await db.newsSource.create({
      data: {
        name: data.name,
        displayName: data.displayName,
        url: data.url,
        rssUrl: data.rssUrl,
        apiUrl: data.apiUrl,
        enabled: data.enabled,
        fetchInterval: data.fetchInterval,
        rateLimit: data.rateLimit,
        priority: data.priority,
        status: 'active',
      },
    });

    return NextResponse.json({ success: true, data: source }, { status: 201 });
  } catch (error) {
    console.error('[News Sources API] POST error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, errors: error.errors }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// PUT - Update News Source
// ============================================

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...data } = body;
    
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Source ID is required' },
        { status: 400 }
      );
    }

    const updateData = UpdateSourceSchema.parse(data);

    const source = await db.newsSource.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ success: true, data: source });
  } catch (error) {
    console.error('[News Sources API] PUT error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, errors: error.errors }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// DELETE - Remove News Source
// ============================================

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Source ID is required' },
        { status: 400 }
      );
    }

    await db.newsSource.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, message: 'Source deleted' });
  } catch (error) {
    console.error('[News Sources API] DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
