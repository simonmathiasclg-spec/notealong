import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeScript } from "@/components/ThemeScript";

export const metadata: Metadata = {
  title: "NoteAlong",
  description: "Turn any song into a play-along screen for your instrument.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
