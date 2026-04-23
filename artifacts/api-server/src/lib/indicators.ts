export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time?: string;
}

function sma(values: number[], period: number): number {
  if (values.length < period) return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

export function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgG = gains / period;
  const avgL = losses / period;
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

export function macd(closes: number[]): { macd: number; signal: number; histogram: number } {
  if (closes.length < 35) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) macdLine.push(ema12[i] - ema26[i]);
  const signalLine = ema(macdLine.slice(-50), 9);
  const m = macdLine[macdLine.length - 1];
  const s = signalLine[signalLine.length - 1];
  return { macd: m, signal: s, histogram: m - s };
}

export function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    );
    trs.push(tr);
  }
  return sma(trs, period);
}

export function bollinger(closes: number[], period = 20, mult = 2): { upper: number; middle: number; lower: number } {
  if (closes.length < period) {
    const m = sma(closes, closes.length);
    return { upper: m, middle: m, lower: m };
  }
  const slice = closes.slice(-period);
  const m = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((acc, v) => acc + (v - m) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: m + mult * sd, middle: m, lower: m - mult * sd };
}

export function volumeSpike(volumes: number[], lookback = 20): number {
  if (volumes.length === 0) return 1;
  const avg = sma(volumes.slice(-lookback - 1, -1), Math.min(lookback, volumes.length - 1));
  const last = volumes[volumes.length - 1];
  return avg > 0 ? last / avg : 1;
}

export interface IndicatorSnapshot {
  rsi14: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  atr14: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  ma5: number;
  ma10: number;
  ma20: number;
  volumeSpikeRatio: number;
  trend: "восходящий" | "нисходящий" | "боковой";
  changePct: number;
  rangeMin: number;
  rangeMax: number;
  lastClose: number;
}

export function computeSnapshot(candles: Candle[]): IndicatorSnapshot {
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const last = closes[closes.length - 1] ?? 0;
  const first = closes[0] ?? 0;
  const ma5v = sma(closes, 5);
  const ma10v = sma(closes, 10);
  const ma20v = sma(closes, 20);
  const trend: IndicatorSnapshot["trend"] =
    last > ma5v && ma5v > ma10v ? "восходящий" :
    last < ma5v && ma5v < ma10v ? "нисходящий" : "боковой";
  const macdRes = macd(closes);
  const bb = bollinger(closes);
  return {
    rsi14: rsi(closes),
    macd: macdRes.macd,
    macdSignal: macdRes.signal,
    macdHistogram: macdRes.histogram,
    atr14: atr(candles),
    bbUpper: bb.upper,
    bbMiddle: bb.middle,
    bbLower: bb.lower,
    ma5: ma5v,
    ma10: ma10v,
    ma20: ma20v,
    volumeSpikeRatio: volumeSpike(volumes),
    trend,
    changePct: first > 0 ? ((last - first) / first) * 100 : 0,
    rangeMin: closes.length ? Math.min(...closes) : 0,
    rangeMax: closes.length ? Math.max(...closes) : 0,
    lastClose: last,
  };
}

export interface TapeSignals {
  shortMomentumPct: number;     // last 3 hourly bars vs prior 3
  velocityPctPerBar: number;     // avg per-bar % change last 3 bars
  volumeBurstRatio: number;      // last 3 bars vol vs avg of prior 10
  bodyToRangePct: number;        // |close-open|/(high-low) of last bar — conviction
  consecutiveSameDir: number;    // signed: +N up, -N down
}

/**
 * Tape-like microstructure signals derived from short timeframe candles.
 * These approximate what a discretionary trader feels from the tape:
 * - Is price accelerating or stalling?
 * - Is volume confirming or fading?
 * - Are bars decisive (full-body) or indecisive (long wicks)?
 * Pass ~5-20 hourly candles. Returns null if too few.
 */
export function computeTapeSignals(candles: Candle[]): TapeSignals | null {
  if (candles.length < 7) return null;
  const recent = candles.slice(-3);
  const prior = candles.slice(-6, -3);
  const recentClose = recent[recent.length - 1].close;
  const priorClose = prior[prior.length - 1].close;
  const startClose = prior[0].open;

  const shortMomentumPct = priorClose > 0 ? ((recentClose - priorClose) / priorClose) * 100 : 0;
  const velocityPctPerBar = startClose > 0 ? (((recentClose - startClose) / startClose) * 100) / 6 : 0;

  const recentVol = recent.reduce((a, c) => a + c.volume, 0) / 3;
  const olderTen = candles.slice(-13, -3);
  const olderAvgVol = olderTen.length > 0
    ? olderTen.reduce((a, c) => a + c.volume, 0) / olderTen.length
    : recentVol;
  const volumeBurstRatio = olderAvgVol > 0 ? recentVol / olderAvgVol : 1;

  const lastBar = candles[candles.length - 1];
  const range = Math.max(0.0001, lastBar.high - lastBar.low);
  const body = Math.abs(lastBar.close - lastBar.open);
  const bodyToRangePct = (body / range) * 100;

  // Count consecutive same-direction bars from the end
  let consecutiveSameDir = 0;
  const lastDir = Math.sign(lastBar.close - lastBar.open);
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    if (Math.sign(c.close - c.open) === lastDir && lastDir !== 0) consecutiveSameDir++;
    else break;
  }
  consecutiveSameDir *= lastDir;

  return { shortMomentumPct, velocityPctPerBar, volumeBurstRatio, bodyToRangePct, consecutiveSameDir };
}

export function formatTapeSignals(t: TapeSignals | null): string {
  if (!t) return "Тейп-сигналы недоступны (мало часовых свечей).";
  const dirArrow = t.shortMomentumPct > 0.3 ? "↑" : t.shortMomentumPct < -0.3 ? "↓" : "→";
  const burstLabel = t.volumeBurstRatio > 2 ? "ВСПЛЕСК" : t.volumeBurstRatio > 1.3 ? "повышенный" : t.volumeBurstRatio < 0.6 ? "затухание" : "нормальный";
  const convictionLabel = t.bodyToRangePct > 70 ? "решительный (full body)" : t.bodyToRangePct < 30 ? "нерешительный (длинные тени)" : "умеренный";
  const streakLabel = Math.abs(t.consecutiveSameDir) >= 3
    ? `серия ${Math.abs(t.consecutiveSameDir)} баров ${t.consecutiveSameDir > 0 ? "вверх" : "вниз"}`
    : "без устойчивой серии";
  return `Краткосрочное движение: ${dirArrow} ${t.shortMomentumPct >= 0 ? "+" : ""}${t.shortMomentumPct.toFixed(2)}% за 3 бара (скорость ${t.velocityPctPerBar.toFixed(2)}%/бар)
Объём посл.3 баров: ×${t.volumeBurstRatio.toFixed(1)} от среднего → ${burstLabel}
Последний бар: тело ${t.bodyToRangePct.toFixed(0)}% диапазона → ${convictionLabel}
Импульс: ${streakLabel}`;
}

export function interpretSnapshot(s: IndicatorSnapshot): string[] {
  const notes: string[] = [];
  if (s.rsi14 >= 70) notes.push(`RSI=${s.rsi14.toFixed(0)} → перекупленность (риск отката вниз)`);
  else if (s.rsi14 <= 30) notes.push(`RSI=${s.rsi14.toFixed(0)} → перепроданность (возможен отскок)`);
  else notes.push(`RSI=${s.rsi14.toFixed(0)} → нейтрально`);
  if (s.macdHistogram > 0 && s.macd > s.macdSignal) notes.push(`MACD: бычий сигнал (гист ${s.macdHistogram.toFixed(2)})`);
  else if (s.macdHistogram < 0 && s.macd < s.macdSignal) notes.push(`MACD: медвежий сигнал (гист ${s.macdHistogram.toFixed(2)})`);
  else notes.push(`MACD: смешанный (${s.macd.toFixed(2)} vs сигнал ${s.macdSignal.toFixed(2)})`);
  if (s.lastClose > s.bbUpper) notes.push(`Цена выше верхней BB (${s.bbUpper.toFixed(2)}) → перегрев`);
  else if (s.lastClose < s.bbLower) notes.push(`Цена ниже нижней BB (${s.bbLower.toFixed(2)}) → перепродажа`);
  if (s.volumeSpikeRatio >= 2) notes.push(`Всплеск объёма ×${s.volumeSpikeRatio.toFixed(1)} от среднего → подтверждение движения`);
  else if (s.volumeSpikeRatio < 0.5) notes.push(`Объём ×${s.volumeSpikeRatio.toFixed(1)} → слабое участие`);
  notes.push(`ATR(14)=${s.atr14.toFixed(2)} ₽ — ожидаемая дневная волатильность`);
  return notes;
}
