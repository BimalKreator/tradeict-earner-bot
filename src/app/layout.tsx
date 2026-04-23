import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, Outfit } from "next/font/google";

import "./globals.css";

import { GlobalToastHost } from "@/components/ui/GlobalToastHost";

const display = Outfit({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const ui = IBM_Plex_Sans({
  variable: "--font-ui",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "Tradeict Earner",
    template: "%s · Tradeict Earner",
  },
  description:
    "Multi-user trading bot platform for Delta Exchange India — strategies, billing, and revenue sharing.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#111827",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark h-full ${display.variable} ${ui.variable}`}
    >
      <body className="relative min-h-full flex flex-col font-sans antialiased">
        {children}
        <GlobalToastHost />
      </body>
    </html>
  );
}
