import DashboardGridLoader from "@/components/dashboard/DashboardGridLoader";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-gray-950">
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-lg font-bold text-white tracking-tight">
            VPN Dashboard
          </span>
        </div>
        <span className="text-xs text-gray-500">
          Uppdateras var 30s
        </span>
      </header>

      <main className="flex-1 overflow-auto">
        <DashboardGridLoader />
      </main>
    </div>
  );
}
