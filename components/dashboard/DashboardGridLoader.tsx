"use client";

import dynamic from "next/dynamic";

const DashboardGrid = dynamic(() => import("./DashboardGrid"), { ssr: false });

export default function DashboardGridLoader() {
  return <DashboardGrid />;
}
