/** Every message, by area. Each is [English, Vietnamese]. */

import { shell } from "./shell";
import { diary } from "./diary";
import { clients } from "./clients";
import { setup } from "./setup";

export const MESSAGES = {
  ...shell,
  ...diary,
  ...clients,
  ...setup,
} satisfies Record<string, readonly [string, string]>;

export type MessageKey = keyof typeof MESSAGES;
