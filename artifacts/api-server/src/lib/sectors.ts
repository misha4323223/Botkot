/**
 * Hardcoded MOEX ticker → sector mapping for top liquid Russian shares.
 * Used to detect portfolio over-concentration in a single sector and refuse
 * new buys when exposure would exceed the cap.
 */

export type Sector =
  | "нефтегаз"
  | "банки"
  | "металлургия"
  | "удобрения"
  | "ритейл"
  | "энергетика"
  | "телеком"
  | "транспорт"
  | "IT"
  | "девелопмент"
  | "потребительский"
  | "прочее";

const TICKER_SECTOR: Record<string, Sector> = {
  // Нефть/газ
  GAZP: "нефтегаз", LKOH: "нефтегаз", ROSN: "нефтегаз", NVTK: "нефтегаз",
  TATN: "нефтегаз", TATNP: "нефтегаз", SNGS: "нефтегаз", SNGSP: "нефтегаз",
  BANE: "нефтегаз", BANEP: "нефтегаз", TRNFP: "нефтегаз", SIBN: "нефтегаз",
  // Банки и финансы
  SBER: "банки", SBERP: "банки", VTBR: "банки", TCSG: "банки", T: "банки",
  MOEX: "банки", BSPB: "банки", BSPBP: "банки", SVCB: "банки", RENI: "банки",
  CBOM: "банки",
  // Металлургия и горнодобыча
  GMKN: "металлургия", NLMK: "металлургия", CHMF: "металлургия",
  MAGN: "металлургия", PLZL: "металлургия", POLY: "металлургия",
  RUAL: "металлургия", ALRS: "металлургия", MTLR: "металлургия",
  MTLRP: "металлургия", VSMO: "металлургия", SELG: "металлургия",
  // Удобрения и химия
  PHOR: "удобрения", AKRN: "удобрения", KAZT: "удобрения",
  // Ритейл и потребительский
  MGNT: "ритейл", FIVE: "ритейл", LENT: "ритейл", FIXP: "ритейл",
  OZON: "ритейл", DSKY: "ритейл", BELU: "потребительский",
  ABRD: "потребительский", AGRO: "потребительский",
  // Энергетика
  IRAO: "энергетика", FEES: "энергетика", HYDR: "энергетика",
  RSTI: "энергетика", UPRO: "энергетика", OGKB: "энергетика",
  MSNG: "энергетика", TGKA: "энергетика", TGKB: "энергетика",
  ENRU: "энергетика", LSNG: "энергетика", LSNGP: "энергетика",
  // Телеком
  MTSS: "телеком", RTKM: "телеком", RTKMP: "телеком", MGTS: "телеком",
  MGTSP: "телеком",
  // Транспорт
  AFLT: "транспорт", FLOT: "транспорт", NMTP: "транспорт",
  TRMK: "транспорт", GLTR: "транспорт",
  // IT
  YDEX: "IT", YNDX: "IT", VKCO: "IT", POSI: "IT", HHRU: "IT",
  CIAN: "IT", DIAS: "IT", ASTR: "IT",
  // Девелопмент
  PIKK: "девелопмент", LSRG: "девелопмент", SMLT: "девелопмент",
  ETLN: "девелопмент",
};

export function getSector(ticker: string): Sector {
  return TICKER_SECTOR[ticker.toUpperCase()] ?? "прочее";
}

export interface PositionLite {
  ticker: string;
  curr: number;
  qty: number;
}

export interface SectorExposure {
  sector: Sector;
  totalRub: number;
  pctOfPortfolio: number;
  tickers: string[];
}

/**
 * Compute current sector breakdown of open positions.
 * `cashRub` is added so percentages are vs total equity, not just invested.
 */
export function computeSectorExposure(
  positions: PositionLite[],
  cashRub: number,
): SectorExposure[] {
  const map = new Map<Sector, { total: number; tickers: string[] }>();
  for (const p of positions) {
    const value = p.curr * p.qty;
    if (value <= 0) continue;
    const sector = getSector(p.ticker);
    const cur = map.get(sector) ?? { total: 0, tickers: [] };
    cur.total += value;
    if (!cur.tickers.includes(p.ticker)) cur.tickers.push(p.ticker);
    map.set(sector, cur);
  }
  const investedTotal = Array.from(map.values()).reduce((a, v) => a + v.total, 0);
  const equity = investedTotal + Math.max(0, cashRub);
  return Array.from(map.entries()).map(([sector, v]) => ({
    sector,
    totalRub: v.total,
    pctOfPortfolio: equity > 0 ? (v.total / equity) * 100 : 0,
    tickers: v.tickers.sort(),
  })).sort((a, b) => b.totalRub - a.totalRub);
}

export function formatSectorExposureForPrompt(exp: SectorExposure[]): string {
  if (exp.length === 0) return "Распределение по секторам: открытых позиций нет.";
  return exp.map(e =>
    `  • ${e.sector}: ${e.pctOfPortfolio.toFixed(1)}% капитала (${e.totalRub.toFixed(0)}₽, ${e.tickers.join(", ")})`
  ).join("\n");
}

/**
 * Returns a non-empty string if buying `ticker` for `addRub` would push its
 * sector exposure above `capPct` of total equity. Empty string = ok.
 */
export function checkSectorCap(args: {
  ticker: string;
  addRub: number;
  exposure: SectorExposure[];
  cashRub: number;
  capPct: number;
}): string {
  const sector = getSector(args.ticker);
  const cur = args.exposure.find(e => e.sector === sector);
  const investedTotal = args.exposure.reduce((a, v) => a + v.totalRub, 0);
  const equity = investedTotal + Math.max(0, args.cashRub);
  if (equity <= 0) return "";
  const newSectorTotal = (cur?.totalRub ?? 0) + args.addRub;
  const newPct = (newSectorTotal / equity) * 100;
  if (newPct > args.capPct) {
    return `сектор «${sector}» составит ${newPct.toFixed(0)}% капитала (лимит ${args.capPct}%) — перекос`;
  }
  return "";
}
