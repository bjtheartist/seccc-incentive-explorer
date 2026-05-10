import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const [scheme, salt, hash] = storedHash.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;

  const expected = Buffer.from(hash, "hex");
  const derived = (await scrypt(password, salt, expected.length)) as Buffer;

  return (
    expected.length === derived.length && timingSafeEqual(expected, derived)
  );
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isStrongEnoughPassword(password: string): boolean {
  return password.length >= 8;
}
