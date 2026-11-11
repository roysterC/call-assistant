/**
 * The address links in emails start with. In production, the app's public
 * address (AUTH_URL): behind the server's proxy a request can arrive as
 * http://localhost:3000, which would be no use in someone's inbox. In
 * development, wherever the request came from, so a local link opens the
 * local app.
 */
export function linkOrigin(requestOrigin: string): string {
  if (process.env.NODE_ENV === "production") {
    try {
      return new URL(process.env.AUTH_URL ?? "").origin;
    } catch {
      // Fall through: better a link that may work than none.
    }
  }
  return requestOrigin;
}
