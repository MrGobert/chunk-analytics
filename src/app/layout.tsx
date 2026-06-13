import type { Metadata, Viewport } from "next";
import { Fraunces, DM_Sans, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";
import Providers from "@/components/layout/Providers";

// "Paper & Ember" type system — Fraunces (display), DM Sans (UI), Spline Sans Mono (data)
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const splineSansMono = Spline_Sans_Mono({
  variable: "--font-spline-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Chunk Analytics",
  description: "Analytics dashboard for Chunk AI",
};

export const viewport: Viewport = {
  themeColor: "#FAF5EE",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${fraunces.variable} ${dmSans.variable} ${splineSansMono.variable} antialiased`}
      >
        <div className="noise-overlay">
          <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
            <filter id="noiseFilter">
              <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
            </filter>
            <rect width="100%" height="100%" filter="url(#noiseFilter)" />
          </svg>
        </div>
        <Providers>
          <Sidebar />
          <main className="lg:ml-64 min-h-screen p-4 pt-20 lg:pt-8 lg:p-8 relative z-10">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
