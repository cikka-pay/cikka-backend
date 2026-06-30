import crypto from "crypto";

// Generates a human-readable login id like "CIKKA-7F3K2Q".
export function generateLoginId(): string {
  const code = crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
  return `CIKKA-${code}`;
}

// Generates a random password. Shown to the operator exactly once at creation time —
// never logged again, never stored anywhere but the bcrypt hash.
export function generatePassword(length = 12): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  return Array.from(crypto.randomBytes(length))
    .map((byte) => alphabet[byte % alphabet.length])
    .join("");
}
