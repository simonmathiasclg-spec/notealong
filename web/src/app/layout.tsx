import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeScript } from "@/components/ThemeScript";
import { UploadsProvider } from "@/lib/uploads";
import { Motion } from "@/components/Motion";

export const metadata: Metadata = {
  title: "NoteAlong",
  description: "See which note to play for every word of a song, while the backing track plays.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0c0e14" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col">
        <Motion><UploadsProvider>{children}</UploadsProvider></Motion>
      </body>
    </html>
  );
}
