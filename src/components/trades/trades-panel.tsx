"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  History,
  TrendingUp,
  TrendingDown,
  Filter,
  ArrowUpRight,
  ArrowDownRight,
  Download,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  X,
  Calendar,
  BarChart3,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================
// Types
// ============================================

interface Trade {
  id: string;
  symbol: string;
  direction: string;
  status: string;
  entryPrice: number | null;
  exitPrice: number | null;
  entryTime: string | null;
  exitTime: string | null;
  amount: number;
  leverage: number;
  pnl: number;
  pnlPercent: number;
  fee: number;
  stopLoss: number | null;
  closeReason: string | null;
  signalSource: string | null;
  isDemo: boolean;
  createdAt: string;
  account: {
    id: string;
    exchangeId: string;
    exchangeName: string;
    exchangeType: string;
  };
  position: {
    id: string;
    totalAmount: number;
    currentPrice: number | null;
  } | null;
}

interface TradeStats {
  totalTrades: number;
  totalPnL: number;
  totalFees: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgPnL: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  totalVolume: number;
  avgLeverage: number;
  avgHoldingTime: number;
  bySymbol: Record<string, { count: number; pnl: number; winRate: number }>;
  byDirection: { LONG: { count: number; pnl: number }; SHORT: { count: number; pnl: number } };
  byExchange: Record<string, { count: number; pnl: number }>;
  byStatus: Record<string, number>;
}

interface TradeFilters {
  page: number;
  limit: number;
  symbol?: string;
  direction?: "LONG" | "SHORT";
  status?: "PENDING" | "OPEN" | "CLOSED" | "CANCELLED" | "VIRTUAL_FILLED";
  isDemo?: boolean;
  exchangeId?: string;
  dateFrom?: string;
  dateTo?: string;
  pnlMin?: number;
  pnlMax?: number;
  sortBy: string;
  sortOrder: "asc" | "desc";
  search?: string;
}

interface TradesResponse {
  success: boolean;
  data: Trade[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
  stats: TradeStats;
}

const EXCHANGES = [
  { value: "binance", label: "Binance" },
  { value: "bybit", label: "Bybit" },
  { value: "okx", label: "OKX" },
  { value: "bitget", label: "Bitget" },
  { value: "bingx", label: "BingX" },
];

// ============================================
// Component
// ============================================

export function TradesPanel() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [meta, setMeta] = useState({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
    hasNextPage: false,
    hasPrevPage: false,
  });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  
  const [filters, setFilters] = useState<TradeFilters>({
    page: 1,
    limit: 20,
    sortBy: "createdAt",
    sortOrder: "desc",
  });
  
  const [tempFilters, setTempFilters] = useState<TradeFilters>(filters);

  // Fetch trades from API
  const fetchTrades = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      
      // Add filters to params
      params.set("page", filters.page.toString());
      params.set("limit", filters.limit.toString());
      params.set("sortBy", filters.sortBy);
      params.set("sortOrder", filters.sortOrder);
      
      if (filters.symbol) params.set("symbol", filters.symbol);
      if (filters.direction) params.set("direction", filters.direction);
      if (filters.status) params.set("status", filters.status);
      if (filters.isDemo !== undefined) params.set("isDemo", filters.isDemo.toString());
      if (filters.exchangeId) params.set("exchangeId", filters.exchangeId);
      if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
      if (filters.dateTo) params.set("dateTo", filters.dateTo);
      if (filters.pnlMin !== undefined) params.set("pnlMin", filters.pnlMin.toString());
      if (filters.pnlMax !== undefined) params.set("pnlMax", filters.pnlMax.toString());
      if (filters.search) params.set("search", filters.search);
      
      const response = await fetch(`/api/trades?${params.toString()}`);
      const data: TradesResponse = await response.json();
      
      if (data.success) {
        setTrades(data.data);
        setStats(data.stats);
        setMeta(data.meta);
      }
    } catch (error) {
      console.error("Failed to fetch trades:", error);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  // Apply filters
  const applyFilters = () => {
    setFilters({ ...tempFilters, page: 1 });
    setShowFilters(false);
  };

  // Reset filters
  const resetFilters = () => {
    const defaultFilters: TradeFilters = {
      page: 1,
      limit: 20,
      sortBy: "createdAt",
      sortOrder: "desc",
    };
    setFilters(defaultFilters);
    setTempFilters(defaultFilters);
    setShowFilters(false);
  };

  // Export trades
  const exportTrades = async (format: "json" | "csv") => {
    setExporting(true);
    try {
      const response = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          filter: filters,
        }),
      });
      
      if (format === "csv") {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `trades-${new Date().toISOString().split("T")[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const data = await response.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `trades-${new Date().toISOString().split("T")[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error("Export failed:", error);
    } finally {
      setExporting(false);
    }
  };

  // Format helpers
  const formatPrice = (price: number | null | undefined) => {
    if (!price) return "-";
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: price < 1 ? 6 : 2,
    });
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    return date.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDuration = (hours: number) => {
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    if (hours < 24) return `${Math.round(hours)}h`;
    return `${(hours / 24).toFixed(1)}d`;
  };

  // Active filter count
  const activeFilterCount = [
    filters.symbol,
    filters.direction,
    filters.status,
    filters.isDemo !== undefined,
    filters.exchangeId,
    filters.dateFrom,
    filters.dateTo,
    filters.pnlMin !== undefined,
    filters.pnlMax !== undefined,
    filters.search,
  ].filter(Boolean).length;

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Total Trades</div>
            <div className="text-xl font-bold">{stats.totalTrades}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Total PnL</div>
            <div className={cn(
              "text-xl font-bold",
              stats.totalPnL >= 0 ? "text-green-500" : "text-red-500"
            )}>
              ${formatPrice(stats.totalPnL)}
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Win Rate</div>
            <div className="text-xl font-bold">{stats.winRate.toFixed(1)}%</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Profit Factor</div>
            <div className="text-xl font-bold">
              {stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Avg Win</div>
            <div className="text-xl font-bold text-green-500">
              ${formatPrice(stats.avgWin)}
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Avg Loss</div>
            <div className="text-xl font-bold text-red-500">
              ${formatPrice(stats.avgLoss)}
            </div>
          </Card>
        </div>
      )}

      {/* Main Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-5 w-5 text-primary" />
              Trades History
              {meta.total > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {meta.total}
                </Badge>
              )}
            </CardTitle>
            
            <div className="flex items-center gap-2">
              {/* Search */}
              <Input
                placeholder="Search symbol..."
                value={filters.search || ""}
                onChange={(e) => setFilters({ ...filters, search: e.target.value || undefined, page: 1 })}
                className="w-32 h-8"
              />
              
              {/* Filter Button */}
              <Popover open={showFilters} onOpenChange={setShowFilters}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 relative">
                    <Filter className="h-4 w-4 mr-1" />
                    Filters
                    {activeFilterCount > 0 && (
                      <Badge className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs">
                        {activeFilterCount}
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80" align="end">
                  <div className="space-y-4">
                    <h4 className="font-medium">Advanced Filters</h4>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Direction</Label>
                        <Select
                          value={tempFilters.direction || "all"}
                          onValueChange={(v) => setTempFilters({
                            ...tempFilters,
                            direction: v === "all" ? undefined : v as "LONG" | "SHORT"
                          })}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder="All" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="LONG">Long</SelectItem>
                            <SelectItem value="SHORT">Short</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div>
                        <Label className="text-xs">Status</Label>
                        <Select
                          value={tempFilters.status || "all"}
                          onValueChange={(v) => setTempFilters({
                            ...tempFilters,
                            status: v === "all" ? undefined : v as any
                          })}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder="All" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="OPEN">Open</SelectItem>
                            <SelectItem value="CLOSED">Closed</SelectItem>
                            <SelectItem value="PENDING">Pending</SelectItem>
                            <SelectItem value="CANCELLED">Cancelled</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Mode</Label>
                        <Select
                          value={tempFilters.isDemo === undefined ? "all" : tempFilters.isDemo ? "demo" : "real"}
                          onValueChange={(v) => setTempFilters({
                            ...tempFilters,
                            isDemo: v === "all" ? undefined : v === "demo"
                          })}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder="All" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="demo">Demo</SelectItem>
                            <SelectItem value="real">Real</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div>
                        <Label className="text-xs">Exchange</Label>
                        <Select
                          value={tempFilters.exchangeId || "all"}
                          onValueChange={(v) => setTempFilters({
                            ...tempFilters,
                            exchangeId: v === "all" ? undefined : v
                          })}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder="All" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            {EXCHANGES.map((ex) => (
                              <SelectItem key={ex.value} value={ex.value}>
                                {ex.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Date From</Label>
                        <Input
                          type="date"
                          value={tempFilters.dateFrom || ""}
                          onChange={(e) => setTempFilters({
                            ...tempFilters,
                            dateFrom: e.target.value || undefined
                          })}
                          className="h-8"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Date To</Label>
                        <Input
                          type="date"
                          value={tempFilters.dateTo || ""}
                          onChange={(e) => setTempFilters({
                            ...tempFilters,
                            dateTo: e.target.value || undefined
                          })}
                          className="h-8"
                        />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">PnL Min</Label>
                        <Input
                          type="number"
                          placeholder="Min"
                          value={tempFilters.pnlMin ?? ""}
                          onChange={(e) => setTempFilters({
                            ...tempFilters,
                            pnlMin: e.target.value ? Number(e.target.value) : undefined
                          })}
                          className="h-8"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">PnL Max</Label>
                        <Input
                          type="number"
                          placeholder="Max"
                          value={tempFilters.pnlMax ?? ""}
                          onChange={(e) => setTempFilters({
                            ...tempFilters,
                            pnlMax: e.target.value ? Number(e.target.value) : undefined
                          })}
                          className="h-8"
                        />
                      </div>
                    </div>
                    
                    <div>
                      <Label className="text-xs">Sort By</Label>
                      <div className="flex gap-2">
                        <Select
                          value={tempFilters.sortBy}
                          onValueChange={(v) => setTempFilters({ ...tempFilters, sortBy: v })}
                        >
                          <SelectTrigger className="h-8 flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="createdAt">Created</SelectItem>
                            <SelectItem value="entryTime">Entry Time</SelectItem>
                            <SelectItem value="exitTime">Exit Time</SelectItem>
                            <SelectItem value="pnl">PnL</SelectItem>
                            <SelectItem value="amount">Amount</SelectItem>
                            <SelectItem value="symbol">Symbol</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          value={tempFilters.sortOrder}
                          onValueChange={(v) => setTempFilters({ ...tempFilters, sortOrder: v as "asc" | "desc" })}
                        >
                          <SelectTrigger className="h-8 w-20">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="desc">Desc</SelectItem>
                            <SelectItem value="asc">Asc</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={resetFilters}>
                        Reset
                      </Button>
                      <Button size="sm" className="flex-1" onClick={applyFilters}>
                        Apply
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              
              {/* Export */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8" disabled={exporting}>
                    {exporting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-40">
                  <div className="space-y-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => exportTrades("csv")}
                    >
                      Export CSV
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => exportTrades("json")}
                    >
                      Export JSON
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
              
              {/* Refresh */}
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => fetchTrades()}
                disabled={loading}
              >
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </Button>
            </div>
          </div>
        </CardHeader>
        
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : trades.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <History className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No trades found</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Try adjusting your filters
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">Symbol</TableHead>
                      <TableHead className="w-[80px]">Side</TableHead>
                      <TableHead className="w-[80px]">Status</TableHead>
                      <TableHead className="w-[90px]">Entry</TableHead>
                      <TableHead className="w-[90px]">Exit</TableHead>
                      <TableHead className="w-[100px]">PnL</TableHead>
                      <TableHead className="w-[70px]">Lev</TableHead>
                      <TableHead className="w-[80px]">Mode</TableHead>
                      <TableHead className="w-[80px]">Exchange</TableHead>
                      <TableHead className="w-[100px]">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trades.map((trade) => (
                      <TableRow key={trade.id}>
                        <TableCell className="font-medium">
                          {trade.symbol.replace("USDT", "/USDT")}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs",
                              trade.direction === "LONG"
                                ? "bg-green-500/10 text-green-500 border-green-500/20"
                                : "bg-red-500/10 text-red-500 border-red-500/20"
                            )}
                          >
                            {trade.direction === "LONG" ? (
                              <ArrowUpRight className="mr-1 h-3 w-3" />
                            ) : (
                              <ArrowDownRight className="mr-1 h-3 w-3" />
                            )}
                            {trade.direction}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-xs",
                              trade.status === "CLOSED" && trade.pnl >= 0 && "bg-green-500/10 text-green-500",
                              trade.status === "CLOSED" && trade.pnl < 0 && "bg-red-500/10 text-red-500"
                            )}
                          >
                            {trade.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          ${formatPrice(trade.entryPrice)}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {trade.exitPrice ? `$${formatPrice(trade.exitPrice)}` : "-"}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "font-mono text-sm font-medium",
                              trade.pnl >= 0 ? "text-green-500" : "text-red-500"
                            )}
                          >
                            {trade.pnl >= 0 ? "+" : ""}
                            ${formatPrice(trade.pnl)}
                            <span className="text-xs text-muted-foreground ml-1">
                              ({trade.pnlPercent >= 0 ? "+" : ""}{trade.pnlPercent.toFixed(2)}%)
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-xs">
                            {trade.leverage}x
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs",
                              trade.isDemo ? "border-yellow-500/30 text-yellow-600" : "border-green-500/30 text-green-600"
                            )}
                          >
                            {trade.isDemo ? "DEMO" : "REAL"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {trade.account?.exchangeName || trade.account?.exchangeId || "-"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {formatDate(trade.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              
              {/* Pagination */}
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <div className="text-sm text-muted-foreground">
                  Showing {(meta.page - 1) * meta.limit + 1} to {Math.min(meta.page * meta.limit, meta.total)} of {meta.total}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={!meta.hasPrevPage}
                    onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm">
                    Page {meta.page} of {meta.totalPages || 1}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={!meta.hasNextPage}
                    onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default TradesPanel;
