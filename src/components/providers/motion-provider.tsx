"use client";

/**
 * The dialogs, menus and side sheets animate with Motion (through Animate
 * UI's components). Someone who has asked their phone or computer to reduce
 * motion gets them without the tilt, grow and slide: they only fade in.
 */

import { MotionConfig } from "motion/react";

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
