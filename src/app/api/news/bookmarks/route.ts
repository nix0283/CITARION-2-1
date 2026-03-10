/**
 * News Bookmarks API - Save and manage bookmarked articles
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';

// Demo user ID (replace with actual auth)
const DEMO_USER_ID = 'demo-user';

// ============================================
// Validation Schemas
// ============================================

const CreateBookmarkSchema = z.object({
  articleId: z.string().min(1),
  note: z.string().max(500).optional(),
});

// ============================================
// GET - List User Bookmarks
// ============================================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    const [bookmarks, total] = await Promise.all([
      db.newsBookmark.findMany({
        where: { userId: DEMO_USER_ID },
        include: {
          article: true,
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      db.newsBookmark.count({
        where: { userId: DEMO_USER_ID },
      }),
    ]);

    // Parse JSON fields in articles
    const parsedBookmarks = bookmarks.map(bookmark => ({
      ...bookmark,
      article: bookmark.article ? {
        ...bookmark.article,
        tags: JSON.parse(bookmark.article.tags || '[]'),
        relatedSymbols: JSON.parse(bookmark.article.relatedSymbols || '[]'),
      } : null,
    }));

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      success: true,
      data: parsedBookmarks,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
      },
    });
  } catch (error) {
    console.error('[News Bookmarks API] GET error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// POST - Create Bookmark
// ============================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = CreateBookmarkSchema.parse(body);

    // Check if article exists
    const article = await db.newsArticle.findUnique({
      where: { id: data.articleId },
    });

    if (!article) {
      return NextResponse.json(
        { success: false, error: 'Article not found' },
        { status: 404 }
      );
    }

    // Check if already bookmarked
    const existing = await db.newsBookmark.findUnique({
      where: {
        userId_articleId: {
          userId: DEMO_USER_ID,
          articleId: data.articleId,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Article already bookmarked' },
        { status: 400 }
      );
    }

    const bookmark = await db.newsBookmark.create({
      data: {
        userId: DEMO_USER_ID,
        articleId: data.articleId,
        note: data.note,
      },
    });

    return NextResponse.json({ success: true, data: bookmark }, { status: 201 });
  } catch (error) {
    console.error('[News Bookmarks API] POST error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, errors: error.errors }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// DELETE - Remove Bookmark
// ============================================

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const articleId = searchParams.get('articleId');

    if (!articleId) {
      return NextResponse.json(
        { success: false, error: 'Article ID is required' },
        { status: 400 }
      );
    }

    await db.newsBookmark.delete({
      where: {
        userId_articleId: {
          userId: DEMO_USER_ID,
          articleId,
        },
      },
    });

    return NextResponse.json({ success: true, message: 'Bookmark removed' });
  } catch (error) {
    console.error('[News Bookmarks API] DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// PATCH - Update Bookmark Note
// ============================================

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { articleId, note } = body;

    if (!articleId) {
      return NextResponse.json(
        { success: false, error: 'Article ID is required' },
        { status: 400 }
      );
    }

    const bookmark = await db.newsBookmark.update({
      where: {
        userId_articleId: {
          userId: DEMO_USER_ID,
          articleId,
        },
      },
      data: { note },
    });

    return NextResponse.json({ success: true, data: bookmark });
  } catch (error) {
    console.error('[News Bookmarks API] PATCH error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
