"use client";

import { useState, useEffect, useRef } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  ColorType,
  Time,
  CandlestickSeries,
} from "lightweight-charts";
import type { CandlestickData } from "lightweight-charts";
import { Loader2, AlertTriangle } from "lucide-react";

interface MiniChartProps {
  exchangeId?: string;
  symbol?: string;
  timeframe?: string;
  chartId?: string;
}

// Default symbols per exchange
const DEFAULT_SYMBOL = "BTCUSDT";

export function MiniChart({
  exchangeId = "binance",
  symbol = DEFAULT_SYMBOL,
  timeframe = "1h",
  chartId
}: MiniChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0a0a0b" },
        textColor: "#4c525e",
      },
      grid: {
        vertLines: { color: "#1a1a1d" },
        horzLines: { color: "#1a1a1d" },
      },
      rightPriceScale: {
        borderColor: "#1a1a1d",
        borderVisible: false,
      },
      timeScale: {
        borderColor: "#1a1a1d",
        borderVisible: false,
        visible: false,
      },
      handleScale: false,
      handleScroll: false,
      crosshair: {
        mode: 0, // Hidden
      },
    });

    chartRef.current = chart;

    // Create candlestick series (v5 API)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderDownColor: "#ef5350",
      borderUpColor: "#26a69a",
      wickDownColor: "#ef5350",
      wickUpColor: "#26a69a",
    });
    candleSeriesRef.current = candleSeries;

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    handleResize();

    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, []);

  // Fetch data when exchange or symbol changes
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Use our API endpoint which handles different exchanges
        const response = await fetch(
          `/api/ohlcv?symbol=${symbol}&interval=${timeframe}&limit=100`
        );

        if (!response.ok) {
          throw new Error("Failed to fetch data");
        }

        const data = await response.json();

        if (data.success && data.ohlcv && data.ohlcv.length > 0) {
          const candleData = data.ohlcv.map((c: number[]) => ({
            time: Math.floor(c[0] / 1000) as Time,
            open: c[1],
            high: c[2],
            low: c[3],
            close: c[4],
          })) as CandlestickData<Time>[];

          if (candleSeriesRef.current) {
            candleSeriesRef.current.setData(candleData);
          }

          if (chartRef.current) {
            chartRef.current.timeScale().fitContent();
          }
        } else {
          // No data available - show error instead of synthetic data
          setError(data.error || "Нет данных");
          if (candleSeriesRef.current) {
            candleSeriesRef.current.setData([]);
          }
        }
      } catch (err) {
        console.error("Mini chart error:", err);
        setError("Ошибка загрузки");
        if (candleSeriesRef.current) {
          candleSeriesRef.current.setData([]);
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [exchangeId, symbol, timeframe]);

  return (
    <div className="relative w-full h-full">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        </div>
      )}
      {error && !isLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="flex items-center gap-1 text-amber-500 text-xs">
            <AlertTriangle className="h-3 w-3" />
            <span>{error}</span>
          </div>
        </div>
      )}
      <div ref={chartContainerRef} className="w-full h-full" />
    </div>
  );
}
