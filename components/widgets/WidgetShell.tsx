"use client";

import { ReactNode } from "react";
import clsx from "clsx";

interface Props {
  title: string;
  children: ReactNode;
  className?: string;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

export default function WidgetShell({
  title,
  children,
  className,
  loading,
  error,
  onRefresh,
}: Props) {
  return (
    <div
      className={clsx(
        "flex flex-col h-full bg-gray-900 border border-gray-700 rounded-xl shadow-lg overflow-hidden",
        className
      )}
    >
      {/* Header - drag handle */}
      <div className="drag-handle flex items-center justify-between px-4 py-2.5 bg-gray-800 border-b border-gray-700 cursor-grab active:cursor-grabbing select-none shrink-0">
        <span className="text-sm font-semibold text-gray-200 tracking-wide">
          {title}
        </span>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="text-gray-500 hover:text-gray-200 transition-colors text-xs"
              title="Uppdatera"
            >
              ↺
            </button>
          )}
          <span className="text-gray-600 text-xs">⠿</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-3">
        {error ? (
          <div className="flex items-center justify-center h-full text-red-400 text-sm">
            {error}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
