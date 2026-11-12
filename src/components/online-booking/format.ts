/**
 * Small display helpers for the online booking pages: times and days in the
 * salon's timezone (not the visitor's, who may be abroad or on a laptop set
 * wrong), the brand colour, and a calendar file for "Add to calendar".
 */

import type { CSSProperties } from "react";
import { contrastRatio, parseHex, readableTextOn, relativeLuminance } from "@/lib/contrast";
import { zonedDateString } from "@/lib/business-hours";

export const PERIODS = ["Morning", "Afternoon", "Evening"] as const;
export type Period = (typeof PERIODS)[number];

/**
 * The brand colour as CSS variables: --brand for fills, --brand-fg for text
 * on it, and --brand-ink for brand-coloured text on white, which falls back
 * to near-black when the brand is too pale to read.
 */
export function brandStyle(hex: string): CSSProperties {
  const rgb = parseHex(hex);
  const onWhite = rgb ? contrastRatio(relativeLuminance(rgb), 1) : 1;
  return {
    "--brand": hex,
    "--brand-fg": readableTextOn(hex).color,
    "--brand-ink": onWhite >= 4.5 ? hex : "#1c1917",
  } as CSSProperties;
}

/** "45 min", "1 hr", "2 hr 30". */
export function durationText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m}` : `${h} hr`;
}

function parts(iso: string, timeZone: string): { hour: number; minute: number } {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(iso));
  return {
    hour: Number(p.find((x) => x.type === "hour")?.value ?? 0),
    minute: Number(p.find((x) => x.type === "minute")?.value ?? 0),
  };
}

/** "3:15pm", "10am". */
export function timeText(iso: string, timeZone: string): string {
  const { hour, minute } = parts(iso, timeZone);
  const h = hour % 12 || 12;
  const suffix = hour < 12 ? "am" : "pm";
  return minute ? `${h}:${String(minute).padStart(2, "0")}${suffix}` : `${h}${suffix}`;
}

export function periodOf(iso: string, timeZone: string): Period {
  const { hour } = parts(iso, timeZone);
  return hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
}

/** A YYYY-MM-DD as a Date at noon UTC, for formatting the day itself. */
function noonOf(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

function fmt(date: string, o: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...o }).format(noonOf(date));
}

/** For the day strip: "Today" or "Wed", and "11". */
export function dayLabel(date: string, timeZone: string, now: Date = new Date()): { dow: string; date: string } {
  const today = zonedDateString(now, timeZone);
  return {
    dow: date === today ? "Today" : fmt(date, { weekday: "short" }),
    date: fmt(date, { day: "numeric" }),
  };
}

/** "Wednesday 11 November", or "Today, Wednesday 11 November". */
export function longDay(date: string, timeZone: string, relative = true, now: Date = new Date()): string {
  const full = fmt(date, { weekday: "long", day: "numeric", month: "long" });
  if (!relative) return full;
  const today = zonedDateString(now, timeZone);
  const tomorrow = zonedDateString(new Date(now.getTime() + 86_400_000), timeZone);
  return date === today ? `Today, ${full}` : date === tomorrow ? `Tomorrow, ${full}` : full;
}

function icsText(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => `\\${c}`);
}

function icsTime(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** A one-event calendar file, in UTC so every calendar app reads it the same. */
export function icsFor(e: {
  start: string;
  durationMinutes: number;
  title: string;
  location?: string | null;
  description?: string;
}): string {
  const start = new Date(e.start);
  const end = new Date(start.getTime() + e.durationMinutes * 60_000);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kikai//Online booking//EN",
    "BEGIN:VEVENT",
    `UID:${icsTime(start)}-${Math.abs(hash(e.title))}@kikai`,
    `DTSTAMP:${icsTime(new Date())}`,
    `DTSTART:${icsTime(start)}`,
    `DTEND:${icsTime(end)}`,
    `SUMMARY:${icsText(e.title)}`,
    ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
