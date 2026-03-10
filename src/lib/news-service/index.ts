/**
 * News Service - Main Entry Point
 * Production-ready crypto news aggregation
 */

export * from './types';
export * from './sentiment-analyzer';
export { RSSFetcher, NEWS_FETCHERS, fetchAllSources } from './fetchers/rss-fetcher';
