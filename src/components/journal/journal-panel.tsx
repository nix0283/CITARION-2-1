"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import {
  BookOpen,
  Plus,
  Filter,
  TrendingUp,
  TrendingDown,
  Calendar,
  Target,
  AlertTriangle,
  BarChart3,
  Lightbulb,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Trash2,
  Eye,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Sparkles,
  Tag,
  Heart,
  Frown,
  Smile,
  Meh,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ==================== TYPES ====================

interface JournalEntry {
  id: string;
  title: string;
  content: string;
  tradeId?: string;
  symbol?: string;
  direction?: 'LONG' | 'SHORT';
  marketCondition: 'trending' | 'ranging' | 'volatile' | 'choppy' | 'neutral';
  entryPrice?: number;
  exitPrice?: number;
  size?: number;
  pnl: number;
  pnlPercent: number;
  entryQuality: number;
  exitQuality: number;
  riskManagement: number;
  lessons: string[];
  mistakes: string[];
  improvements: string[];
  emotion: 'confident' | 'neutral' | 'fearful' | 'greedy' | 'anxious' | 'hopeful';
  tags: string[];
  reviewStatus: 'pending' | 'reviewed' | 'archived';
  confidence?: number;
  signalSource?: string;
  timeInTrade?: number;
  tradeDate: string;
  createdAt: string;
  updatedAt: string;
}

interface JournalStats {
  totalEntries: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  avgEntryQuality: number;
  avgExitQuality: number;
  avgRiskMgmt: number;
  byCondition?: Record<string, { count: number; pnl: number; winRate: number }>;
  byEmotion?: Record<string, { count: number; pnl: number; winRate: number }>;
}

interface PaginatedResponse {
  success: boolean;
  data: JournalEntry[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
  stats: JournalStats;
}

// ==================== CONSTANTS ====================

const MARKET_CONDITIONS = [
  { value: 'trending', label: 'Trending', icon: TrendingUp },
  { value: 'ranging', label: 'Ranging', icon: BarChart3 },
  { value: 'volatile', label: 'Volatile', icon: Zap },
  { value: 'choppy', label: 'Choppy', icon: AlertTriangle },
  { value: 'neutral', label: 'Neutral', icon: Meh },
];

const EMOTIONS = [
  { value: 'confident', label: 'Confident', icon: Smile, color: 'text-green-500' },
  { value: 'neutral', label: 'Neutral', icon: Meh, color: 'text-gray-500' },
  { value: 'hopeful', label: 'Hopeful', icon: Heart, color: 'text-pink-500' },
  { value: 'anxious', label: 'Anxious', icon: AlertCircle, color: 'text-yellow-500' },
  { value: 'fearful', label: 'Fearful', icon: Frown, color: 'text-orange-500' },
  { value: 'greedy', label: 'Greedy', icon: TrendingUp, color: 'text-red-500' },
];

const REVIEW_STATUS = [
  { value: 'pending', label: 'Pending', color: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' },
  { value: 'reviewed', label: 'Reviewed', color: 'bg-green-500/10 text-green-500 border-green-500/20' },
  { value: 'archived', label: 'Archived', color: 'bg-gray-500/10 text-gray-500 border-gray-500/20' },
];

const QUICK_TAGS = [
  'Breakout', 'Reversal', 'Trend Follow', 'Scalp', 'Swing',
  'FOMO', 'Revenge Trade', 'Plan Followed', 'Good Entry', 'Bad Entry',
  'Early Exit', 'Late Exit', 'SL Hit', 'TP Hit', 'Breakeven'
];

// ==================== MAIN COMPONENT ====================

export function JournalPanel() {
  // State
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [stats, setStats] = useState<JournalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Filters
  const [filters, setFilters] = useState({
    status: 'all',
    symbol: '',
    emotion: 'all',
    marketCondition: 'all',
    search: '',
    sortBy: 'tradeDate',
    sortOrder: 'desc' as 'asc' | 'desc',
  });
  const [showFilters, setShowFilters] = useState(false);

  // Dialog states
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // New entry form
  const [newEntry, setNewEntry] = useState({
    title: '',
    content: '',
    symbol: '',
    direction: 'LONG' as 'LONG' | 'SHORT',
    marketCondition: 'neutral' as 'trending' | 'ranging' | 'volatile' | 'choppy' | 'neutral',
    entryPrice: '',
    exitPrice: '',
    size: '',
    pnl: '',
    entryQuality: 0.5,
    exitQuality: 0.5,
    riskManagement: 0.5,
    emotion: 'neutral' as 'confident' | 'neutral' | 'fearful' | 'greedy' | 'anxious' | 'hopeful',
    tags: [] as string[],
    lessons: [] as string[],
    mistakes: [] as string[],
    improvements: [] as string[],
  });

  // Fetch entries
  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('limit', '10');
      params.set('sortBy', filters.sortBy);
      params.set('sortOrder', filters.sortOrder);

      if (filters.status !== 'all') params.set('status', filters.status);
      if (filters.symbol) params.set('symbol', filters.symbol);
      if (filters.emotion && filters.emotion !== 'all') params.set('emotion', filters.emotion);
      if (filters.marketCondition && filters.marketCondition !== 'all') params.set('marketCondition', filters.marketCondition);
      if (filters.search) params.set('search', filters.search);

      const res = await fetch(`/api/journal?${params}`);
      const data: PaginatedResponse = await res.json();

      if (data.success) {
        setEntries(data.data);
        setStats(data.stats);
        setTotalPages(data.meta.totalPages);
        setTotal(data.meta.total);
      }
    } catch (error) {
      console.error('[Journal] Fetch error:', error);
      toast.error('Failed to load journal entries');
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Create entry
  const handleCreateEntry = async () => {
    if (!newEntry.title.trim()) {
      toast.error('Title is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newEntry.title,
          content: newEntry.content,
          symbol: newEntry.symbol || undefined,
          direction: newEntry.direction,
          marketCondition: newEntry.marketCondition,
          entryPrice: newEntry.entryPrice ? parseFloat(newEntry.entryPrice) : undefined,
          exitPrice: newEntry.exitPrice ? parseFloat(newEntry.exitPrice) : undefined,
          size: newEntry.size ? parseFloat(newEntry.size) : undefined,
          pnl: newEntry.pnl ? parseFloat(newEntry.pnl) : 0,
          entryQuality: newEntry.entryQuality,
          exitQuality: newEntry.exitQuality,
          riskManagement: newEntry.riskManagement,
          emotion: newEntry.emotion,
          tags: newEntry.tags,
          lessons: newEntry.lessons,
          mistakes: newEntry.mistakes,
          improvements: newEntry.improvements,
        }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success('Journal entry created');
        setShowCreateDialog(false);
        resetForm();
        fetchEntries();
      } else {
        toast.error('Failed to create entry');
      }
    } catch (error) {
      console.error('[Journal] Create error:', error);
      toast.error('Failed to create entry');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete entry
  const handleDeleteEntry = async (id: string) => {
    if (!confirm('Are you sure you want to delete this entry?')) return;

    try {
      const res = await fetch(`/api/journal/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('Entry deleted');
        setShowViewDialog(false);
        fetchEntries();
      }
    } catch {
      toast.error('Failed to delete entry');
    }
  };

  // Update entry status
  const handleUpdateStatus = async (id: string, status: 'pending' | 'reviewed' | 'archived') => {
    try {
      const res = await fetch(`/api/journal/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewStatus: status }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Status updated');
        fetchEntries();
        if (selectedEntry?.id === id) {
          setSelectedEntry({ ...selectedEntry, reviewStatus: status });
        }
      }
    } catch {
      toast.error('Failed to update status');
    }
  };

  // Reset form
  const resetForm = () => {
    setNewEntry({
      title: '',
      content: '',
      symbol: '',
      direction: 'LONG',
      marketCondition: 'neutral',
      entryPrice: '',
      exitPrice: '',
      size: '',
      pnl: '',
      entryQuality: 0.5,
      exitQuality: 0.5,
      riskManagement: 0.5,
      emotion: 'neutral',
      tags: [],
      lessons: [],
      mistakes: [],
      improvements: [],
    });
  };

  // Toggle tag
  const toggleTag = (tag: string) => {
    setNewEntry(prev => ({
      ...prev,
      tags: prev.tags.includes(tag)
        ? prev.tags.filter(t => t !== tag)
        : [...prev.tags, tag],
    }));
  };

  // Format helpers
  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${(value * 100).toFixed(1)}%`;
  };

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Trading Journal</h2>
          <Badge variant="outline">{total} entries</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="h-4 w-4 mr-2" />
            Filters
          </Button>
          <Button size="sm" onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Entry
          </Button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Search</Label>
                <Input
                  placeholder="Search..."
                  value={filters.search}
                  onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                  className="h-8"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Status</Label>
                <Select value={filters.status} onValueChange={(v) => setFilters(prev => ({ ...prev, status: v }))}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="reviewed">Reviewed</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Symbol</Label>
                <Input
                  placeholder="BTCUSDT"
                  value={filters.symbol}
                  onChange={(e) => setFilters(prev => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
                  className="h-8"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Emotion</Label>
                <Select value={filters.emotion} onValueChange={(v) => setFilters(prev => ({ ...prev, emotion: v }))}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {EMOTIONS.map(e => (
                      <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Market</Label>
                <Select value={filters.marketCondition} onValueChange={(v) => setFilters(prev => ({ ...prev, marketCondition: v }))}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {MARKET_CONDITIONS.map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Win Rate</div>
            <div className={cn("text-xl font-bold", stats.winRate >= 0.5 ? "text-green-500" : "text-red-500")}>
              {formatPercent(stats.winRate)}
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Total P&L</div>
            <div className={cn("text-xl font-bold", stats.totalPnL >= 0 ? "text-green-500" : "text-red-500")}>
              {formatCurrency(stats.totalPnL)}
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Avg Win</div>
            <div className="text-xl font-bold text-green-500">
              {formatCurrency(stats.avgWin)}
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Avg Loss</div>
            <div className="text-xl font-bold text-red-500">
              {formatCurrency(stats.avgLoss)}
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Profit Factor</div>
            <div className="text-xl font-bold">
              {stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Avg Quality</div>
            <div className="text-xl font-bold">
              {formatPercent((stats.avgEntryQuality + stats.avgExitQuality) / 2)}
            </div>
          </Card>
        </div>
      )}

      {/* Entries List */}
      <Card className="flex-1 min-h-0">
        <CardContent className="p-0 h-full">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <BookOpen className="h-12 w-12 mb-4 opacity-50" />
              <p className="font-medium">No journal entries yet</p>
              <p className="text-sm">Start documenting your trades to improve</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => setShowCreateDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create First Entry
              </Button>
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="divide-y divide-border">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="p-4 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => {
                      setSelectedEntry(entry);
                      setShowViewDialog(true);
                    }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium truncate">{entry.title}</span>
                          <Badge
                            variant="outline"
                            className={cn("text-xs", REVIEW_STATUS.find(s => s.value === entry.reviewStatus)?.color)}
                          >
                            {entry.reviewStatus}
                          </Badge>
                          {entry.symbol && (
                            <Badge variant="outline" className="text-xs font-mono">
                              {entry.symbol}
                            </Badge>
                          )}
                          {entry.direction && (
                            <Badge className={cn("text-xs", entry.direction === 'LONG' ? 'bg-green-500' : 'bg-red-500')}>
                              {entry.direction}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {entry.content || 'No notes'}
                        </p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDate(entry.tradeDate)}
                          </span>
                          {entry.pnl !== 0 && (
                            <span className={cn("flex items-center gap-1", entry.pnl >= 0 ? 'text-green-500' : 'text-red-500')}>
                              {entry.pnl >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                              {formatCurrency(entry.pnl)}
                            </span>
                          )}
                          {entry.tags.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Tag className="h-3 w-3" />
                              {entry.tags.length} tags
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <div className="flex items-center gap-1">
                          {EMOTIONS.filter(e => e.value === entry.emotion).map(e => {
                            const Icon = e.icon;
                            return <Icon key={e.value} className={cn("h-4 w-4", e.color)} />;
                          })}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Quality: {formatPercent((entry.entryQuality + entry.exitQuality) / 2)}
                        </div>
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
            onClick={() => setPage(p => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page === totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              New Journal Entry
            </DialogTitle>
            <DialogDescription>
              Document your trade for analysis and improvement
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Title */}
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input
                placeholder="e.g., BTC Long Breakout"
                value={newEntry.title}
                onChange={(e) => setNewEntry(prev => ({ ...prev, title: e.target.value }))}
              />
            </div>

            {/* Content */}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                placeholder="Describe your trade setup, reasoning, and observations..."
                value={newEntry.content}
                onChange={(e) => setNewEntry(prev => ({ ...prev, content: e.target.value }))}
                rows={4}
              />
            </div>

            {/* Trade Details */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Symbol</Label>
                <Input
                  placeholder="BTCUSDT"
                  value={newEntry.symbol}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Direction</Label>
                <Select value={newEntry.direction} onValueChange={(v) => setNewEntry(prev => ({ ...prev, direction: v as 'LONG' | 'SHORT' }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LONG">LONG</SelectItem>
                    <SelectItem value="SHORT">SHORT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Market Condition</Label>
                <Select value={newEntry.marketCondition} onValueChange={(v) => setNewEntry(prev => ({ ...prev, marketCondition: v as typeof newEntry.marketCondition }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MARKET_CONDITIONS.map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Prices & PnL */}
            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Entry Price</Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={newEntry.entryPrice}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, entryPrice: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Exit Price</Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={newEntry.exitPrice}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, exitPrice: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Size</Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={newEntry.size}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, size: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>P&L</Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={newEntry.pnl}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, pnl: e.target.value }))}
                />
              </div>
            </div>

            {/* Quality Scores */}
            <div className="space-y-4">
              <Label>Quality Assessment</Label>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Entry Quality</span>
                    <span>{formatPercent(newEntry.entryQuality)}</span>
                  </div>
                  <Slider
                    value={[newEntry.entryQuality]}
                    onValueChange={([v]) => setNewEntry(prev => ({ ...prev, entryQuality: v }))}
                    min={0}
                    max={1}
                    step={0.1}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Exit Quality</span>
                    <span>{formatPercent(newEntry.exitQuality)}</span>
                  </div>
                  <Slider
                    value={[newEntry.exitQuality]}
                    onValueChange={([v]) => setNewEntry(prev => ({ ...prev, exitQuality: v }))}
                    min={0}
                    max={1}
                    step={0.1}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Risk Mgmt</span>
                    <span>{formatPercent(newEntry.riskManagement)}</span>
                  </div>
                  <Slider
                    value={[newEntry.riskManagement]}
                    onValueChange={([v]) => setNewEntry(prev => ({ ...prev, riskManagement: v }))}
                    min={0}
                    max={1}
                    step={0.1}
                  />
                </div>
              </div>
            </div>

            {/* Emotion */}
            <div className="space-y-2">
              <Label>Emotional State</Label>
              <div className="flex gap-2 flex-wrap">
                {EMOTIONS.map(e => {
                  const Icon = e.icon;
                  return (
                    <Button
                      key={e.value}
                      variant={newEntry.emotion === e.value ? "default" : "outline"}
                      size="sm"
                      onClick={() => setNewEntry(prev => ({ ...prev, emotion: e.value as typeof newEntry.emotion }))}
                      className="flex items-center gap-2"
                    >
                      <Icon className={cn("h-4 w-4", newEntry.emotion === e.value ? '' : e.color)} />
                      {e.label}
                    </Button>
                  );
                })}
              </div>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label>Tags</Label>
              <div className="flex gap-2 flex-wrap">
                {QUICK_TAGS.map(tag => (
                  <Badge
                    key={tag}
                    variant={newEntry.tags.includes(tag) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateEntry} disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Create Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedEntry && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <DialogTitle className="flex items-center gap-2">
                    <Eye className="h-5 w-5" />
                    {selectedEntry.title}
                  </DialogTitle>
                  <div className="flex items-center gap-2">
                    {REVIEW_STATUS.map(s => (
                      <Button
                        key={s.value}
                        variant={selectedEntry.reviewStatus === s.value ? "default" : "outline"}
                        size="sm"
                        onClick={() => handleUpdateStatus(selectedEntry.id, s.value as typeof selectedEntry.reviewStatus)}
                      >
                        {s.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <DialogDescription>
                  {formatDate(selectedEntry.tradeDate)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                {/* Quick Stats */}
                <div className="grid grid-cols-4 gap-3">
                  {selectedEntry.symbol && (
                    <Card className="p-3">
                      <div className="text-xs text-muted-foreground">Symbol</div>
                      <div className="font-mono font-bold">{selectedEntry.symbol}</div>
                    </Card>
                  )}
                  {selectedEntry.direction && (
                    <Card className="p-3">
                      <div className="text-xs text-muted-foreground">Direction</div>
                      <Badge className={selectedEntry.direction === 'LONG' ? 'bg-green-500' : 'bg-red-500'}>
                        {selectedEntry.direction}
                      </Badge>
                    </Card>
                  )}
                  <Card className="p-3">
                    <div className="text-xs text-muted-foreground">P&L</div>
                    <div className={cn("font-bold", selectedEntry.pnl >= 0 ? 'text-green-500' : 'text-red-500')}>
                      {formatCurrency(selectedEntry.pnl)}
                    </div>
                  </Card>
                  <Card className="p-3">
                    <div className="text-xs text-muted-foreground">Market</div>
                    <Badge variant="outline">{selectedEntry.marketCondition}</Badge>
                  </Card>
                </div>

                {/* Content */}
                {selectedEntry.content && (
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <div className="p-3 rounded-lg bg-muted/30 text-sm whitespace-pre-wrap">
                      {selectedEntry.content}
                    </div>
                  </div>
                )}

                {/* Quality Scores */}
                <div className="space-y-2">
                  <Label>Quality Assessment</Label>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Entry</span>
                        <span>{formatPercent(selectedEntry.entryQuality)}</span>
                      </div>
                      <Progress value={selectedEntry.entryQuality * 100} className="h-2" />
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Exit</span>
                        <span>{formatPercent(selectedEntry.exitQuality)}</span>
                      </div>
                      <Progress value={selectedEntry.exitQuality * 100} className="h-2" />
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Risk Mgmt</span>
                        <span>{formatPercent(selectedEntry.riskManagement)}</span>
                      </div>
                      <Progress value={selectedEntry.riskManagement * 100} className="h-2" />
                    </div>
                  </div>
                </div>

                {/* Emotion */}
                <div className="space-y-2">
                  <Label>Emotional State</Label>
                  <div className="flex items-center gap-2">
                    {EMOTIONS.filter(e => e.value === selectedEntry.emotion).map(e => {
                      const Icon = e.icon;
                      return (
                        <Badge key={e.value} variant="outline" className="flex items-center gap-2">
                          <Icon className={cn("h-4 w-4", e.color)} />
                          {e.label}
                        </Badge>
                      );
                    })}
                  </div>
                </div>

                {/* Tags */}
                {selectedEntry.tags.length > 0 && (
                  <div className="space-y-2">
                    <Label>Tags</Label>
                    <div className="flex gap-2 flex-wrap">
                      {selectedEntry.tags.map(tag => (
                        <Badge key={tag} variant="outline">{tag}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Lessons & Mistakes */}
                {(selectedEntry.lessons.length > 0 || selectedEntry.mistakes.length > 0 || selectedEntry.improvements.length > 0) && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {selectedEntry.lessons.length > 0 && (
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2 text-green-500">
                          <Lightbulb className="h-4 w-4" />
                          Lessons
                        </Label>
                        <ul className="text-sm space-y-1">
                          {selectedEntry.lessons.map((l, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                              {l}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {selectedEntry.mistakes.length > 0 && (
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2 text-red-500">
                          <AlertCircle className="h-4 w-4" />
                          Mistakes
                        </Label>
                        <ul className="text-sm space-y-1">
                          {selectedEntry.mistakes.map((m, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <XCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                              {m}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {selectedEntry.improvements.length > 0 && (
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2 text-blue-500">
                          <Sparkles className="h-4 w-4" />
                          Improvements
                        </Label>
                        <ul className="text-sm space-y-1">
                          {selectedEntry.improvements.map((impr, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <Target className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                              {impr}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Prices */}
                {(selectedEntry.entryPrice || selectedEntry.exitPrice) && (
                  <div className="grid grid-cols-3 gap-4">
                    {selectedEntry.entryPrice && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Entry Price</Label>
                        <div className="font-mono">{formatCurrency(selectedEntry.entryPrice)}</div>
                      </div>
                    )}
                    {selectedEntry.exitPrice && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Exit Price</Label>
                        <div className="font-mono">{formatCurrency(selectedEntry.exitPrice)}</div>
                      </div>
                    )}
                    {selectedEntry.size && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Size</Label>
                        <div>{selectedEntry.size}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="destructive" size="sm" onClick={() => handleDeleteEntry(selectedEntry.id)}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
                <Button variant="outline" onClick={() => setShowViewDialog(false)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default JournalPanel;
