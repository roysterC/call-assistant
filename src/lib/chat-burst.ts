/**
 * Waiting for a quiet spell before replying to a chat.
 *
 * People on Instagram and WhatsApp send "Hi", then "can I book", then
 * "Thursday?", a second or two apart. Answering each as it came gave three
 * replies, the first two to half the request. So each new message restarts a
 * short wait, and the reply goes once they have been quiet for QUIET_MS (at
 * most MAX_WAIT_MS after the first), answering everything they sent.
 *
 * One conversation's replies run one at a time: one that comes in while a
 * reply is being written is answered after it, with anything else sent
 * meanwhile. The reply itself works out what is still unanswered from the
 * stored messages, so running it twice answers nothing twice.
 *
 * Held in this server's memory, which is enough for one server; a restart
 * during the wait is caught by chat-recovery.ts.
 */

export const QUIET_MS = 4_000;
export const MAX_WAIT_MS = 10_000;

interface Waiting {
  timer: ReturnType<typeof setTimeout>;
  firstAt: number;
}

const waiting = new Map<string, Waiting>();
const running = new Map<string, Promise<void>>();

/** Run `reply` for conversation `key` once it has been quiet for a moment. */
export function afterQuiet(
  key: string,
  reply: () => Promise<void>,
  opts: { quietMs?: number; maxWaitMs?: number; now?: number } = {}
): void {
  const quiet = opts.quietMs ?? QUIET_MS;
  const max = opts.maxWaitMs ?? MAX_WAIT_MS;
  const now = opts.now ?? Date.now();
  const before = waiting.get(key);
  if (before) clearTimeout(before.timer);
  const firstAt = before?.firstAt ?? now;
  const delay = Math.max(0, Math.min(quiet, firstAt + max - now));

  const timer = setTimeout(() => {
    waiting.delete(key);
    const previous = running.get(key) ?? Promise.resolve();
    const next = previous
      .then(reply)
      .catch((err) => console.error(`[CHAT] Reply for ${key} failed:`, err));
    running.set(key, next);
    void next.finally(() => {
      if (running.get(key) === next) running.delete(key);
    });
  }, delay);
  waiting.set(key, { timer, firstAt });
}

/** Whether a reply is waiting or being written for `key`: for the restart check. */
export function isHandled(key: string): boolean {
  return waiting.has(key) || running.has(key);
}
