import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { MainWrapper } from "@/components/dashboard/main-wrapper";
import { SessionProvider } from "@/components/providers/session-provider";
import { MeProvider } from "@/components/providers/me-provider";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kikai Call Assistant",
  description: "24/7 AI-powered call assistant for Kikai",
  // iPhones ignore most of the web manifest: without these, "Add to Home
  // Screen" makes a bookmark that opens in Safari with its address bar.
  appleWebApp: {
    capable: true,
    title: "Diary",
    // Solid rather than translucent, so nothing slides under the clock and
    // no page needs to pad itself for the notch.
    statusBarStyle: "black",
  },
};

export const viewport: Viewport = {
  // The colour of the phone's own bars around the app, matched to the page.
  themeColor: "#0d1117",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} dark h-full antialiased`}
    >
      <body className="h-full bg-background text-slate-200 overflow-hidden">
        <SessionProvider>
          <MeProvider>
            <MainWrapper>{children}</MainWrapper>
          </MeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
