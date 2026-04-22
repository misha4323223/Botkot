import { logger } from "./logger";

export interface NewsItem {
  source: "finam" | "moex";
  title: string;
  publishedAt: string;
  url?: string;
}

interface CacheEntry {
  ts: number;
  items: NewsItem[];
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

/**
 * Russian aliases per ticker for substring matching in news titles.
 * Add aliases here when expanding the watchlist.
 */
const TICKER_ALIASES: Record<string, string[]> = {
  SBER: ["sber", "сбер", "сбербанк"],
  SBERP: ["sberp", "сбер прив", "сбербанк прив"],
  GAZP: ["gazp", "газпром"],
  LKOH: ["lkoh", "лукойл"],
  ROSN: ["rosn", "роснефть"],
  YDEX: ["ydex", "яндекс", "yandex"],
  VTBR: ["vtbr", "втб"],
  RUAL: ["rual", "русал"],
  SVCB: ["svcb", "совком", "совкомбанк"],
  MGNT: ["mgnt", "магнит"],
  TATN: ["tatn", "татнефть"],
  NVTK: ["nvtk", "новатэк"],
  GMKN: ["gmkn", "норникель", "норильск"],
  PLZL: ["plzl", "полюс"],
  CHMF: ["chmf", "северсталь"],
  NLMK: ["nlmk", "нлмк"],
  MTSS: ["mtss", "мтс"],
  AFLT: ["aflt", "аэрофлот"],
  ALRS: ["alrs", "алроса"],
  POSI: ["posi", "позитив"],
  OZON: ["ozon", "озон"],
  TCSG: ["tcsg", "тинькофф", "т-банк", "т банк"],
  T: ["т-банк", "т банк", "тинькофф"],
  FIVE: ["five", "x5", "пятёрочка", "перекрёсток"],
  MOEX: ["moex", "мосбиржа", "московская биржа"],
  PIKK: ["pikk", "пик"],
  LSRG: ["lsrg", "лср"],
  SMLT: ["smlt", "самолет", "самолёт"],
  PHOR: ["phor", "фосагро"],
  AKRN: ["akrn", "акрон"],
  MAGN: ["magn", "ммк", "магнитогорск"],
  RTKM: ["rtkm", "ростелеком"],
  FEES: ["fees", "фск", "россети"],
  HYDR: ["hydr", "русгидро"],
  IRAO: ["irao", "интер рао", "интеррао"],
};

let finamCache: CacheEntry | null = null;
let moexCache: CacheEntry | null = null;
const tickerCache = new Map<string, CacheEntry>();

async function fetchWithTimeout(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ai-trader-bot/1.0)" },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    logger.debug({ url, err }, "news fetch failed");
    return null;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, " ");
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1");
}

function parseFinamRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const dateMatch = block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    const linkMatch = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const rawTitle = titleMatch ? stripCdata(titleMatch[1]).trim() : "";
    if (!rawTitle) continue;
    const title = decodeEntities(rawTitle).replace(/\s+/g, " ").trim();
    const dateStr = dateMatch ? stripCdata(dateMatch[1]).trim() : "";
    const published = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();
    items.push({
      source: "finam",
      title,
      publishedAt: published,
      url: linkMatch ? stripCdata(linkMatch[1]).trim() : undefined,
    });
  }
  return items;
}

async function fetchFinam(): Promise<NewsItem[]> {
  if (finamCache && Date.now() - finamCache.ts < CACHE_TTL_MS) return finamCache.items;
  const xml = await fetchWithTimeout("https://www.finam.ru/analysis/conews/rsspoint/");
  if (!xml) return finamCache?.items ?? [];
  const items = parseFinamRss(xml);
  finamCache = { ts: Date.now(), items };
  return items;
}

interface MoexJson {
  sitenews?: { columns?: string[]; data?: unknown[][] };
}

async function fetchMoexSitenews(): Promise<NewsItem[]> {
  if (moexCache && Date.now() - moexCache.ts < CACHE_TTL_MS) return moexCache.items;
  const txt = await fetchWithTimeout("https://iss.moex.com/iss/sitenews.json?lang=ru&limit=50");
  if (!txt) return moexCache?.items ?? [];
  try {
    const j = JSON.parse(txt) as MoexJson;
    const cols = j.sitenews?.columns ?? [];
    const rows = j.sitenews?.data ?? [];
    const idxTitle = cols.indexOf("title");
    const idxDate = cols.indexOf("published_at");
    const items: NewsItem[] = rows.map(r => ({
      source: "moex" as const,
      title: decodeEntities(String(r[idxTitle] ?? "")).replace(/\s+/g, " ").trim(),
      publishedAt: String(r[idxDate] ?? "").replace(" ", "T") + "Z",
    })).filter(i => i.title);
    moexCache = { ts: Date.now(), items };
    return items;
  } catch {
    return moexCache?.items ?? [];
  }
}

function getAliases(ticker: string): string[] {
  const t = ticker.toUpperCase();
  const list = TICKER_ALIASES[t] ?? [];
  return [t.toLowerCase(), ...list];
}

function matchesTicker(title: string, aliases: string[]): boolean {
  const lower = title.toLowerCase();
  return aliases.some(a => lower.includes(a));
}

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_OUT = 6;

/**
 * Fetch up to ~6 recent news items relevant to a ticker.
 * Sources:
 *   - Finam company news RSS (full feed, filtered by ticker + Russian aliases)
 *   - MOEX sitenews (regulatory: trading halts, risk parameters, listings — filtered the same way)
 * Drops items older than 7 days. Cached per ticker for CACHE_TTL_MS.
 * Always returns within ~5s; on errors returns whatever's cached or [].
 */
export async function getNewsForTicker(ticker: string): Promise<NewsItem[]> {
  const key = ticker.toUpperCase();
  const cached = tickerCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.items;

  const aliases = getAliases(key);
  const [finam, moex] = await Promise.all([fetchFinam(), fetchMoexSitenews()]);
  const cutoff = Date.now() - MAX_AGE_MS;

  const merged = [...finam, ...moex]
    .filter(n => matchesTicker(n.title, aliases))
    .filter(n => {
      const t = Date.parse(n.publishedAt);
      return Number.isFinite(t) ? t >= cutoff : true;
    })
    .sort((a, b) => (b.publishedAt > a.publishedAt ? 1 : -1))
    .slice(0, MAX_OUT);

  tickerCache.set(key, { ts: Date.now(), items: merged });
  return merged;
}

export function formatNewsForPrompt(news: NewsItem[]): string {
  if (news.length === 0) return "Свежих новостей по бумаге за последние 7 дней не найдено.";
  return news
    .map(n => {
      const dt = n.publishedAt ? n.publishedAt.replace("T", " ").slice(0, 16) : "";
      const src = n.source === "moex" ? "MOEX" : "Финам";
      return `  • [${dt} ${src}] ${n.title}`;
    })
    .join("\n");
}
