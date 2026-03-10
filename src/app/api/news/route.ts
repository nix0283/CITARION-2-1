/**
 * News API Route - CRUD Operations
 * Production-ready news management with filtering and aggregation
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { z } from 'zod';
import { fetchAllSources } from '@/lib/news-service/fetchers/rss-fetcher';
import type { NewsCategory, SentimentType, ImportanceLevel } from '@/lib/news-service/types';

// ============================================
// Validation Schemas
// ============================================

const QuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  category: z.string().optional(),
  sentiment: z.enum(['bullish', 'bearish', 'neutral']).optional(),
  importance: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  source: z.string().optional(),
  symbol: z.string().optional(),
  search: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sortBy: z.enum(['publishedAt', 'sentimentScore', 'importance', 'source']).default('publishedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  refresh: z.coerce.boolean().default(false),
});

// ============================================
// GET - List News Articles
// ============================================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = QuerySchema.parse(Object.fromEntries(searchParams.entries()));

    // If refresh is requested, fetch new articles first
    if (query.refresh) {
      const { articles, errors } = await fetchAllSources(10);
      
      // Store new articles in database
      for (const article of articles) {
        await storeArticle(article);
      }
      
      if (errors.length > 0) {
        console.warn('[News API] Refresh errors:', errors);
      }
    }

    // Build filter conditions
    const where: Record<string, unknown> = { isActive: true };

    if (query.category) {
      where.category = query.category;
    }
    if (query.sentiment) {
      where.sentiment = query.sentiment;
    }
    if (query.importance) {
      where.importance = query.importance;
    }
    if (query.source) {
      where.source = query.source;
    }
    if (query.symbol) {
      // SQLite JSON search workaround
      where.relatedSymbols = { contains: query.symbol.toUpperCase() };
    }
    if (query.search) {
      where.OR = [
        { title: { contains: query.search } },
        { summary: { contains: query.search } },
      ];
    }
    if (query.startDate || query.endDate) {
      where.publishedAt = {};
      if (query.startDate) (where.publishedAt as Record<string, unknown>).gte = new Date(query.startDate);
      if (query.endDate) (where.publishedAt as Record<string, unknown>).lte = new Date(query.endDate);
    }

    // Build sort mapping
    const sortMapping: Record<string, string> = {
      publishedAt: 'publishedAt',
      sentimentScore: 'sentimentScore',
      importance: 'publishedAt', // We'll sort this manually
      source: 'source',
    };

    // Execute queries in parallel
    const [articles, total, stats] = await Promise.all([
      db.newsArticle.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { [sortMapping[query.sortBy]]: query.sortOrder },
      }),
      db.newsArticle.count({ where }),
      getNewsStats(),
    ]);

    // Parse JSON fields
    const parsedArticles = articles.map(article => ({
      ...article,
      tags: JSON.parse(article.tags || '[]'),
      relatedSymbols: JSON.parse(article.relatedSymbols || '[]'),
    }));

    // Sort by importance if requested
    if (query.sortBy === 'importance') {
      const importanceOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      parsedArticles.sort((a, b) => {
        const diff = importanceOrder[a.importance as keyof typeof importanceOrder] - 
                     importanceOrder[b.importance as keyof typeof importanceOrder];
        return query.sortOrder === 'asc' ? diff : -diff;
      });
    }

    const totalPages = Math.ceil(total / query.limit);

    return NextResponse.json({
      success: true,
      data: parsedArticles,
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
    console.error('[News API] GET error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, errors: error.errors }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// POST - Trigger News Refresh
// ============================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { sources, limitPerSource = 10 } = body;

    // Fetch articles from sources
    const { articles, errors, sourceStats } = await fetchAllSources(limitPerSource);

    // Store articles in database
    let stored = 0;
    let duplicates = 0;

    for (const article of articles) {
      try {
        // Check if article already exists
        const existing = await db.newsArticle.findFirst({
          where: {
            OR: [
              { externalId: article.id },
              { url: article.url },
            ],
          },
        });

        if (existing) {
          duplicates++;
          continue;
        }

        await storeArticle(article);
        stored++;
      } catch (err) {
        console.error('[News API] Store error:', err);
      }
    }

    // Update source stats
    for (const [sourceName, stats] of Object.entries(sourceStats)) {
      await db.newsSource.upsert({
        where: { name: sourceName },
        create: {
          name: sourceName,
          displayName: sourceName,
          url: '',
          lastFetchedAt: new Date(),
          totalFetched: stats.fetched,
          status: stats.errors > 0 ? 'error' : 'active',
        },
        update: {
          lastFetchedAt: new Date(),
          totalFetched: { increment: stats.fetched },
          status: stats.errors > 0 ? 'error' : 'active',
        },
      });
    }

    return NextResponse.json({
      success: true,
      fetched: articles.length,
      stored,
      duplicates,
      errors,
      sourceStats,
    });
  } catch (error) {
    console.error('[News API] POST error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================
// Helper Functions
// ============================================

async function storeArticle(article: Record<string, unknown>): Promise<void> {
  await db.newsArticle.create({
    data: {
      externalId: article.id as string,
      title: article.title as string,
      summary: (article.summary as string) || '',
      content: article.content as string | undefined,
      url: article.url as string,
      imageUrl: article.imageUrl as string | undefined,
      source: article.source as string,
      author: article.author as string | undefined,
      category: article.category as string,
      tags: JSON.stringify(article.tags || []),
      sentiment: article.sentiment as string,
      sentimentScore: article.sentimentScore as number,
      confidence: article.confidence as number,
      relatedSymbols: JSON.stringify(article.relatedSymbols || []),
      importance: article.importance as string,
      publishedAt: article.publishedAt as Date,
    },
  });
}

async function getNewsStats() {
  const [total, recentCount, bySentiment, byCategory, bySource] = await Promise.all([
    db.newsArticle.count({ where: { isActive: true } }),
    db.newsArticle.count({
      where: {
        isActive: true,
        publishedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
    db.newsArticle.groupBy({
      by: ['sentiment'],
      where: { isActive: true },
      _count: true,
    }),
    db.newsArticle.groupBy({
      by: ['category'],
      where: { isActive: true },
      _count: true,
    }),
    db.newsArticle.groupBy({
      by: ['source'],
      where: { isActive: true },
      _count: true,
    }),
  ]);

  const sentimentMap = bySentiment.reduce((acc, s) => {
    acc[s.sentiment] = s._count;
    return acc;
  }, {} as Record<string, number>);

  const categoryMap = byCategory.reduce((acc, c) => {
    acc[c.category] = c._count;
    return acc;
  }, {} as Record<string, number>);

  const sourceMap = bySource.reduce((acc, s) => {
    acc[s.source] = s._count;
    return acc;
  }, {} as Record<string, number>);

  return {
    totalArticles: total,
    recentArticles: recentCount,
    articlesBySentiment: sentimentMap,
    articlesByCategory: categoryMap,
    articlesBySource: sourceMap,
  };
}
