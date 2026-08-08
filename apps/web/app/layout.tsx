import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Footer } from "@/components/footer";
import { SITE } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://snapgauge.vercel.app"),
  title: {
    default: `${SITE.name} — contract tests for MCP servers`,
    template: `%s — ${SITE.name}`,
  },
  description: SITE.tagline,
  icons: {
    icon: "/brand/favicon.svg",
    shortcut: "/brand/favicon.svg",
  },
  openGraph: {
    title: `${SITE.name} — contract tests for MCP servers`,
    description: SITE.tagline,
    images: ["/brand/og.svg"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} — contract tests for MCP servers`,
    description: SITE.tagline,
    images: ["/brand/og.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col bg-paper text-ink antialiased">
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
