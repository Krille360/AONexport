"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import StatsCardWidget        from "@/components/widgets/StatsCardWidget";
import ActiveUsersWidget      from "@/components/widgets/ActiveUsersWidget";
import HourlyChartWidget      from "@/components/widgets/HourlyChartWidget";
import BandwidthChartWidget   from "@/components/widgets/BandwidthChartWidget";
import BandwidthPerUserWidget from "@/components/widgets/BandwidthPerUserWidget";
import DailySummaryWidget     from "@/components/widgets/DailySummaryWidget";
import SessionHistoryWidget   from "@/components/widgets/SessionHistoryWidget";
import TopBandwidthWidget     from "@/components/widgets/TopBandwidthWidget";
import AnomaliesWidget        from "@/components/widgets/AnomaliesWidget";

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

function loadLocalLayouts() {
  if (typeof window === "undefined") return DEFAULT_LAYOUTS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : DEFAULT_LAYOUTS;
  } catch {
    return DEFAULT_LAYOUTS;
  }
}

export default function DashboardGrid({ username }: { username: string | null }) {
  const [layouts, setLayouts]               = useState(DEFAULT_LAYOUTS);
  const [hidden, setHidden]                 = useState<Set<WidgetId>>(new Set());
  const [loaded, setLoaded]                 = useState(false);
  const [profiles, setProfiles]             = useState<string[]>([]);
  const [activeProfile, setActiveProfile]   = useState<string | null>(null);
  const [showNew, setShowNew]               = useState(false);
  const [newName, setNewName]               = useState("");
  const saveTimerRef                        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeProfileRef                    = useRef<string | null>(null);

  useEffect(() => { activeProfileRef.current = activeProfile; }, [activeProfile]);

  // Ladda vid mount
  useEffect(() => {
    async function init() {
      if (username) {
        try {
          const res  = await fetch("/api/layout", { cache: "no-store" });
          const data = await res.json() as {
            profiles:      string[];
            activeProfile: string | null;
            layouts:       typeof DEFAULT_LAYOUTS | null;
            hidden:        string[];
          };
          setProfiles(data.profiles);
          setActiveProfile(data.activeProfile);

          if (data.profiles.length === 0) {
            // Första gången — skapa "Standard"-profil automatiskt
            await fetch("/api/layout", {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify({ action: "save", name: "Standard", layouts: DEFAULT_LAYOUTS, hidden: [] }),
            });
            setProfiles(["Standard"]);
            setActiveProfile("Standard");
          } else {
            if (data.layouts) setLayouts(data.layouts);
            if (data.hidden?.length) setHidden(new Set(data.hidden as WidgetId[]));
          }
        } catch {
          setLayouts(loadLocalLayouts());
        }
      } else {
        setLayouts(loadLocalLayouts());
      }
      setLoaded(true);
    }
    init();
  }, [username]);

  // Debounced auto-spara till aktiv profil
  const persistPrefs = useCallback(
    (newLayouts: typeof DEFAULT_LAYOUTS, newHidden: Set<WidgetId>) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const profName = activeProfileRef.current;
        if (username && profName) {
          fetch("/api/layout", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ action: "save", name: profName, layouts: newLayouts, hidden: Array.from(newHidden) }),
          }).catch(() => {});
        } else if (!username) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newLayouts));
        }
      }, 1500);
    },
    [username]
  );

  const handleLayoutChange = useCallback(
    (_: unknown, all: typeof DEFAULT_LAYOUTS) => {
      setLayouts(all);
      persistPrefs(all, hidden);
    },
    [hidden, persistPrefs]
  );

  // Byt profil
  const activateProfile = async (name: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    try {
      const res  = await fetch("/api/layout", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "activate", name }),
      });
      const data = await res.json() as { layouts: typeof DEFAULT_LAYOUTS; hidden: string[] };
      setActiveProfile(name);
      setLayouts(data.layouts ?? DEFAULT_LAYOUTS);
      setHidden(new Set((data.hidden ?? []) as WidgetId[]));
    } catch { /* tyst */ }
  };

  // Spara som ny profil
  const saveAsNew = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      const res  = await fetch("/api/layout", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "save", name: trimmed, layouts, hidden: Array.from(hidden) }),
      });
      const data = await res.json() as { profiles: string[] };
      setProfiles(data.profiles ?? [...profiles, trimmed].sort());
      setActiveProfile(trimmed);
      setShowNew(false);
      setNewName("");
    } catch { /* tyst */ }
  };

  // Ta bort aktiv profil
  const deleteProfile = async () => {
    if (!activeProfile || profiles.length <= 1) return;
    try {
      const res  = await fetch("/api/layout", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "delete", name: activeProfile }),
      });
      const data = await res.json() as {
        profiles:      string[];
        activeProfile: string | null;
        layouts:       typeof DEFAULT_LAYOUTS | null;
        hidden:        string[];
      };
      setProfiles(data.profiles);
      setActiveProfile(data.activeProfile);
      if (data.layouts) setLayouts(data.layouts);
      setHidden(new Set((data.hidden ?? []) as WidgetId[]));
    } catch { /* tyst */ }
  };

  // Återställ aktiv profil till default
  const resetLayout = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setLayouts(DEFAULT_LAYOUTS);
    setHidden(new Set());
    if (username && activeProfile) {
      fetch("/api/layout", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "save", name: activeProfile, layouts: DEFAULT_LAYOUTS, hidden: [] }),
      }).catch(() => {});
    } else if (!username) {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const toggleWidget = (id: WidgetId) => {
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      persistPrefs(layouts, next);
      return next;
    });
  };

  if (!loaded) return null;

  const visibleLayouts = {
    lg: layouts.lg.filter((l) => !hidden.has(l.i as WidgetId)),
    md: layouts.md.filter((l) => !hidden.has(l.i as WidgetId)),
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-gray-900 border-b border-gray-800">

        {/* Profilhantering (endast inloggad) */}
        {username && (
          <>
            <span className="text-xs text-gray-500 uppercase tracking-wider shrink-0">Layout:</span>

            <select
              value={activeProfile ?? ""}
              onChange={(e) => activateProfile(e.target.value)}
              className="bg-gray-800 text-gray-200 text-xs rounded px-2 py-1 border border-gray-700 focus:outline-none focus:border-indigo-500 max-w-[160px]"
            >
              {profiles.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>

            {showNew ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  type="text"
                  placeholder="Namn på layout…"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")  saveAsNew();
                    if (e.key === "Escape") { setShowNew(false); setNewName(""); }
                  }}
                  maxLength={60}
                  className="bg-gray-800 text-gray-200 text-xs rounded px-2 py-1 border border-indigo-500 focus:outline-none w-36"
                />
                <button onClick={saveAsNew}
                  className="px-2 py-1 rounded text-xs bg-indigo-600 text-white hover:bg-indigo-500 transition-colors">
                  Spara
                </button>
                <button onClick={() => { setShowNew(false); setNewName(""); }}
                  className="px-2 py-1 rounded text-xs bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors">
                  Avbryt
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNew(true)}
                className="px-2 py-1 rounded text-xs bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
                title="Spara nuvarande layout som ny profil"
              >
                + Ny layout
              </button>
            )}

            {activeProfile && profiles.length > 1 && (
              <button
                onClick={deleteProfile}
                className="px-2 py-1 rounded text-xs bg-gray-800 text-red-500/70 hover:text-red-400 hover:bg-gray-700 transition-colors"
                title={`Ta bort "${activeProfile}"`}
              >
                🗑
              </button>
            )}

            <div className="w-px h-4 bg-gray-700 mx-1 shrink-0" />
          </>
        )}

        {/* Widget-toggle */}
        <span className="text-xs text-gray-500 uppercase tracking-wider shrink-0">Widgets:</span>
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
          className="ml-auto px-3 py-1 rounded-full text-xs font-medium text-gray-500 hover:text-gray-300 bg-gray-800 hover:bg-gray-700 transition-colors shrink-0"
        >
          Återställ layout
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
import "react-grid-layout/css/styles.css";
