import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { MainWrapper } from "@/components/dashboard/main-wrapper";
import { SessionProvider } from "@/components/providers/session-provider";
import { MeProvider } from "@/components/providers/me-provider";
import { DialogsProvider } from "@/components/providers/dialogs-provider";
import { LanguageProvider } from "@/components/providers/language-provider";
import { cookies } from "next/headers";
import { DEFAULT_LANG, LANG_COOKIE, isLang } from "@/lib/i18n";

// The fonts ship with the app (the @fontsource-variable packages, OFL) rather
// than coming from Google Fonts. next/font/google downloads them during every
// build, so a bad answer from Google failed the deploy: one did, with
// "next/font/google queries have exactly one entry", on a change that never
// touched them. Latin, variable weight, as the Google versions were.
//
// Vietnamese takes letters the Latin files do not have (ơ, ư, đ, ạ…). Each
// face therefore comes in two files, Latin then Vietnamese, listed one after
// the other in the font stack (globals.css): a letter missing from the first
// is drawn from the second, in the same typeface. The Latin files carry no
// metric-matched fallback, which would otherwise come between the two and
// draw those letters in Arial.
const inter = localFont({
  src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-sans",
  adjustFontFallback: false,
});
const interVietnamese = localFont({
  src: "../../node_modules/@fontsource-variable/inter/files/inter-vietnamese-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-sans-vi",
  adjustFontFallback: false,
  preload: false,
});

// Titles and headline figures. Geometric, with a little warmth to it, so the
// app reads as designed rather than defaulted; Inter carries everything else.
const jakarta = localFont({
  src: "../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2",
  weight: "200 800",
  variable: "--font-display",
  adjustFontFallback: false,
});
const jakartaVietnamese = localFont({
  src: "../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-vietnamese-wght-normal.woff2",
  weight: "200 800",
  variable: "--font-display-vi",
  adjustFontFallback: false,
  preload: false,
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
  themeColor: "#2d331a",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The language this person chose (src/lib/i18n), so the page is rendered
  // in it from the start.
  const chosen = (await cookies()).get(LANG_COOKIE)?.value;
  const lang = isLang(chosen) ? chosen : DEFAULT_LANG;
  return (
    <html
      lang={lang}
      className={`${inter.variable} ${interVietnamese.variable} ${jakarta.variable} ${jakartaVietnamese.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="h-full bg-background text-foreground overflow-hidden">
        <SessionProvider>
          <MeProvider>
            <LanguageProvider initial={lang}>
              <DialogsProvider>
                <MainWrapper>{children}</MainWrapper>
              </DialogsProvider>
            </LanguageProvider>
          </MeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
