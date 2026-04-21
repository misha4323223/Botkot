import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import type { Request, Response, NextFunction } from "express";

const COOKIE_NAME = "trader_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSecret(): string {
  return process.env.APP_ENCRYPTION_KEY || process.env.APP_PASSWORD || "dev-fallback-secret";
}

function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

export function createSessionToken(): string {
  const expiry = Date.now() + SESSION_TTL_MS;
  const nonce = randomBytes(8).toString("base64url");
  const payload = `${expiry}.${nonce}`;
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expiry, nonce, sig] = parts;
  const expected = sign(`${expiry}.${nonce}`);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }
  const exp = Number(expiry);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  return true;
}

export function checkPassword(provided: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function setSessionCookie(res: Response, token: string): void {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function readSessionCookie(req: Request): string | undefined {
  // cookie-parser populates req.cookies
  return (req as unknown as { cookies?: Record<string, string> }).cookies?.[COOKIE_NAME];
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // If no password configured, auth is disabled (dev mode)
  if (!process.env.APP_PASSWORD) {
    next();
    return;
  }
  const token = readSessionCookie(req);
  if (verifySessionToken(token)) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
}
