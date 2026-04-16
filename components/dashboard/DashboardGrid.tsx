"use client";

import { useState, useCallback, useEffect } from "react";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import StatsCardWidget    from "@/components/widgets/StatsCardWidget";
import ActiveUsersWidget  from "@/components/widgets/ActiveUsersWidget";
import HourlyChartWidget  from "@/components/widgets/HourlyChartWidget";
import BandwidthChartWidget from "@/components/widgets/BandwidthChartWidget";
import BandwidthPerUserWidget from "@/components/widgets/BandwidthPerUserWidget";
import DailySummaryWidget from "@/components/widgets/DailySummaryWidget";
import SessionHistoryWidget from "@/components/widgets/SessionHistoryWidget";
import TopBandwidthWidget from "@/components/widgets/TopBandwidthWidget";
import AnomaliesWidget    from "@/components/widgets/AnomaliesWidget";

const ResponsiveGridLayout = WidthProvider(Responsive);

const STORAGE_KEY = "vpn-dashboard-layout";

const DEFAULT_LAYOUTS = {
  lg: [
    { i: "stats",     x: 0,  y: 0,  w: 4,  h: 6,  minW: 3, minH: 5 },
    { i: "anomalies", x: 4,  y: 0,  w: 4,  h: 6,  minW: 3, minH: 4 },
    { i: "hourly",    x: 8,  y: 0,  w: 4,  h: 6,  minW: 3, minH: 4 },
    { i: "active",    x: 0,  y: 6,  w: 12, h: 8,  minW: 6, minH: 4 },
    { i: "bandwidth", x: 0,  y: 14, w: 6,  h: 8,  minW: 3, minH: 4 },
    { i: "bwperuser", x: 6,  y: 14, w: 6,  h: 8,  minW: 3, minH: 4 },
    { i: "topbw",     x: 0,  y: 22, w: 3,  h: 8,  minW: 3, minH: 4 },
    { i: "daily",     x: 3,  y: 22, w: 9,  h: 8,  minW: 4, minH: 4 },
    { i: "history",   x: 0,  y: 30, w: 12, h: 10, minW: 6, minH: 5 },
  ],
  md: [
    { i: "stats",     x: 0, y: 0,  w: 5, h: 6 },
    { i: "anomalies", x: 5, y: 0,  w: 5, h: 6 },
    { i: "active",    x: 0, y: 6,  w: 10, h: 8 },
    { i: "hourly",    x: 0, y: 14, w: 4,  h: 8 },
    { i: "bandwidth", x: 4, y: 14, w: 4,  h: 8 },
    { i: "bwperuser", x: 0, y: 22, w: 10, h: 8 },
    { i: "topbw",     x: 0, y: 30, w: 4,  h: 8 },
    { i: "daily",     x: 4, y: 30, w: 6,  h: 8 },
    { i: "history",   x: 0, y: 38, w: 10, h: 10 },
  ],
};

const WIDGETS = [
  { id: "stats",     label: "Översikt"        },
  { id: "anomalies", label: "Anomalier"        },
  { id: "active",    label: "Aktiva sessioner" },
  { id: "hourly",    label: "Unika användare"  },
  { id: "bandwidth", label: "Bandbredd"        },
  { id: "bwperuser", label: "Bw Per Anv."      },
  { id: "topbw",     label: "Top Total"        },
  { id: "daily",     label: "Daglig sammanf."  },
  { id: "history",   label: "Historik"         },
] as const;

type WidgetId = (typeof WIDGETS)[number]["id"];

function loadLayouts() {
  if (typeof window === "undefined") return DEFAULT_LAYOUTS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : DEFAULT_LAYOUTS;
  } catch {
    return DEFAULT_LAYOUTS;
  }
}

export default function DashboardGrid() {
  const [layouts, setLayouts] = useState(DEFAULT_LAYOUTS);
  const [hidden, setHidden]   = useState<Set<WidgetId>>(new Set());

  useEffect(() => {
    setLayouts(loadLayouts());
  }, []);

  const handleLayoutChange = useCallback(
    (_: unknown, all: typeof DEFAULT_LAYOUTS) => {
      setLayouts(all);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    },
    []
  );

  const resetLayout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setLayouts(DEFAULT_LAYOUTS);
    setHidden(new Set());
  };

  const toggleWidget = (id: WidgetId) => {
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const visibleLayouts = {
    lg: DEFAULT_LAYOUTS.lg.filter((l) => !hidden.has(l.i as WidgetId)),
    md: DEFAULT_LAYOUTS.md.filter((l) => !hidden.has(l.i as WidgetId)),
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-gray-900 border-b border-gray-800">
        <span className="text-xs text-gray-500 mr-2 uppercase tracking-wider">
          Widgets:
        </span>
        {WIDGETS.map((w) => (
          <button
            key={w.id}
            onClick={() => toggleWidget(w.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              hidden.has(w.id)
                ? "bg-gray-800 text-gray-600 hover:text-gray-400"
                : "bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30"
            }`}
          >
            {hidden.has(w.id) ? "+" : "×"} {w.label}
          </button>
        ))}
        <button
          onClick={resetLayout}
          className="ml-auto px-3 py-1 rounded-full text-xs font-medium text-gray-500 hover:text-gray-300 bg-gray-800 hover:bg-gray-700 transition-colors"
        >
          Aterstall layout
        </button>
      </div>

      {/* Grid */}
      <ResponsiveGridLayout
        className="layout"
        layouts={visibleLayouts}
        onLayoutChange={handleLayoutChange}
        breakpoints={{ lg: 1200, md: 996, sm: 768 }}
        cols={{ lg: 12, md: 10, sm: 6 }}
        rowHeight={40}
        draggableHandle=".drag-handle"
        margin={[10, 10]}
        containerPadding={[12, 12]}
        resizeHandles={["se", "s", "e"]}
      >
        {!hidden.has("stats")     && <div key="stats"><StatsCardWidget /></div>}
        {!hidden.has("anomalies") && <div key="anomalies"><AnomaliesWidget /></div>}
        {!hidden.has("active")    && <div key="active"><ActiveUsersWidget /></div>}
        {!hidden.has("hourly")    && <div key="hourly"><HourlyChartWidget /></div>}
        {!hidden.has("bandwidth") && <div key="bandwidth"><BandwidthChartWidget /></div>}
        {!hidden.has("bwperuser") && <div key="bwperuser"><BandwidthPerUserWidget /></div>}
        {!hidden.has("topbw")     && <div key="topbw"><TopBandwidthWidget /></div>}
        {!hidden.has("daily")     && <div key="daily"><DailySummaryWidget /></div>}
        {!hidden.has("history")   && <div key="history"><SessionHistoryWidget /></div>}
      </ResponsiveGridLayout>
    </div>
  );
}
