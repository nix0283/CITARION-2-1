"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TrendingUp,
  TrendingDown,
  RotateCcw,
  BarChart3,
  Loader2,
  Keyboard,
  MousePointer2,
  Wifi,
  WifiOff,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  ColorType,
  CrosshairMode,
  Time,
  LineStyle,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
} from "lightweight-charts";
import type { CandlestickData, HistogramData, LineData } from "lightweight-charts";
import { IndicatorsPanel } from "@/components/indicators/indicators-panel";
import { calculateIndicator, type Candle } from "@/lib/indicators/calculator";
import type { BuiltInIndicator } from "@/lib/indicators/builtin";
import { useTradingHotkeys, HOTKEYS_HELP } from "@/hooks/use-trading-hotkeys";
import { OneClickTradingDialog, type OneClickTradeParams, type OneClickTradingConfig } from "@/components/chart/one-click-trading";
import { useOrderMarkers, type OrderMarker, type ProcessedMarker } from "@/components/chart/order-markers";
import { usePriceContext } from "@/components/providers/price-provider";

// Timeframes
const TIMEFRAMES = [
  { id: "1m", label: "1m", seconds: 60 },
  { id: "5m", label: "5m", seconds: 300 },
  { id: "15m", label: "15m", seconds: 900 },
  { id: "1h", label: "1H", seconds: 3600 },
  { id: "4h", label: "4H", seconds: 14400 },
  { id: "1d", label: "1D", seconds: 86400 },
];

// Popular symbols
const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT",
];

interface ChartCandle {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Indicator configuration
interface IndicatorConfig {
  id: string;
  indicator: BuiltInIndicator;
  inputs: Record<string, number | string | boolean>;
  visible: boolean;
}

// Tooltip data
interface TooltipData {
  time: Time | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  indicators: Array<{ name: string; value: number | null; color: string }>;
}

// Validate candle data
function isValidCandle(d: ChartCandle): boolean {
  return (
    typeof d.time === 'number' &&
    typeof d.open === 'number' && !isNaN(d.open) &&
    typeof d.high === 'number' && !isNaN(d.high) &&
    typeof d.low === 'number' && !isNaN(d.low) &&
    typeof d.close === 'number' && !isNaN(d.close) &&
    typeof d.volume === 'number' && !isNaN(d.volume) &&
    d.high >= d.low &&
    d.high >= Math.max(d.open, d.close) &&
    d.low <= Math.min(d.open, d.close)
  );
}

// Convert candles to volume histogram data with colors
function toVolumeData(data: ChartCandle[]): HistogramData<Time>[] {
  return data
    .filter(isValidCandle)
    .map((d) => ({
      time: d.time,
      value: d.volume,
      color: d.close >= d.open ? "rgba(38, 166, 154, 0.5)" : "rgba(239, 83, 80, 0.5)",
    } as HistogramData<Time>));
}

// Convert candles to candlestick data
function toCandlestickData(data: ChartCandle[]): CandlestickData<Time>[] {
  return data
    .filter(isValidCandle)
    .map((d) => ({
      time: d.time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    } as CandlestickData<Time>));
}

// Format time to readable string
function formatTime(time: Time | null): string {
  if (!time) return '-';
  const date = new Date((time as number) * 1000);
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PriceChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  // Store for indicator series - now includes pane index
  const overlaySeriesRef = useRef<Map<string, ISeriesApi<"Line" | "Histogram">[]>>(new Map());
  const paneSeriesRef = useRef<Map<string, ISeriesApi<"Line" | "Histogram">[]>>(new Map());
  // Store price lines for indicators (for RSI levels 70/30)
  const priceLinesRef = useRef<Map<string, any[]>>(new Map());

  // Use existing WebSocket connection from PriceProvider
  const { prices, connectionStatus } = usePriceContext();

  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState("1h");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isChartReady, setIsChartReady] = useState(false);
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [showVolume, setShowVolume] = useState(true);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);
  const [activeIndicators, setActiveIndicators] = useState<IndicatorConfig[]>([]);
  const [showIndicatorsPanel, setShowIndicatorsPanel] = useState(true);

  // Real-time connection status - now from PriceProvider WebSocket
  const isRealtimeConnected = connectionStatus === "connected";

  // Tooltip state
  const [tooltip, setTooltip] = useState<TooltipData>({
    time: null,
    open: null,
    high: null,
    low: null,
    close: null,
    volume: null,
    indicators: [],
  });
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  // CIT-043: Hotkeys state
  const [showHotkeysHelp, setShowHotkeysHelp] = useState(false);

  // CIT-044: Order markers state
  const [orders, setOrders] = useState<OrderMarker[]>([]);
  const [showOrderMarkers, setShowOrderMarkers] = useState(true);
  
  // Use useMemo to prevent recreating config object on every render
  const orderMarkerConfig = useMemo(() => ({ showPending: true, showFilled: true }), []);
  const processedMarkers = useOrderMarkers(orders, orderMarkerConfig);

  // CIT-049: One-click trading state
  const [oneClickEnabled, setOneClickEnabled] = useState(false);
  const [oneClickDialogOpen, setOneClickDialogOpen] = useState(false);
  const [oneClickParams, setOneClickParams] = useState<OneClickTradeParams | null>(null);
  
  // Use useMemo to prevent recreating config object on every render
  const oneClickConfig: OneClickTradingConfig = useMemo(() => ({
    enabled: oneClickEnabled,
    defaultQuantity: 0.001,
    defaultType: "MARKET",
    slippageTolerance: 0.5,
    showConfirmation: true,
    quickSizes: [1, 5, 10, 25, 50, 100],
  }), [oneClickEnabled]);

  // Use useMemo for hotkeys config
  const hotkeysConfig = useMemo(() => ({ enabled: true }), []);

  // CIT-043: Setup hotkeys
  useTradingHotkeys({
    onBuy: () => {
      if (currentPrice) {
        setOneClickParams({
          symbol,
          side: "BUY",
          price: currentPrice,
          quantity: 0.001,
          type: "MARKET",
        });
        setOneClickDialogOpen(true);
      }
    },
    onSell: () => {
      if (currentPrice) {
        setOneClickParams({
          symbol,
          side: "SELL",
          price: currentPrice,
          quantity: 0.001,
          type: "MARKET",
        });
        setOneClickDialogOpen(true);
      }
    },
    onRefresh: () => handleRefresh(),
    config: hotkeysConfig,
  });

  // Split indicators into overlay and pane
  const { overlayIndicators, paneIndicators } = useMemo(() => {
    const overlay: IndicatorConfig[] = [];
    const pane: IndicatorConfig[] = [];
    
    activeIndicators.filter(i => i.visible).forEach(config => {
      if (config.indicator.overlay) {
        overlay.push(config);
      } else {
        pane.push(config);
      }
    });
    
    return { overlayIndicators: overlay, paneIndicators: pane };
  }, [activeIndicators]);

  const hasPaneIndicators = paneIndicators.length > 0;

  // Track if chart is disposed to prevent updates after disposal
  const isDisposedRef = useRef(false);

  // Initialize chart ONCE - only re-create on symbol/timeframe change
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Mark as not disposed
    isDisposedRef.current = false;

    const initChart = () => {
      if (!chartContainerRef.current || isDisposedRef.current) return;
      
      const container = chartContainerRef.current;
      const width = container.clientWidth;
      const height = container.clientHeight;
      
      if (width === 0 || height === 0) {
        requestAnimationFrame(initChart);
        return;
      }

      // Clean up existing chart first
      if (chartRef.current) {
        try {
          chartRef.current.remove();
        } catch (e) {
          // Ignore disposal errors
        }
        chartRef.current = null;
        candleSeriesRef.current = null;
        volumeSeriesRef.current = null;
        overlaySeriesRef.current.clear();
        paneSeriesRef.current.clear();
        priceLinesRef.current.clear();
      }

      // Create chart with panes configuration
      const chart = createChart(container, {
        width,
        height,
        layout: {
          background: { type: ColorType.Solid, color: "#131722" },
          textColor: "#4c525e",
        },
        grid: {
          vertLines: { color: "#1e222d" },
          horzLines: { color: "#1e222d" },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: {
            color: '#758696',
            width: 1,
            style: LineStyle.Dashed,
            labelBackgroundColor: '#1e222d',
          },
          horzLine: {
            color: '#758696',
            width: 1,
            style: LineStyle.Dashed,
            labelBackgroundColor: '#1e222d',
          },
        },
        rightPriceScale: {
          borderColor: "#2a2e39",
        },
        timeScale: {
          borderColor: "#2a2e39",
          timeVisible: true,
        },
        panes: hasPaneIndicators ? [
          { height: 0.7 },
          { height: 0.3 },
        ] : [
          { height: 1.0 },
        ],
        paneSeparator: {
          color: "#2a2e39",
          hoverColor: "#4c525e",
          width: 2,
        },
        handleScale: {
          mouseWheel: true,
          pinch: true,
          axisPressedMouseMove: true,
        },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: true,
        },
      } as any);

      if (isDisposedRef.current) {
        // Chart was disposed during initialization
        try {
          chart.remove();
        } catch (e) {}
        return;
      }

      chartRef.current = chart;

      // Create candlestick series in pane 0 (default)
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#26a69a",
        downColor: "#ef5350",
        borderDownColor: "#ef5350",
        borderUpColor: "#26a69a",
        wickDownColor: "#ef5350",
        wickUpColor: "#26a69a",
      });
      candleSeriesRef.current = candleSeries;

      // Create volume series in pane 0 with its own price scale
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: {
          type: "volume",
        },
        priceScaleId: "volume-scale",
      });
      volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
      });
      volumeSeriesRef.current = volumeSeries;
      
      // Subscribe to crosshair move for tooltip
      chart.subscribeCrosshairMove((param) => {
        if (!param.time || !param.point) {
          setShowTooltip(false);
          return;
        }

        const candleData = param.seriesData.get(candleSeriesRef.current!);
        const volumeData = param.seriesData.get(volumeSeriesRef.current!);

        if (candleData && 'open' in candleData) {
          const indicators: TooltipData['indicators'] = [];
          
          overlaySeriesRef.current.forEach((seriesArr, id) => {
            seriesArr.forEach((s) => {
              const data = param.seriesData.get(s);
              if (data && 'value' in data) {
                const config = activeIndicators.find(i => i.id === id);
                if (config) {
                  indicators.push({
                    name: config.indicator.name,
                    value: data.value,
                    color: config.indicator.outputConfig[0]?.color || '#fff',
                  });
                }
              }
            });
          });
          
          paneSeriesRef.current.forEach((seriesArr, id) => {
            seriesArr.forEach((s, idx) => {
              const data = param.seriesData.get(s);
              if (data && 'value' in data) {
                const config = activeIndicators.find(i => i.id === id);
                if (config && config.indicator.outputConfig[idx]) {
                  indicators.push({
                    name: `${config.indicator.name} (${config.indicator.outputConfig[idx].name})`,
                    value: data.value,
                    color: config.indicator.outputConfig[idx].color,
                  });
                }
              }
            });
          });

          setTooltip({
            time: param.time,
            open: candleData.open,
            high: candleData.high,
            low: candleData.low,
            close: candleData.close,
            volume: volumeData && 'value' in volumeData ? volumeData.value : null,
            indicators,
          });
          setTooltipPosition({ x: param.point.x, y: param.point.y });
          setShowTooltip(true);
        }
      });
      
      // CIT-049: One-click trading click handler
      if (oneClickEnabled) {
        chart.subscribeClick((param) => {
          if (!param.point || !param.time) return;

          const price = param.point.y;
          const suggestedSide: "BUY" | "SELL" = price < (currentPrice || 0) ? "BUY" : "SELL";

          setOneClickParams({
            symbol,
            side: suggestedSide,
            price: price,
            quantity: 0.001,
            type: "MARKET",
          });
          setOneClickDialogOpen(true);
        });
      }
      
      // Chart is ready
      setIsChartReady(true);
    };

    requestAnimationFrame(initChart);

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current && !isDisposedRef.current) {
        try {
          chartRef.current.applyOptions({
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
          });
        } catch (e) {
          // Ignore errors if chart is disposed
        }
      }
    };

    window.addEventListener("resize", handleResize);
    
    const resizeObserver = new ResizeObserver(handleResize);
    if (chartContainerRef.current) {
      resizeObserver.observe(chartContainerRef.current);
    }

    return () => {
      // Mark as disposed first to prevent any further updates
      isDisposedRef.current = true;
      setIsChartReady(false);
      
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      
      if (chartRef.current) {
        try {
          chartRef.current.remove();
        } catch (e) {
          // Ignore disposal errors
        }
        chartRef.current = null;
        candleSeriesRef.current = null;
        volumeSeriesRef.current = null;
        overlaySeriesRef.current.clear();
        paneSeriesRef.current.clear();
        priceLinesRef.current.clear();
      }
    };
  // Only re-create chart on symbol/timeframe change, not on every price update
  }, [symbol, timeframe, hasPaneIndicators]);

  // Ref to track if initial data was loaded for current symbol/timeframe
  const dataLoadedForRef = useRef<{ symbol: string; timeframe: string } | null>(null);

  // Fetch data on mount and when symbol/timeframe changes
  useEffect(() => {
    let cancelled = false;

    // Reset loaded state when symbol/timeframe changes
    dataLoadedForRef.current = null;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // Fetch OHLCV data - API automatically checks freshness
        const response = await fetch(
          `/api/ohlcv?symbol=${symbol}&interval=${timeframe}&limit=500`
        );

        if (response.ok) {
          const data = await response.json();

          if (data.success && data.ohlcv && data.ohlcv.length > 0) {
            const ohlcv: ChartCandle[] = data.ohlcv.map((c: number[]) => ({
              time: Math.floor(c[0] / 1000) as Time,
              open: c[1],
              high: c[2],
              low: c[3],
              close: c[4],
              volume: c[5],
            }));

            if (!cancelled) {
              // Mark data as loaded for this symbol/timeframe
              dataLoadedForRef.current = { symbol, timeframe };
              setCandles(ohlcv);
              const lastCandle = ohlcv[ohlcv.length - 1];
              setCurrentPrice(lastCandle.close);
              setPriceChange(
                ((lastCandle.close - ohlcv[0].open) / ohlcv[0].open) * 100
              );
            }
            return;
          }

          // API returned error
          if (!cancelled) {
            setError(data.error || 'Не удалось загрузить данные');
            setCandles([]);
          }
        } else {
          if (!cancelled) {
            setError('Ошибка сервера при загрузке данных');
            setCandles([]);
          }
        }
      } catch (err) {
        console.error("Failed to fetch chart data:", err);

        if (!cancelled) {
          setError('Не удалось подключиться к серверу');
          setCandles([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe]);

  // Ref to track last update time for throttling
  const lastUpdateRef = useRef<number>(0);
  const lastPriceRef = useRef<number>(0);
  const candlesRef = useRef<ChartCandle[]>(candles);
  const firstOpenRef = useRef<number>(0);

  // Keep candlesRef and firstOpenRef in sync
  useEffect(() => {
    candlesRef.current = candles;
    if (candles.length > 0) {
      firstOpenRef.current = candles[0].open;
    }
  }, [candles]);

  // Real-time price updates from existing WebSocket connection (PriceProvider)
  // Uses update() for efficient single-candle updates without full re-render
  useEffect(() => {
    if (isLoading || !symbol || !candleSeriesRef.current || isDisposedRef.current) return;

    // Get the current symbol's price from WebSocket
    const priceData = prices[symbol];
    if (!priceData || !isRealtimeConnected) return;

    const newPrice = priceData.price;

    // Throttle updates to max 4 per second (250ms) for smoother UX
    const now = Date.now();
    if (now - lastUpdateRef.current < 250) return;

    // Skip if price hasn't changed significantly
    const priceDiff = Math.abs(newPrice - lastPriceRef.current);
    const minDiff = newPrice > 100 ? 0.1 : newPrice > 10 ? 0.01 : 0.001;
    if (priceDiff < minDiff) return;

    // Need candles to update
    const currentCandles = candlesRef.current;
    if (currentCandles.length === 0) return;

    // Double-check chart is not disposed before updating
    if (isDisposedRef.current || !chartRef.current) return;

    lastUpdateRef.current = now;
    lastPriceRef.current = newPrice;

    // Update current price display
    setCurrentPrice(newPrice);

    // Update the last candle directly in the chart series using update()
    const lastCandle = currentCandles[currentCandles.length - 1];
    const updatedCandle: CandlestickData = {
      time: lastCandle.time as Time,
      open: lastCandle.open,
      high: Math.max(lastCandle.high, newPrice),
      low: Math.min(lastCandle.low, newPrice),
      close: newPrice,
    };

    // Use update() for efficient real-time updates (no full re-render)
    try {
      if (!isDisposedRef.current && candleSeriesRef.current) {
        candleSeriesRef.current.update(updatedCandle);
        // Update ref for next comparison (don't trigger state update)
        candlesRef.current = [
          ...currentCandles.slice(0, -1),
          { ...lastCandle, close: newPrice, high: Math.max(lastCandle.high, newPrice), low: Math.min(lastCandle.low, newPrice) }
        ];
      }
    } catch (e) {
      // Ignore update errors
    }

    // Update price change percentage
    if (firstOpenRef.current > 0) {
      setPriceChange(((newPrice - firstOpenRef.current) / firstOpenRef.current) * 100);
    }
  }, [prices, symbol, isLoading, isRealtimeConnected]);

  // Track last candles data to detect actual changes
  const lastCandlesKeyRef = useRef<string>("");

  // Update chart data when candles change OR when chart becomes ready
  useEffect(() => {
    if (!chartRef.current || candles.length === 0 || isDisposedRef.current) return;

    // Wait for chart to be ready
    if (!isChartReady) return;

    // Create a key to detect if candles actually changed
    const candlesKey = `${symbol}-${timeframe}-${candles.length}-${candles[0]?.time}-${candles[candles.length-1]?.time}`;
    
    // Skip if candles haven't actually changed
    if (lastCandlesKeyRef.current === candlesKey) return;
    lastCandlesKeyRef.current = candlesKey;

    const candleData = toCandlestickData(candles);
    const volumeData = toVolumeData(candles);

    if (candleData.length === 0) return;

    console.log('[PriceChart] Setting chart data:', {
      candlesCount: candles.length,
      candleDataCount: candleData.length,
      symbol,
      timeframe,
      firstCandle: new Date(candles[0].time * 1000).toISOString(),
      lastCandle: new Date(candles[candles.length-1].time * 1000).toISOString(),
    });

    // Update candlestick data
    if (candleSeriesRef.current && !isDisposedRef.current) {
      try {
        candleSeriesRef.current.setData(candleData);

        // CIT-044: Set order markers on candlestick series
        if (showOrderMarkers && processedMarkers.length > 0 && 'setMarkers' in candleSeriesRef.current) {
          (candleSeriesRef.current as any).setMarkers(processedMarkers.map(m => ({
            time: m.time,
            position: m.position,
            color: m.color,
            shape: m.shape,
            text: m.text,
          })));
        }
      } catch (e) {
        console.error('[PriceChart] Error setting candle data:', e);
      }
    }

    // Update volume data
    if (volumeSeriesRef.current && !isDisposedRef.current) {
      try {
        if (showVolume) {
          volumeSeriesRef.current.setData(volumeData);
        } else {
          volumeSeriesRef.current.setData([]);
        }
      } catch (e) {
        console.error('[PriceChart] Error setting volume data:', e);
      }
    }

    // Fit content
    if (!isDisposedRef.current && chartRef.current) {
      try {
        chartRef.current.timeScale().fitContent();
      } catch (e) {
        // Ignore errors if chart is disposed
      }
    }
  }, [candles, showVolume, isChartReady, processedMarkers, showOrderMarkers, symbol, timeframe]);

  // Render overlay indicators on main chart (pane 0)
  useEffect(() => {
    if (!chartRef.current || !isChartReady || !candles || candles.length === 0 || isDisposedRef.current) return;

    const chart = chartRef.current;

    const validCandles = candles.filter(c => 
      c && 
      typeof c.time !== 'undefined' &&
      typeof c.open === 'number' && !isNaN(c.open) &&
      typeof c.high === 'number' && !isNaN(c.high) &&
      typeof c.low === 'number' && !isNaN(c.low) &&
      typeof c.close === 'number' && !isNaN(c.close)
    );
    
    if (validCandles.length === 0) return;

    const activeIndicatorIds = new Set(overlayIndicators.map(c => c.id));
    
    overlaySeriesRef.current.forEach((series, id) => {
      if (!activeIndicatorIds.has(id)) {
        series.forEach((s) => {
          try {
            if (!isDisposedRef.current) {
              chart.removeSeries(s);
            }
          } catch (e) {}
        });
        overlaySeriesRef.current.delete(id);
      }
    });

    if (isDisposedRef.current) return;

    overlayIndicators.forEach((config) => {
      if (overlaySeriesRef.current.has(config.id) || isDisposedRef.current) {
        return;
      }

      let result;
      try {
        result = calculateIndicator(config.indicator, validCandles, config.inputs);
      } catch (e) {
        return;
      }
      
      if (!result || isDisposedRef.current) return;

      const series: ISeriesApi<"Line" | "Histogram">[] = [];

      if (result.lines && Array.isArray(result.lines)) {
        result.lines.forEach((line) => {
          if (!line || !line.data || !Array.isArray(line.data) || line.data.length === 0 || isDisposedRef.current) return;
          try {
            const lineSeries = chart.addLineSeries({
              color: line.color || '#2962FF',
              lineWidth: 1,
              priceLineVisible: false,
              lastValueVisible: false,
            });
            lineSeries.setData(line.data as LineData<Time>[]);
            series.push(lineSeries);
          } catch (e) {}
        });
      }

      if (result.histograms && Array.isArray(result.histograms)) {
        result.histograms.forEach((hist) => {
          if (!hist || !hist.data || !Array.isArray(hist.data) || hist.data.length === 0) return;
          try {
            const histSeries = chart.addHistogramSeries({
              priceLineVisible: false,
              lastValueVisible: false,
            });
            histSeries.setData(hist.data as HistogramData<Time>[]);
            series.push(histSeries);
          } catch (e) {}
        });
      }

      if (series.length > 0) {
        overlaySeriesRef.current.set(config.id, series);
      }
    });

  }, [candles, overlayIndicators, isChartReady]);

  // Render pane indicators (oscillators) in pane 1 with price levels
  useEffect(() => {
    if (!chartRef.current || !isChartReady || !candles || candles.length === 0 || !hasPaneIndicators) return;

    const chart = chartRef.current;

    const validCandles = candles.filter(c => 
      c && 
      typeof c.time !== 'undefined' &&
      typeof c.open === 'number' && !isNaN(c.open) &&
      typeof c.high === 'number' && !isNaN(c.high) &&
      typeof c.low === 'number' && !isNaN(c.low) &&
      typeof c.close === 'number' && !isNaN(c.close)
    );
    
    if (validCandles.length === 0) return;

    const activePaneIndicatorIds = new Set(paneIndicators.map(c => c.id));

    priceLinesRef.current.forEach((lines, id) => {
      if (!activePaneIndicatorIds.has(id)) {
        lines.forEach((line) => {
          try {
            line.remove();
          } catch (e) {}
        });
        priceLinesRef.current.delete(id);
      }
    });

    paneSeriesRef.current.forEach((series, id) => {
      if (!activePaneIndicatorIds.has(id)) {
        series.forEach((s) => {
          try {
            chart.removeSeries(s);
          } catch (e) {}
        });
        paneSeriesRef.current.delete(id);
      }
    });

    paneIndicators.forEach((config) => {
      if (paneSeriesRef.current.has(config.id)) return;

      let result;
      try {
        result = calculateIndicator(config.indicator, validCandles, config.inputs);
      } catch (e) {
        console.error('Error calculating pane indicator:', config.indicator.id, e);
        return;
      }
      
      if (!result) return;

      const series: ISeriesApi<"Line" | "Histogram">[] = [];
      const paneIndex = 1;
      const priceScaleId = `pane-scale-${config.id}`;

      if (result.lines && Array.isArray(result.lines)) {
        result.lines.forEach((line, idx) => {
          if (!line || !line.data || !Array.isArray(line.data) || line.data.length === 0) return;
          try {
            const lineSeries = chart.addLineSeries({
              color: line.color || '#2962FF',
              lineWidth: 1,
              priceLineVisible: true,
              lastValueVisible: true,
              priceScaleId: priceScaleId,
            }, paneIndex);
            lineSeries.setData(line.data as LineData<Time>[]);
            series.push(lineSeries);
          } catch (e) {}
        });
      }

      if (result.histograms && Array.isArray(result.histograms)) {
        result.histograms.forEach((hist) => {
          if (!hist || !hist.data || !Array.isArray(hist.data) || hist.data.length === 0) return;
          try {
            const histSeries = chart.addHistogramSeries({
              priceLineVisible: false,
              lastValueVisible: false,
              priceScaleId: priceScaleId,
            }, paneIndex);
            histSeries.setData(hist.data as HistogramData<Time>[]);
            series.push(histSeries);
          } catch (e) {}
        });
      }

      if (series.length > 0) {
        paneSeriesRef.current.set(config.id, series);

        if (config.indicator.id === 'rsi') {
          chart.priceScale(priceScaleId).applyOptions({
            autoScale: false,
            scaleMargins: { top: 0.1, bottom: 0.1 },
          });

          const priceLines: any[] = [];
          const mainSeries = series[0];
          
          if (mainSeries && 'createPriceLine' in mainSeries) {
            const overboughtLine = mainSeries.createPriceLine({
              price: 70,
              color: 'rgba(239, 83, 80, 0.5)',
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: 'Overbought',
            });
            priceLines.push(overboughtLine);

            const oversoldLine = mainSeries.createPriceLine({
              price: 30,
              color: 'rgba(38, 166, 154, 0.5)',
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: 'Oversold',
            });
            priceLines.push(oversoldLine);

            const middleLine = mainSeries.createPriceLine({
              price: 50,
              color: 'rgba(255, 255, 255, 0.2)',
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: false,
              title: '',
            });
            priceLines.push(middleLine);
          }

          priceLinesRef.current.set(config.id, priceLines);
        }
        
        if (config.indicator.id === 'macd') {
          const mainSeries = series[0];
          if (mainSeries && 'createPriceLine' in mainSeries) {
            const zeroLine = mainSeries.createPriceLine({
              price: 0,
              color: 'rgba(255, 255, 255, 0.3)',
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: false,
              title: '',
            });
            priceLinesRef.current.set(config.id, [zeroLine]);
          }
        }
      }
    });

  }, [candles, paneIndicators, hasPaneIndicators, isChartReady]);

  const formatPrice = (price: number) => {
    if (price >= 1000) {
      return `$${price.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
    return `$${price.toFixed(4)}`;
  };

  const handleRefresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/ohlcv?symbol=${symbol}&interval=${timeframe}&limit=500&forceFetch=true`
      );

      if (response.ok) {
        const data = await response.json();

        if (data.success && data.ohlcv && data.ohlcv.length > 0) {
          const ohlcv: ChartCandle[] = data.ohlcv.map((c: number[]) => ({
            time: Math.floor(c[0] / 1000) as Time,
            open: c[1],
            high: c[2],
            low: c[3],
            close: c[4],
            volume: c[5],
          }));

          setCandles(ohlcv);
          const lastCandle = ohlcv[ohlcv.length - 1];
          setCurrentPrice(lastCandle.close);
          setPriceChange(
            ((lastCandle.close - ohlcv[0].open) / ohlcv[0].open) * 100
          );
        } else {
          setError(data.error || 'Не удалось загрузить данные');
          setCandles([]);
        }
      } else {
        setError('Ошибка сервера при загрузке данных');
      }
    } catch (err) {
      console.error("Failed to refresh chart data:", err);
      setError('Не удалось подключиться к серверу');
    } finally {
      setIsLoading(false);
    }
  }, [symbol, timeframe]);

  const handleIndicatorsChange = useCallback((indicators: IndicatorConfig[]) => {
    setActiveIndicators(indicators);
  }, []);

  // CIT-049: Handle one-click trade confirmation
  const handleOneClickTradeConfirm = useCallback(async (params: OneClickTradeParams) => {
    console.log("One-click trade:", params);
    // In real implementation, this would call the trading API
    // For demo, we just add to orders
    const newOrder: OrderMarker = {
      id: `order-${Date.now()}`,
      time: Math.floor(Date.now() / 1000),
      price: params.price,
      side: params.side,
      type: params.type,
      status: "FILLED",
      quantity: params.quantity,
      filledQuantity: params.quantity,
      avgPrice: params.price,
      symbol: params.symbol,
      createdAt: Date.now(),
    };
    setOrders(prev => [...prev, newOrder]);
  }, []);

  // Build legend items
  const legendItems = useMemo(() => {
    const items: Array<{ color: string; label: string }> = [];
    
    if (showVolume) {
      items.push({ color: '#26a69a', label: 'Volume' });
    }
    
    activeIndicators.filter(i => i.visible).forEach(config => {
      config.indicator.outputConfig.forEach(output => {
        items.push({ color: output.color, label: `${config.indicator.name} (${output.name})` });
      });
    });
    
    return items;
  }, [activeIndicators, showVolume]);

  return (
    <div className="h-full flex">
      {/* Main Chart Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between p-3 border-b border-border bg-card/50">
          <div className="flex items-center gap-3">
            {/* Symbol Selector */}
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="w-[140px] h-8" data-testid="symbol-selector">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SYMBOLS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace("USDT", "/USDT")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Timeframe Selector */}
            <div className="flex items-center gap-1" data-testid="timeframe-selector">
              {TIMEFRAMES.map((tf) => (
                <Button
                  key={tf.id}
                  variant={timeframe === tf.id ? "default" : "ghost"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setTimeframe(tf.id)}
                  data-testid={`timeframe-${tf.id}`}
                  data-active={timeframe === tf.id}
                >
                  {tf.label}
                </Button>
              ))}
            </div>

            {/* Volume Toggle */}
            <Button
              variant={showVolume ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setShowVolume(!showVolume)}
              data-testid="toggle-volume"
            >
              <BarChart3 className="h-3 w-3 mr-1" />
              Vol
            </Button>

            {/* CIT-049: One-Click Trading Toggle */}
            <Button
              variant={oneClickEnabled ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setOneClickEnabled(!oneClickEnabled)}
              data-testid="toggle-one-click"
            >
              <MousePointer2 className="h-3 w-3 mr-1" />
              1-Click
            </Button>
          </div>

          <div className="flex items-center gap-3">
            {/* Real-time Connection Status */}
            <div className="flex items-center gap-1">
              {isRealtimeConnected ? (
                <div className="flex items-center gap-1 text-green-500">
                  <Wifi className="h-3 w-3" />
                  <span className="text-xs">LIVE</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-muted-foreground">
                  <WifiOff className="h-3 w-3" />
                  <span className="text-xs">Offline</span>
                </div>
              )}
            </div>
            
            {/* Current Price */}
            {currentPrice && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {formatPrice(currentPrice)}
                </span>
                <Badge
                  className={cn(
                    "text-xs",
                    priceChange >= 0
                      ? "bg-green-500/10 text-green-500"
                      : "bg-red-500/10 text-red-500"
                  )}
                >
                  {priceChange >= 0 ? (
                    <TrendingUp className="h-3 w-3 mr-1" />
                  ) : (
                    <TrendingDown className="h-3 w-3 mr-1" />
                  )}
                  {priceChange >= 0 ? "+" : ""}
                  {priceChange.toFixed(2)}%
                </Badge>
              </div>
            )}

            {/* CIT-043: Hotkeys Help */}
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setShowHotkeysHelp(!showHotkeysHelp)}
              data-testid="hotkeys-help-button"
            >
              <Keyboard className="h-4 w-4" />
            </Button>

            {/* Refresh Button */}
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={handleRefresh}
              disabled={isLoading}
              data-testid="refresh-chart"
            >
              <RotateCcw
                className={cn("h-4 w-4", isLoading && "animate-spin")}
              />
            </Button>

            {/* Toggle Indicators Panel */}
            <Button
              variant={showIndicatorsPanel ? "default" : "outline"}
              size="sm"
              className="h-8"
              onClick={() => setShowIndicatorsPanel(!showIndicatorsPanel)}
              data-testid="toggle-indicators"
            >
              <BarChart3 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Chart Container */}
        <div
          ref={chartContainerRef}
          className={cn(
            "relative flex-1 hide-tv-logo min-h-[400px]",
            (isLoading || !isChartReady || candles.length === 0) && "pointer-events-none"
          )}
          data-testid="price-chart"
        >
          {(isLoading || !isChartReady || candles.length === 0 || error) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#131722] z-10 gap-3">
              {isLoading || !isChartReady ? (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <span className="text-muted-foreground">Загрузка данных...</span>
                </>
              ) : error ? (
                <>
                  <AlertTriangle className="h-8 w-8 text-amber-500" />
                  <span className="text-amber-500 text-center px-4">{error}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefresh}
                    className="mt-2"
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Повторить
                  </Button>
                </>
              ) : (
                <span className="text-muted-foreground">Нет данных</span>
              )}
            </div>
          )}
          
          {/* Tooltip */}
          {showTooltip && tooltip.time && (
            <div
              className="absolute z-20 pointer-events-none bg-[#1e222d]/95 border border-[#2a2e39] rounded-md p-3 text-xs shadow-lg"
              style={{
                left: Math.min(tooltipPosition.x + 15, (chartContainerRef.current?.clientWidth || 400) - 200),
                top: Math.max(tooltipPosition.y - 100, 10),
              }}
            >
              <div className="text-muted-foreground mb-2 font-medium">
                {formatTime(tooltip.time)}
              </div>
              
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Open:</span>
                  <span className="ml-2">{tooltip.open?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">High:</span>
                  <span className="ml-2 text-green-400">{tooltip.high?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Low:</span>
                  <span className="ml-2 text-red-400">{tooltip.low?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Close:</span>
                  <span className={cn("ml-2", tooltip.close! >= tooltip.open! ? "text-green-400" : "text-red-400")}>
                    {tooltip.close?.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between col-span-2">
                  <span className="text-muted-foreground">Volume:</span>
                  <span className="ml-2">{tooltip.volume?.toLocaleString()}</span>
                </div>
              </div>
              
              {tooltip.indicators.length > 0 && (
                <div className="border-t border-[#2a2e39] pt-2 mt-1">
                  <div className="text-muted-foreground mb-1 font-medium">Индикаторы:</div>
                  {tooltip.indicators.map((ind, i) => (
                    <div key={i} className="flex justify-between items-center">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ind.color }} />
                        {ind.name}:
                      </span>
                      <span className="ml-2">{ind.value?.toFixed(2) || '-'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* CIT-043: Hotkeys Help Panel */}
          {showHotkeysHelp && (
            <div 
              className="absolute top-2 right-2 z-30 bg-[#1e222d]/95 border border-[#2a2e39] rounded-md p-3 text-xs shadow-lg"
              data-testid="hotkeys-help"
            >
              <div className="flex justify-between items-center mb-2">
                <span className="font-medium">Hotkeys</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  onClick={() => setShowHotkeysHelp(false)}
                >
                  ×
                </Button>
              </div>
              <div className="space-y-1">
                {HOTKEYS_HELP.map((hk, i) => (
                  <div key={i} className="flex justify-between gap-4">
                    <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">{hk.key}</kbd>
                    <span className="text-muted-foreground">{hk.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 p-2 border-t border-border bg-card/50 text-xs flex-wrap">
          {legendItems.map((item, index) => (
            <div key={index} className="flex items-center gap-1">
              <div
                className="w-3 h-0.5"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-muted-foreground">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Indicators Panel Sidebar */}
      {showIndicatorsPanel && (
        <div className="w-[280px] border-l border-border bg-card/30 flex flex-col">
          <div className="p-3 border-b border-border">
            <h3 className="text-sm font-medium">Индикаторы</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <IndicatorsPanel onIndicatorsChange={handleIndicatorsChange} />
          </div>
        </div>
      )}

      {/* CIT-049: One-Click Trading Dialog */}
      <OneClickTradingDialog
        open={oneClickDialogOpen}
        onOpenChange={setOneClickDialogOpen}
        params={oneClickParams}
        onConfirm={handleOneClickTradeConfirm}
        currentPrice={currentPrice || 0}
        balance={10000}
        config={oneClickConfig}
      />
    </div>
  );
}
