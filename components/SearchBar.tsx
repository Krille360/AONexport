"use client";

import React, {
  useState, useEffect, useRef, useCallback,
} from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";

import { formatUsername } from "@/lib/types";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SearchResult { users: string[]; ips: string[] }

interface ActiveSession {
  username: string;
  client_ip: string;
  client_external_ip: string | null;
  tunnel_type: string | null;
  auth_method: string | null;
  connected_since: string;
  last_seen: string;
  duration_min: number | null;
  total_bytes_in: number;
  total_bytes_out: number;
  user_activity_state: string | null;
  avg_bps_in: number;
  avg_bps_out: number;
}

interface HistorySession {
  username: string;
  client_ip: string;
  client_external_ip: string | null;
  tunnel_type: string | null;
  auth_method: string | null;
  connected_since: string;
  last_seen: string;
  duration_min: number | null;
  total_bytes_in: number;
  total_bytes_out: number;
}

interface SamplePoint { bucket: string; mbps_in: number; mbps_out: number }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtBytes(b: number): string {
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`;
  if (b >= 1_048_576)     return `${(b / 1_048_576).toFixed(1)} MB`;
  return `${(b / 1024).toFixed(1)} KB`;
}

function fmtDur(min: number | null): string {
  if (min == null) return "–";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDT(iso: string): string {
  return iso.substring(0, 16).replace("T", " ");
}

function sessionKey(s: { client_ip: string; connected_since: string }) {
  return `${s.client_ip}|${s.connected_since}`;
}

// ─── Inline bandwidth chart per session ──────────────────────────────────────

function SessionChart({ clientIp, connectedSince }: { clientIp: string; connectedSince: string }) {
  const [pts, setPts] = useState<SamplePoint[] | null>(null);

  useEffect(() => {
    fetch(
      `/api/session-samples?client_ip=${encodeURIComponent(clientIp)}&connected_since=${encodeURIComponent(connectedSince)}`,
      { cache: "no-store" }
    )
      .then((r) => r.json())
      .then(setPts)
      .catch(() => setPts([]));
  }, [clientIp, connectedSince]);

  if (pts === null) {
    return <div className="text-xs text-gray-500 py-2 text-center">Laddar…</div>;
  }
  if (pts.length === 0) {
    return <div className="text-xs text-gray-500 py-2 text-center">Ingen data</div>;
  }

  const inVals  = pts.map((p) => p.mbps_in);
  const outVals = pts.map((p) => p.mbps_out);
  const avg     = (a: number[]) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

  return (
    <div className="mt-2">
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={pts} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="bucket"
            tick={{ fill: "#9ca3af", fontSize: 10 }}
            tickFormatter={(v: string) => v.substring(11, 16)}
            interval="preserveStartEnd"
          />
          <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} width={40} tickFormatter={(v) => `${v}`} />
          <Tooltip
            contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 6, fontSize: 11 }}
            labelFormatter={(v) => String(v).substring(0, 19)}
            formatter={(v: number, name: string) => [
              `${Number(v).toFixed(3)} Mbit/s`,
              name === "mbps_in" ? "↑ Upp" : "↓ Ned",
            ]}
          />
          <Legend formatter={(v) => (v === "mbps_in" ? "↑ Upp" : "↓ Ned")} />
          <Line type="monotone" dataKey="mbps_in"  stroke="#34d399" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="mbps_out" stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="4 2" />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex gap-6 text-xs text-gray-400 mt-1">
        <span className="text-emerald-400 font-semibold">↑ Upp</span>
        <span>Avg: <strong className="text-gray-200">{avg(inVals).toFixed(2)}</strong></span>
        <span>Max: <strong className="text-gray-200">{Math.max(...inVals).toFixed(2)}</strong></span>
        <span className="text-amber-400 font-semibold ml-4">↓ Ned</span>
        <span>Avg: <strong className="text-gray-200">{avg(outVals).toFixed(2)}</strong></span>
        <span>Max: <strong className="text-gray-200">{Math.max(...outVals).toFixed(2)}</strong></span>
      </div>
    </div>
  );
}

// ─── Session row (shared for active + history) ───────────────────────────────

function SessionRow({
  s,
  isActive,
  searchType,
  expanded,
  onToggle,
}: {
  s: ActiveSession | HistorySession;
  isActive: boolean;
  searchType: "user" | "ip";
  expanded: boolean;
  onToggle: () => void;
}) {
  const as = s as ActiveSession;

  return (
    <>
      <tr
        className="border-b border-gray-700/50 hover:bg-gray-700/30 cursor-pointer select-none"
        onClick={onToggle}
      >
        {searchType === "ip" && (
          <td className="py-1.5 px-3 text-gray-200 text-xs">{formatUsername(s.username)}</td>
        )}
        {searchType === "user" && (
          <td className="py-1.5 px-3 text-gray-300 text-xs font-mono">{s.client_ip}</td>
        )}
        <td className="py-1.5 px-3 text-gray-400 text-xs font-mono">{s.client_external_ip ?? "–"}</td>
        <td className="py-1.5 px-3 text-gray-400 text-xs">{fmtDT(s.connected_since)}</td>
        {!isActive && (
          <td className="py-1.5 px-3 text-gray-400 text-xs">{fmtDT(s.last_seen)}</td>
        )}
        <td className="py-1.5 px-3 text-gray-300 text-xs">{fmtDur(s.duration_min)}</td>
        <td className="py-1.5 px-3 text-emerald-400 text-xs text-right">{fmtBytes(s.total_bytes_in)}</td>
        <td className="py-1.5 px-3 text-amber-400 text-xs text-right">{fmtBytes(s.total_bytes_out)}</td>
        {isActive && (
          <>
            <td className="py-1.5 px-3 text-emerald-300 text-xs text-right">
              {((as.avg_bps_in * 8) / 1_000_000).toFixed(1)} Mbit/s
            </td>
            <td className="py-1.5 px-3 text-amber-300 text-xs text-right">
              {((as.avg_bps_out * 8) / 1_000_000).toFixed(1)} Mbit/s
            </td>
          </>
        )}
        <td className="py-1.5 px-3 text-gray-500 text-xs text-center">
          {expanded ? "▲" : "▼"}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-800/60">
          <td
            colSpan={searchType === "user"
              ? (isActive ? 7 : 6)
              : (isActive ? 8 : 7)}
            className="px-4 pb-3 pt-1"
          >
            <SessionChart
              clientIp={s.client_ip}
              connectedSince={s.connected_since}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main Modal ──────────────────────────────────────────────────────────────

function UserSessionsModal({
  type,
  value,
  onClose,
}: {
  type: "user" | "ip";
  value: string;
  onClose: () => void;
}) {
  const [active, setActive]   = useState<ActiveSession[]>([]);
  const [history, setHistory] = useState<HistorySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/user-sessions?type=${type}&value=${encodeURIComponent(value)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setActive(d.active ?? []);
        setHistory(d.history ?? []);
      })
      .catch(() => setError("Kunde inte hämta data"))
      .finally(() => setLoading(false));
  }, [type, value]);

  // Close on overlay click
  const handleOverlay = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const toggle = (key: string) => setExpanded((prev) => (prev === key ? null : key));

  const searchType = type;

  const activeHeaders = [
    searchType === "ip" ? "Användare" : "Intern IP",
    "Extern IP", "Ansluten", "Varaktighet", "↑ Upp", "↓ Ned",
    "↑ Nu", "↓ Nu", "",
  ];
  const historyHeaders = [
    searchType === "ip" ? "Användare" : "Intern IP",
    "Extern IP", "Ansluten", "Frånkopplad", "Varaktighet", "↑ Upp", "↓ Ned", "",
  ];

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={handleOverlay}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 shrink-0">
          <div className="flex flex-col gap-1.5">
            {type === "user" ? (
              <>
                <div className="grid grid-cols-[5.5rem_1fr] items-center gap-x-3">
                  <span className="text-xs text-gray-500 uppercase tracking-wide">Användare</span>
                  <span className="text-white font-semibold">{formatUsername(value)}</span>
                </div>
                <div className="grid grid-cols-[5.5rem_1fr] items-center gap-x-3">
                  <span className="text-xs text-gray-500 uppercase tracking-wide">Epost</span>
                  <span className="text-xs text-gray-400 font-mono">{value}</span>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-[5.5rem_1fr] items-center gap-x-3">
                <span className="text-xs text-gray-500 uppercase tracking-wide">IP-adress</span>
                <span className="text-white font-semibold font-mono">{value}</span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-6">
          {loading && (
            <div className="text-center text-gray-400 py-10">Laddar…</div>
          )}
          {error && (
            <div className="text-center text-red-400 py-10">{error}</div>
          )}
          {!loading && !error && (
            <>
              {/* Active sessions */}
              <section>
                <h3 className="text-sm font-semibold text-emerald-400 mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse" />
                  Aktiva sessioner ({active.length})
                </h3>
                {active.length === 0 ? (
                  <p className="text-xs text-gray-500">Inga aktiva sessioner</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-700">
                          {activeHeaders.map((h, i) => (
                            <th key={i} className="text-left py-1 px-3 font-semibold text-xs">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {active.map((s) => {
                          const key = sessionKey(s);
                          return (
                            <SessionRow
                              key={key}
                              s={s}
                              isActive
                              searchType={searchType}
                              expanded={expanded === key}
                              onToggle={() => toggle(key)}
                            />
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Historical sessions */}
              <section>
                <h3 className="text-sm font-semibold text-gray-400 mb-2">
                  Historiska sessioner ({history.length})
                </h3>
                {history.length === 0 ? (
                  <p className="text-xs text-gray-500">Inga historiska sessioner</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-700">
                          {historyHeaders.map((h, i) => (
                            <th key={i} className="text-left py-1 px-3 font-semibold text-xs">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((s) => {
                          const key = sessionKey(s);
                          return (
                            <SessionRow
                              key={key}
                              s={s}
                              isActive={false}
                              searchType={searchType}
                              expanded={expanded === key}
                              onToggle={() => toggle(key)}
                            />
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Search Bar ───────────────────────────────────────────────────────────────

export default function SearchBar() {
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState<SearchResult | null>(null);
  const [open, setOpen]         = useState(false);
  const [modal, setModal]       = useState<{ type: "user" | "ip"; value: string } | null>(null);
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults(null); setOpen(false); return; }
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
      const data: SearchResult = await res.json();
      setResults(data);
      setOpen((data.users.length > 0 || data.ips.length > 0));
    } catch {
      setResults(null);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(val), 300);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const select = (type: "user" | "ip", value: string) => {
    setOpen(false);
    setQuery("");
    setResults(null);
    setModal({ type, value });
  };

  const hasResults = results && (results.users.length > 0 || results.ips.length > 0);

  return (
    <>
      <div ref={wrapperRef} className="relative w-64">
        <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 focus-within:border-blue-500 transition-colors">
          <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={handleChange}
            onFocus={() => hasResults && setOpen(true)}
            placeholder="Sök användare eller IP…"
            className="bg-transparent text-sm text-white placeholder-gray-500 outline-none w-full"
          />
          {query && (
            <button
              onClick={() => { setQuery(""); setResults(null); setOpen(false); }}
              className="text-gray-500 hover:text-white text-xs leading-none"
            >
              ✕
            </button>
          )}
        </div>

        {/* Dropdown */}
        {open && hasResults && (
          <div className="absolute top-full mt-1 left-0 right-0 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl z-40 overflow-hidden">
            {results!.users.length > 0 && (
              <div>
                <div className="px-3 py-1 text-xs text-gray-500 uppercase tracking-wide border-b border-gray-700">
                  Användare
                </div>
                {results!.users.map((u) => (
                  <button
                    key={u}
                    onClick={() => select("user", u)}
                    className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2"
                  >
                    <span className="text-blue-400 text-xs">👤</span>
                    <span className="flex flex-col leading-tight">
                      <span>{formatUsername(u)}</span>
                      <span className="text-xs text-gray-500 font-mono">{u}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {results!.ips.length > 0 && (
              <div>
                <div className="px-3 py-1 text-xs text-gray-500 uppercase tracking-wide border-b border-gray-700 mt-1">
                  IP-adresser
                </div>
                {results!.ips.map((ip) => (
                  <button
                    key={ip}
                    onClick={() => select("ip", ip)}
                    className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 flex items-center gap-2 font-mono"
                  >
                    <span className="text-emerald-400 text-xs">🌐</span>
                    {ip}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* No results */}
        {open && results && !hasResults && query.trim().length >= 2 && (
          <div className="absolute top-full mt-1 left-0 right-0 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl z-40 px-3 py-2 text-xs text-gray-500">
            Inga resultat för &ldquo;{query}&rdquo;
          </div>
        )}
      </div>

      {modal && (
        <UserSessionsModal
          type={modal.type}
          value={modal.value}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
