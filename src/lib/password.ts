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
