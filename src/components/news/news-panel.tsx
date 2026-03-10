"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Newspaper,
  RefreshCw,
  Filter,
  TrendingUp,
  TrendingDown,
  Minus,
  ExternalLink,
  Bookmark,
  BookmarkCheck,
  Bell,
  BellOff,
  Clock,
  Globe,
  AlertTriangle,
  Zap,
  Search,
  X,
  Tag,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ==================== TYPES ====================

interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  content?: string;
  url: string;
  imageUrl?: string;
  source: string;
  author?: string;
  category: string;
  tags: string[];
  sentiment: string;
  sentimentScore: number;
  confidence: number;
  relatedSymbols: string[];
  importance: string;
  publishedAt: string;
  fetchedAt: string;
}

interface NewsStats {
  totalArticles: number;
  recentArticles: number;
  articlesBySentiment: Record<string, number>;
  articlesByCategory: Record<string, number>;
  articlesBySource: Record<string, number>;
}

interface NewsFilter {
  category: string;
  sentiment: string;
  importance: string;
  source: string;
  symbol: string;
  search: string;
}

// ==================== CONSTANTS ====================

const CATEGORIES = [
  { value: "all", label: "All Categories" },
  { value: "market", label: "Market" },
  { value: "bitcoin", label: "Bitcoin" },
  { value: "ethereum", label: "Ethereum" },
  { value: "defi", label: "DeFi" },
  { value: "regulation", label: "Regulation" },
  { value: "technology", label: "Technology" },
  { value: "trading", label: "Trading" },
  { value: "exchange", label: "Exchanges" },
];

const SENTIMENTS = [
  { value: "all", label: "All Sentiment" },
  { value: "bullish", label: "Bullish", icon: TrendingUp, color: "text-green-500" },
  { value: "bearish", label: "Bearish", icon: TrendingDown, color: "text-red-500" },
  { value: "neutral", label: "Neutral", icon: Minus, color: "text-gray-500" },
];

const IMPORTANCE_LEVELS = [
  { value: "all", label: "All Importance" },
  { value: "critical", label: "Critical", color: "bg-red-500" },
  { value: "high", label: "High", color: "bg-orange-500" },
  { value: "medium", label: "Medium", color: "bg-yellow-500" },
  { value: "low", label: "Low", color: "bg-gray-500" },
];

// ==================== MAIN COMPONENT ====================

export function NewsPanel() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [stats, setStats] = useState<NewsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Filters
  const [filters, setFilters] = useState<NewsFilter>({
    category: "all",
    sentiment: "all",
    importance: "all",
    source: "all",
    symbol: "",
    search: "",
  });
  const [showFilters, setShowFilters] = useState(false);

  // Dialogs
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [showArticleDialog, setShowArticleDialog] = useState(false);
  const [bookmarkedArticles, setBookmarkedArticles] = useState<Set<string>>(new Set());

  // Fetch articles
  const fetchArticles = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("limit", "15");
      params.set("sortBy", "publishedAt");
      params.set("sortOrder", "desc");

      if (filters.category !== "all") params.set("category", filters.category);
      if (filters.sentiment !== "all") params.set("sentiment", filters.sentiment);
      if (filters.importance !== "all") params.set("importance", filters.importance);
      if (filters.source !== "all") params.set("source", filters.source);
      if (filters.symbol) params.set("symbol", filters.symbol);
      if (filters.search) params.set("search", filters.search);

      const res = await fetch(`/api/news?${params}`);
      const data = await res.json();

      if (data.success) {
        setArticles(data.data);
        setTotal(data.meta.total);
        setTotalPages(data.meta.totalPages);
        if (data.stats) setStats(data.stats);
      }
    } catch (error) {
      console.error("[News] Fetch error:", error);
      toast.error("Failed to load news");
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  // Refresh news
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/news", { method: "POST" });
      const data = await res.json();

      if (data.success) {
        toast.success(`Fetched ${data.stored} new articles`);
        fetchArticles();
      } else {
        toast.error("Failed to refresh news");
      }
    } catch (error) {
      console.error("[News] Refresh error:", error);
      toast.error("Failed to refresh news");
    } finally {
      setRefreshing(false);
    }
  };

  // Toggle bookmark
  const toggleBookmark = async (articleId: string) => {
    try {
      const isBookmarked = bookmarkedArticles.has(articleId);

      if (isBookmarked) {
        await fetch(`/api/news/bookmarks?articleId=${articleId}`, { method: "DELETE" });
        setBookmarkedArticles((prev) => {
          const next = new Set(prev);
          next.delete(articleId);
          return next;
        });
        toast.success("Bookmark removed");
      } else {
        await fetch("/api/news/bookmarks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ articleId }),
        });
        setBookmarkedArticles((prev) => new Set(prev).add(articleId));
        toast.success("Article bookmarked");
      }
    } catch (error) {
      console.error("[News] Bookmark error:", error);
      toast.error("Failed to update bookmark");
    }
  };

  // Format helpers
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    return `${minutes}m ago`;
  };

  const getImportanceBadge = (importance: string) => {
    const config = IMPORTANCE_LEVELS.find((l) => l.value === importance);
    return (
      <Badge
        variant="outline"
        className={cn(
          "text-[10px] px-1.5 py-0",
          importance === "critical" && "border-red-500 text-red-500 bg-red-500/10",
          importance === "high" && "border-orange-500 text-orange-500 bg-orange-500/10",
          importance === "medium" && "border-yellow-500 text-yellow-500 bg-yellow-500/10",
          importance === "low" && "border-gray-500 text-gray-400"
        )}
      >
        {importance.toUpperCase()}
      </Badge>
    );
  };

  const getSentimentIcon = (sentiment: string) => {
    switch (sentiment) {
      case "bullish":
        return <TrendingUp className="h-4 w-4 text-green-500" />;
      case "bearish":
        return <TrendingDown className="h-4 w-4 text-red-500" />;
      default:
        return <Minus className="h-4 w-4 text-gray-400" />;
    }
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Newspaper className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Crypto News</h2>
          <Badge variant="outline">{total} articles</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2"
          >
            <Filter className="h-4 w-4" />
            Filters
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="gap-2"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Card className="p-2">
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="text-lg font-bold">{stats.totalArticles}</div>
          </Card>
          <Card className="p-2">
            <div className="text-xs text-muted-foreground">24h</div>
            <div className="text-lg font-bold text-primary">{stats.recentArticles}</div>
          </Card>
          <Card className="p-2">
            <div className="text-xs text-muted-foreground">Bullish</div>
            <div className="text-lg font-bold text-green-500">
              {stats.articlesBySentiment?.bullish || 0}
            </div>
          </Card>
          <Card className="p-2">
            <div className="text-xs text-muted-foreground">Bearish</div>
            <div className="text-lg font-bold text-red-500">
              {stats.articlesBySentiment?.bearish || 0}
            </div>
          </Card>
          <Card className="p-2">
            <div className="text-xs text-muted-foreground">Sources</div>
            <div className="text-lg font-bold">
              {Object.keys(stats.articlesBySource || {}).length}
            </div>
          </Card>
        </div>
      )}

      {/* Filters */}
      {showFilters && (
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Search</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search..."
                    value={filters.search}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, search: e.target.value }))
                    }
                    className="h-8 pl-8"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Category</Label>
                <Select
                  value={filters.category}
                  onValueChange={(v) => setFilters((prev) => ({ ...prev, category: v }))}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Sentiment</Label>
                <Select
                  value={filters.sentiment}
                  onValueChange={(v) => setFilters((prev) => ({ ...prev, sentiment: v }))}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SENTIMENTS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Importance</Label>
                <Select
                  value={filters.importance}
                  onValueChange={(v) => setFilters((prev) => ({ ...prev, importance: v }))}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IMPORTANCE_LEVELS.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Symbol</Label>
                <Input
                  placeholder="BTC, ETH..."
                  value={filters.symbol}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, symbol: e.target.value.toUpperCase() }))
                  }
                  className="h-8"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Articles List */}
      <Card className="flex-1 min-h-0">
        <CardContent className="p-0 h-full">
          {loading ? (
            <div className="space-y-4 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : articles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <Newspaper className="h-12 w-12 mb-4 opacity-50" />
              <p className="font-medium">No news articles found</p>
              <p className="text-sm">Click Refresh to fetch latest news</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={handleRefresh}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Fetch News
              </Button>
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="divide-y divide-border">
                {articles.map((article) => (
                  <div
                    key={article.id}
                    className="p-4 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => {
                      setSelectedArticle(article);
                      setShowArticleDialog(true);
                    }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {getSentimentIcon(article.sentiment)}
                          <span className="font-medium line-clamp-1">{article.title}</span>
                          {getImportanceBadge(article.importance)}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {article.summary}
                        </p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1">
                            <Globe className="h-3 w-3" />
                            {article.source}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatTime(article.publishedAt)}
                          </span>
                          {article.relatedSymbols?.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Tag className="h-3 w-3" />
                              {article.relatedSymbols.slice(0, 3).join(", ")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleBookmark(article.id);
                          }}
                        >
                          {bookmarkedArticles.has(article.id) ? (
                            <BookmarkCheck className="h-4 w-4 text-primary" />
                          ) : (
                            <Bookmark className="h-4 w-4" />
                          )}
                        </Button>
                        <span
                          className={cn(
                            "text-xs font-medium",
                            article.sentiment === "bullish"
                              ? "text-green-500"
                              : article.sentiment === "bearish"
                              ? "text-red-500"
                              : "text-gray-500"
                          )}
                        >
                          {article.sentimentScore > 0 ? "+" : ""}
                          {(article.sentimentScore * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      {/* Article Detail Dialog */}
      <Dialog open={showArticleDialog} onOpenChange={setShowArticleDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedArticle && (
            <>
              <DialogHeader>
                <div className="flex items-start gap-2">
                  {getSentimentIcon(selectedArticle.sentiment)}
                  <DialogTitle className="line-clamp-2">{selectedArticle.title}</DialogTitle>
                </div>
                <DialogDescription className="flex items-center gap-3 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Globe className="h-3 w-3" />
                    {selectedArticle.source}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(selectedArticle.publishedAt).toLocaleString()}
                  </span>
                  {getImportanceBadge(selectedArticle.importance)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                {/* Quick Stats */}
                <div className="grid grid-cols-3 gap-3">
                  <Card className="p-3">
                    <div className="text-xs text-muted-foreground">Sentiment</div>
                    <div className="flex items-center gap-2">
                      {getSentimentIcon(selectedArticle.sentiment)}
                      <span className="font-bold capitalize">{selectedArticle.sentiment}</span>
                    </div>
                  </Card>
                  <Card className="p-3">
                    <div className="text-xs text-muted-foreground">Score</div>
                    <div
                      className={cn(
                        "font-bold",
                        selectedArticle.sentimentScore > 0
                          ? "text-green-500"
                          : selectedArticle.sentimentScore < 0
                          ? "text-red-500"
                          : ""
                      )}
                    >
                      {(selectedArticle.sentimentScore * 100).toFixed(1)}%
                    </div>
                  </Card>
                  <Card className="p-3">
                    <div className="text-xs text-muted-foreground">Confidence</div>
                    <div className="font-bold">
                      {(selectedArticle.confidence * 100).toFixed(0)}%
                    </div>
                  </Card>
                </div>

                {/* Summary */}
                <div className="space-y-2">
                  <Label>Summary</Label>
                  <p className="text-sm text-muted-foreground">{selectedArticle.summary}</p>
                </div>

                {/* Content */}
                {selectedArticle.content && (
                  <div className="space-y-2">
                    <Label>Content</Label>
                    <div className="text-sm text-muted-foreground whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                      {selectedArticle.content}
                    </div>
                  </div>
                )}

                {/* Related Symbols */}
                {selectedArticle.relatedSymbols?.length > 0 && (
                  <div className="space-y-2">
                    <Label>Related Symbols</Label>
                    <div className="flex gap-2 flex-wrap">
                      {selectedArticle.relatedSymbols.map((symbol) => (
                        <Badge key={symbol} variant="outline" className="font-mono">
                          {symbol}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tags */}
                {selectedArticle.tags?.length > 0 && (
                  <div className="space-y-2">
                    <Label>Tags</Label>
                    <div className="flex gap-2 flex-wrap">
                      {selectedArticle.tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => toggleBookmark(selectedArticle.id)}
                >
                  {bookmarkedArticles.has(selectedArticle.id) ? (
                    <>
                      <BookmarkCheck className="h-4 w-4 mr-2" />
                      Saved
                    </>
                  ) : (
                    <>
                      <Bookmark className="h-4 w-4 mr-2" />
                      Save
                    </>
                  )}
                </Button>
                <Button asChild>
                  <a
                    href={selectedArticle.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Read Full Article
                  </a>
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
