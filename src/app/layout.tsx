import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { MainWrapper } from "@/components/dashboard/main-wrapper";
import { SessionProvider } from "@/components/providers/session-provider";
import { MeProvider } from "@/components/providers/me-provider";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Titles and headline figures. Geometric, with a little warmth to it, so the
// app reads as designed rather than defaulted; Inter carries everything else.
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
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
    // no page needs to pad itself for the notch. "default" is the light bar.
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  // The colour of the phone's own bars around the app, matched to the page.
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jakarta.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="h-full bg-background text-foreground overflow-hidden">
        <SessionProvider>
          <MeProvider>
            <MainWrapper>{children}</MainWrapper>
          </MeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
