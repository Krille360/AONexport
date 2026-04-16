import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VPN Dashboard",
  description: "Realtidsstatistik for VPN-sessioner",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sv">
      <body className="min-h-screen bg-gray-950">
        {children}
      </body>
    </html>
  );
}
