/**
 * Runs once when the server starts (Next's instrumentation hook): turns on
 * error reporting, passes Sentry every error a request throws, and answers
 * any chat a restart left unanswered.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await import("./sentry.server.config");
  // Chats a restart left unanswered (chat-recovery.ts), once the server is up.
  setTimeout(() => {
    import("./lib/chat-recovery")
      .then(({ answerUnansweredChats }) => answerUnansweredChats())
      .catch((err) => console.error("[CHAT] Restart check failed:", err));
  }, 15_000).unref?.();
}

export const onRequestError = Sentry.captureRequestError;
