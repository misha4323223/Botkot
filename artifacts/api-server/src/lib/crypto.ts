import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";
import { logger } from "./logger";

const ALGO = "aes-256-gcm";
const PREFIX = "enc:v1:";

function getKey(): Buffer | null {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) return null;
  // Accept any length: derive 32-byte key via SHA-256
  return createHash("sha256").update(raw).digest();
}

export function encryptString(plain: string): string {
  if (!plain) return plain;
  if (plain.startsWith(PREFIX)) return plain;
  const key = getKey();
  if (!key) {
    logger.warn("APP_ENCRYPTION_KEY not set — token stored in plaintext");
    return plain;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptString(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith(PREFIX)) return value; // legacy plaintext
  const key = getKey();
  if (!key) {
    logger.error("APP_ENCRYPTION_KEY not set — cannot decrypt token");
    return null;
  }
  try {
    const buf = Buffer.from(value.slice(PREFIX.length), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (err) {
    logger.error({ err }, "Failed to decrypt token");
    return null;
  }
}
