"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * The last resort, for when the app's frame itself (the root layout) fails.
 * It replaces the whole page, globals.css included, so its styles are inline:
 * the Sage palette's background, ink and primary.
 */

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          background: "#fbfbf4",
          color: "#2d331a",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <title>Something went wrong</title>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>The CRM didn&apos;t load</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, margin: "0 0 20px", color: "#5b6635" }}>
            Nothing you saved is lost. Try again, and if it keeps happening, tell us what you were doing.
          </p>
          <button
            onClick={() => unstable_retry()}
            style={{
              background: "#5b6635",
              color: "#fbfbf4",
              border: 0,
              borderRadius: 8,
              padding: "10px 18px",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ fontSize: 12, marginTop: 16, color: "#5b6635" }}>Reference {error.digest}</p>
          )}
        </div>
      </body>
    </html>
  );
}
