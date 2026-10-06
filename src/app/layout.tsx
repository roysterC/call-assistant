import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { MainWrapper } from "@/components/dashboard/main-wrapper";
import { SessionProvider } from "@/components/providers/session-provider";
import { MeProvider } from "@/components/providers/me-provider";

// The fonts ship with the app (the @fontsource-variable packages, OFL) rather
// than coming from Google Fonts. next/font/google downloads them during every
// build, so a bad answer from Google failed the deploy: one did, with
// "next/font/google queries have exactly one entry", on a change that never
// touched them. Latin, variable weight, as the Google versions were.
const inter = localFont({
  src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-sans",
});

// Titles and headline figures. Geometric, with a little warmth to it, so the
// app reads as designed rather than defaulted; Inter carries everything else.
const jakarta = localFont({
  src: "../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2",
  weight: "200 800",
  variable: "--font-display",
});

const jetbrainsMono = localFont({
  src: "../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  weight: "100 800",
  variable: "--font-geist-mono",
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
