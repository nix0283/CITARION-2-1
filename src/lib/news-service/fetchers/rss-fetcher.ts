/**
 * RSS News Fetcher
 * Production-ready RSS feed fetching and parsing
 */

import type { NewsArticle, NewsFetchResult, RSSItem } from '../types';
import { analyzeSentiment, extractSymbols, determineImportance, categorizeArticle } from '../sentiment-analyzer';

interface RSSFetcherConfig {
  name: string;
  displayName: string;
  rssUrl: string;
  baseUrl: string;
  category?: string;
}

/**
 * RSS Feed Fetcher
 * Fetches and parses RSS feeds from crypto news sources
 */
export class RSSFetcher {
  private config: RSSFetcherConfig;

  constructor(config: RSSFetcherConfig) {
    this.config = config;
  }

  getName(): string {
    return this.config.name;
  }

  async fetchArticles(limit: number = 20): Promise<NewsFetchResult> {
    const articles: NewsArticle[] = [];
    const errors: string[] = [];

    try {
      const response = await fetch(this.config.rssUrl, {
        headers: {
          'Accept': 'application/rss+xml, application/xml, text/xml',
          'User-Agent': 'CITARION-News-Bot/1.0',
        },
        next: { revalidate: 300 }, // Cache for 5 minutes
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const xmlText = await response.text();
      const items = this.parseRSS(xmlText);
      
      // Process items up to limit
      const limitedItems = items.slice(0, limit);
      
      for (const item of limitedItems) {
        try {
          const article = await this.parseItem(item);
          if (article) {
            articles.push(article);
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error parsing item';
          errors.push(`Item parse error: ${errorMsg}`);
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`${this.config.name} fetch error: ${errorMsg}`);
    }

    return {
      success: articles.length > 0,
      articles,
      errors,
      source: this.config.name,
      fetchedAt: new Date(),
    };
  }

  /**
   * Parse RSS XML into items
   */
  private parseRSS(xml: string): RSSItem[] {
    const items: RSSItem[] = [];
    
    // Simple regex-based parsing (works for most RSS feeds)
    // For production, consider using a proper XML parser
    const itemMatches = xml.match(/<item[^>]*>([\s\S]*?)<\/item>/gi) || [];
    
    for (const itemXml of itemMatches) {
      const item: RSSItem = {
        title: this.extractTag(itemXml, 'title') || '',
        link: this.extractTag(itemXml, 'link') || '',
        description: this.cleanHtml(this.extractTag(itemXml, 'description') || ''),
        pubDate: this.extractTag(itemXml, 'pubDate') || '',
        author: this.extractTag(itemXml, 'dc:creator') || this.extractTag(itemXml, 'author'),
        content: this.cleanHtml(this.extractTag(itemXml, 'content:encoded') || this.extractTag(itemXml, 'content') || ''),
      };
      
      // Extract enclosure image
      const enclosureMatch = itemXml.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image[^"]*"[^>]*>/i);
      if (enclosureMatch) {
        item.enclosure = {
          url: enclosureMatch[1],
          type: 'image',
        };
      }
      
      if (item.title && item.link) {
        items.push(item);
      }
    }
    
    return items;
  }

  /**
   * Extract content from XML tag
   */
  private extractTag(xml: string, tag: string): string | null {
    // Handle CDATA
    const cdataPattern = new RegExp(`<${tag}[^>]*><\\!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i');
    const cdataMatch = xml.match(cdataPattern);
    if (cdataMatch) return cdataMatch[1].trim();
    
    // Normal tag
    const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
    const match = xml.match(pattern);
    return match ? match[1].trim() : null;
  }

  /**
   * Clean HTML from text
   */
  private cleanHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Parse RSS item into NewsArticle
   */
  private async parseItem(item: RSSItem): Promise<NewsArticle | null> {
    if (!item.title || !item.link) {
      return null;
    }

    const fullText = `${item.title} ${item.description} ${item.content || ''}`;
    
    // Analyze sentiment
    const sentimentResult = analyzeSentiment(fullText);
    
    // Extract mentioned symbols
    const symbols = extractSymbols(fullText);
    
    // Determine importance
    const importance = determineImportance(item.title, item.description);
    
    // Categorize
    const category = this.config.category || categorizeArticle(item.title, item.description);
    
    // Generate unique ID
    const id = this.generateId(item.link);

    return {
      id,
      title: item.title,
      summary: item.description.substring(0, 500),
      content: item.content || item.description,
      url: item.link,
      imageUrl: item.enclosure?.url,
      source: this.config.displayName,
      author: item.author,
      category: category as any,
      tags: [],
      sentiment: sentimentResult.sentiment,
      sentimentScore: sentimentResult.score,
      confidence: sentimentResult.confidence,
      relatedSymbols: symbols,
      importance,
      publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
      fetchedAt: new Date(),
    };
  }

  /**
   * Generate unique ID from URL
   */
  private generateId(url: string): string {
    // Create a simple hash from URL
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `${this.config.name}-${Math.abs(hash).toString(36)}`;
  }
}

/**
 * Pre-configured news source fetchers
 */
export const NEWS_FETCHERS: RSSFetcher[] = [
  new RSSFetcher({
    name: 'coindesk',
    displayName: 'CoinDesk',
    rssUrl: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
    baseUrl: 'https://www.coindesk.com',
  }),
  new RSSFetcher({
    name: 'cointelegraph',
    displayName: 'CoinTelegraph',
    rssUrl: 'https://cointelegraph.com/rss',
    baseUrl: 'https://cointelegraph.com',
  }),
  new RSSFetcher({
    name: 'decrypt',
    displayName: 'Decrypt',
    rssUrl: 'https://decrypt.co/feed',
    baseUrl: 'https://decrypt.co',
  }),
  new RSSFetcher({
    name: 'bitcoinmagazine',
    displayName: 'Bitcoin Magazine',
    rssUrl: 'https://bitcoinmagazine.com/.rss/full/',
    baseUrl: 'https://bitcoinmagazine.com',
    category: 'bitcoin',
  }),
  new RSSFetcher({
    name: 'cryptonews',
    displayName: 'CryptoNews',
    rssUrl: 'https://cryptonews.com/news/feed/',
    baseUrl: 'https://cryptonews.com',
  }),
];

/**
 * Fetch articles from all configured sources
 */
export async function fetchAllSources(limitPerSource: number = 10): Promise<{
  articles: NewsArticle[];
  errors: string[];
  sourceStats: Record<string, { fetched: number; errors: number }>;
}> {
  const allArticles: NewsArticle[] = [];
  const allErrors: string[] = [];
  const sourceStats: Record<string, { fetched: number; errors: number }> = {};

  // Fetch from all sources in parallel
  const results = await Promise.allSettled(
    NEWS_FETCHERS.map(fetcher => fetcher.fetchArticles(limitPerSource))
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const fetcher = NEWS_FETCHERS[i];
    const sourceName = fetcher.getName();

    sourceStats[sourceName] = { fetched: 0, errors: 0 };

    if (result.status === 'fulfilled') {
      const { articles, errors } = result.value;
      allArticles.push(...articles);
      allErrors.push(...errors);
      sourceStats[sourceName].fetched = articles.length;
      sourceStats[sourceName].errors = errors.length;
    } else {
      const errorMsg = result.reason?.message || 'Unknown error';
      allErrors.push(`${sourceName}: ${errorMsg}`);
      sourceStats[sourceName].errors = 1;
    }
  }

  // Sort by published date (newest first)
  allArticles.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  return {
    articles: allArticles,
    errors: allErrors,
    sourceStats,
  };
}
