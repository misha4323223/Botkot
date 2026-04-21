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
