import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeScript } from "@/components/ThemeScript";
import { UploadsProvider } from "@/lib/uploads";
import { Motion } from "@/components/Motion";
import { UploadQueue } from "@/components/UploadQueue";
import { MeProvider } from "@/lib/me";
import { MiniPlayer } from "@/components/MiniPlayer";
import { TooltipLayer } from "@/components/TooltipLayer";

export const metadata: Metadata = {
  title: "NoteAlong",
  description: "See which note to play for every word of a song, while the backing track plays.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0b0a09" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col">
        <Motion><MeProvider><UploadsProvider>{children}<UploadQueue /><MiniPlayer /></UploadsProvider></MeProvider></Motion>
        <TooltipLayer />
      </body>
    </html>
  );
}
