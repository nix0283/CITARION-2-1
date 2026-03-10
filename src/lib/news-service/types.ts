/**
 * News Service Types
 * Production-ready types for crypto news aggregation
 */

export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  content?: string;
  url: string;
  imageUrl?: string;
  source: string;
  author?: string;
  category: NewsCategory;
  tags: string[];
  sentiment: SentimentType;
  sentimentScore: number; // -1 to +1
  confidence: number; // 0 to 1
  relatedSymbols: string[];
  importance: ImportanceLevel;
  publishedAt: Date;
  fetchedAt: Date;
}

export type NewsCategory = 
  | 'market'
  | 'regulation'
  | 'technology'
  | 'trading'
  | 'defi'
  | 'nft'
  | 'exchange'
  | 'bitcoin'
  | 'ethereum'
  | 'altcoins'
  | 'general';

export type SentimentType = 'bullish' | 'bearish' | 'neutral';

export type ImportanceLevel = 'low' | 'medium' | 'high' | 'critical';

export interface NewsSource {
  id: string;
  name: string;
  displayName: string;
  url: string;
  rssUrl?: string;
  apiUrl?: string;
  enabled: boolean;
  fetchInterval: number; // minutes
  rateLimit: number; // requests per hour
  lastFetchedAt?: Date;
  lastError?: string;
  totalFetched: number;
  status: 'active' | 'paused' | 'error';
  priority: number;
}

export interface NewsFetchResult {
  success: boolean;
  articles: NewsArticle[];
  errors: string[];
  source: string;
  fetchedAt: Date;
}

export interface NewsFetcher {
  getName(): string;
  fetchArticles(limit?: number): Promise<NewsFetchResult>;
}

export interface SentimentResult {
  sentiment: SentimentType;
  score: number;
  confidence: number;
}

export interface NewsFilter {
  category?: NewsCategory;
  sentiment?: SentimentType;
  importance?: ImportanceLevel;
  source?: string;
  symbols?: string[];
  startDate?: Date;
  endDate?: Date;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: 'publishedAt' | 'sentimentScore' | 'importance';
  sortOrder?: 'asc' | 'desc';
}

export interface NewsAlertConfig {
  id?: string;
  userId: string;
  name: string;
  keywords: string[];
  symbols: string[];
  sources: string[];
  categories: NewsCategory[];
  sentiment?: SentimentType;
  minImportance: ImportanceLevel;
  notifyVia: 'app' | 'email' | 'telegram';
  isActive: boolean;
}

export interface NewsStats {
  totalArticles: number;
  articlesBySource: Record<string, number>;
  articlesByCategory: Record<string, number>;
  articlesBySentiment: Record<string, number>;
  avgSentimentScore: number;
  recentArticles: number; // last 24h
}

// RSS Item interface for parsing
export interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  author?: string;
  content?: string;
  enclosure?: {
    url: string;
    type: string;
    length?: number;
  };
}

// API Response types
export interface NewsListResponse {
  success: boolean;
  data: NewsArticle[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
  stats?: NewsStats;
}

export interface NewsSourcesResponse {
  success: boolean;
  data: NewsSource[];
}

export interface NewsRefreshResponse {
  success: boolean;
  fetched: number;
  errors: string[];
}
