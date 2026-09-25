import { randomInt } from "crypto";
import bcrypt from "bcryptjs";

const ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function validatePassword(plain: string): string | null {
  if (!plain || plain.length < 8) {
    return "Password must be at least 8 characters";
  }
  return null;
}

// No 0/O, 1/l/I: a temporary password is read off one screen and typed into
// another, often a phone.
const TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * A temporary password for a new login, shown once to the person creating it.
 * Twelve characters from a 55-letter alphabet, grouped for reading aloud.
 */
export function temporaryPassword(): string {
  const chars = Array.from({ length: 12 }, () => TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
}
