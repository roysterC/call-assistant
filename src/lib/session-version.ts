/**
 * Whether a login cookie was issued after the user's last password change or
 * reset (User.sessionVersion). Cookies from before sessionVersion existed
 * carry none and count as 0.
 */
export function isCurrentSession(
  cookieVersion: number | undefined,
  userVersion: number
): boolean {
  return (cookieVersion ?? 0) === userVersion;
}
