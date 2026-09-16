import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { MainWrapper } from "@/components/dashboard/main-wrapper";
import { SessionProvider } from "@/components/providers/session-provider";

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
          <MainWrapper>{children}</MainWrapper>
        </SessionProvider>
      </body>
    </html>
  );
}
