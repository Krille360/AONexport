"use client";

import { useState, useEffect, useRef } from "react";

export type RangePreset = "1h" | "today" | "yesterday" | "thisweek" | "lastweek" | "custom";

interface Props {
  onRangeChange: (from: string, to: string, preset: RangePreset) => void;
}

function pad(n: number) { return String(n).padStart(2, "0"); }

/** Format a Date as a local datetime string usable in SQL: "YYYY-MM-DD HH:MM:SS" */
export function toLocalSQL(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function toInputDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toInputTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function getPresetDates(preset: RangePreset): [Date, Date] {
  const now = new Date();
  switch (preset) {
    case "1h":
      return [new Date(now.getTime() - 3_600_000), now];
    case "today": {
      const s = new Date(now); s.setHours(0, 0, 0, 0);
      return [s, now];
    }
    case "yesterday": {
      const s = new Date(now); s.setDate(s.getDate() - 1); s.setHours(0, 0, 0, 0);
      const e = new Date(s); e.setHours(23, 59, 59, 0);
      return [s, e];
    }
    case "thisweek": {
      const s = new Date(now);
      const dow = s.getDay(); // 0=Sun
      s.setDate(s.getDate() - (dow === 0 ? 6 : dow - 1)); // back to Monday
      s.setHours(0, 0, 0, 0);
      return [s, now];
    }
    case "lastweek": {
      const s = new Date(now);
      const dow = s.getDay();
      const daysToLastMonday = (dow === 0 ? 6 : dow - 1) + 7;
      s.setDate(s.getDate() - daysToLastMonday);
      s.setHours(0, 0, 0, 0);
      const e = new Date(s); e.setDate(e.getDate() + 6); e.setHours(23, 59, 59, 0);
      return [s, e];
    }
    default:
      return [new Date(now.getTime() - 3_600_000), now];
  }
}

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: "1h",        label: "Senaste timmen" },
  { id: "today",     label: "Idag"           },
  { id: "yesterday", label: "Igår"           },
  { id: "thisweek",  label: "Denna Vecka"    },
  { id: "lastweek",  label: "Förra Veckan"   },
  { id: "custom",    label: "Custom"         },
];

export default function TimeRangeSelector({ onRangeChange }: Props) {
  const [preset, setPreset]   = useState<RangePreset>("1h");
  const [showPanel, setShowPanel] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const now = new Date();
  const [fromDate, setFromDate] = useState(toInputDate(now));
  const [fromTime, setFromTime] = useState("00:00");
  const [toDate,   setToDate]   = useState(toInputDate(now));
  const [toTime,   setToTime]   = useState(toInputTime(now));

  // Fire onRangeChange whenever preset changes (not custom)
  useEffect(() => {
    if (preset !== "custom") {
      const [f, t] = getPresetDates(preset);
      onRangeChange(toLocalSQL(f), toLocalSQL(t), preset);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  // Close panel on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowPanel(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function applyCustom() {
    const from = `${fromDate} ${fromTime}:00`;
    const to   = `${toDate} ${toTime}:00`;
    onRangeChange(from, to, "custom");
    setShowPanel(false);
  }

  return (
    <div className="relative shrink-0" ref={panelRef}>
      {/* Preset buttons */}
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              setPreset(p.id);
              if (p.id === "custom") setShowPanel(true);
              else setShowPanel(false);
            }}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              preset === p.id
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom picker panel */}
      {showPanel && (
        <div className="absolute top-8 left-0 z-30 bg-gray-900 border border-gray-700 rounded-xl p-4 shadow-2xl flex flex-col gap-3 min-w-[260px]">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 uppercase tracking-wider">Från</label>
            <div className="flex gap-2">
              <input
                type="date" value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-indigo-500"
              />
              <input
                type="time" value={fromTime}
                onChange={(e) => setFromTime(e.target.value)}
                className="w-24 bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 uppercase tracking-wider">Till</label>
            <div className="flex gap-2">
              <input
                type="date" value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-indigo-500"
              />
              <input
                type="time" value={toTime}
                onChange={(e) => setToTime(e.target.value)}
                className="w-24 bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={applyCustom}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-1.5 rounded transition-colors"
            >
              Tillämpa
            </button>
            <button
              onClick={() => { setShowPanel(false); setPreset("1h"); }}
              className="px-3 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded transition-colors"
            >
              Avbryt
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
