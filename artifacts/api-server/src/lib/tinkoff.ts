import { logger } from "./logger";

const PROD_BASE = "https://invest-public-api.tinkoff.ru/rest";
const SANDBOX_BASE = "https://sandbox-invest-public-api.tinkoff.ru/rest";

export function getTinkoffBase(isSandbox: boolean): string {
  return isSandbox ? SANDBOX_BASE : PROD_BASE;
}

export async function tinkoffGet<T>(
  path: string,
  token: string,
  isSandbox: boolean
): Promise<T> {
  const base = getTinkoffBase(isSandbox);
  const url = `${base}${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error({ status: res.status, path, text }, "Tinkoff API error");
    throw new Error(`Tinkoff API error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

export async function tinkoffPost<T>(
  path: string,
  body: unknown,
  token: string,
  isSandbox: boolean
): Promise<T> {
  const base = getTinkoffBase(isSandbox);
  const url = `${base}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error({ status: res.status, path, text }, "Tinkoff API error");
    throw new Error(`Tinkoff API error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

export function parseMoneyValue(mv: { units?: string; nano?: number; currency?: string } | undefined | null): number {
  if (!mv) return 0;
  const units = Number(mv.units ?? 0);
  const nano = mv.nano ?? 0;
  return units + nano / 1e9;
}

export function parseQuotation(q: { units?: string; nano?: number } | undefined | null): number {
  if (!q) return 0;
  const units = Number(q.units ?? 0);
  const nano = q.nano ?? 0;
  return units + nano / 1e9;
}
