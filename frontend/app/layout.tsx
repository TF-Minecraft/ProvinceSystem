import type { Metadata } from "next";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import SiteDevGate from "./components/site/SiteDevGate";
import "./internal/globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TFMC",
  description: "Maps, skins, and server tools for TFMC.",
  icons: {
    icon: "/server-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${fraunces.variable} ${sourceSans.variable} min-h-dvh bg-[var(--background)] font-[family-name:var(--font-source-sans),system-ui,sans-serif] text-[var(--foreground)] antialiased`}
      >
        <SiteDevGate>{children}</SiteDevGate>
      </body>
    </html>
  );
}
