import type { Outcome, Pick, Probs } from "../types";

/** Spor Toto'da bir kuponda oynanabilecek en fazla kolon (Bilyoner yardım sayfası, 2025-03). */
export const MAX_COLUMNS_PER_COUPON = 2500;

export function pickOutcomes(pick: Pick): Outcome[] {
  return pick.split("") as Outcome[];
}

export function pickSize(pick: Pick): 1 | 2 | 3 {
  return pick.length as 1 | 2 | 3;
}

/** "1","X","2" kümesinden kanonik tercih adını üretir (ör. {"2","1"} -> "12"). */
export function toPick(outcomes: Outcome[]): Pick {
  const set = new Set(outcomes);
  if (set.size === 0) throw new Error("Boş tercih olamaz");
  const order: Outcome[] = ["1", "X", "2"];
  return order.filter((o) => set.has(o)).join("") as Pick;
}

export interface PickCounts {
  singles: number;
  doubles: number;
  triples: number;
}

export function countPicks(picks: Pick[]): PickCounts {
  const c = { singles: 0, doubles: 0, triples: 0 };
  for (const p of picks) {
    const s = pickSize(p);
    if (s === 1) c.singles++;
    else if (s === 2) c.doubles++;
    else c.triples++;
  }
  return c;
}

/** Kolon sayısı = 2^(çifte) × 3^(üçlü). */
export function columnCount(doubles: number, triples: number): number {
  if (!Number.isInteger(doubles) || !Number.isInteger(triples) || doubles < 0 || triples < 0) {
    throw new Error("Çifte ve üçlü sayıları negatif olmayan tam sayı olmalı");
  }
  return 2 ** doubles * 3 ** triples;
}

export function columnsForPicks(picks: Pick[]): number {
  const c = countPicks(picks);
  return columnCount(c.doubles, c.triples);
}

/** Kuruş hassasiyetinde kupon bedeli = kolon × kolon fiyatı. */
export function couponCost(columns: number, columnPrice: number): number {
  if (columnPrice < 0) throw new Error("Kolon fiyatı negatif olamaz");
  return Math.round(columns * columnPrice * 100) / 100;
}

export interface ManualCalcInput {
  singles: number;
  doubles: number;
  triples: number;
  columnPrice: number;
  budget?: number;
  totalMatches?: number;
}

export interface ManualCalcResult {
  columns: number;
  cost: number;
  withinBudget: boolean | null;
  withinColumnLimit: boolean;
  errors: string[];
}

/** Kullanıcının elle girdiği tekli/çifte/üçlü sayılarından kolon ve maliyet hesabı. */
export function manualCalc(input: ManualCalcInput): ManualCalcResult {
  const total = input.totalMatches ?? 15;
  const errors: string[] = [];
  const { singles, doubles, triples } = input;
  for (const [k, v] of Object.entries({ singles, doubles, triples })) {
    if (!Number.isInteger(v) || v < 0) errors.push(`${k} negatif olmayan tam sayı olmalı`);
  }
  if (singles + doubles + triples !== total) {
    errors.push(`Tekli + çifte + üçlü toplamı ${total} olmalı (şu an ${singles + doubles + triples})`);
  }
  if (!(input.columnPrice > 0)) errors.push("Kolon fiyatı sıfırdan büyük olmalı");
  if (errors.length) return { columns: 0, cost: 0, withinBudget: null, withinColumnLimit: false, errors };
  const columns = columnCount(doubles, triples);
  const cost = couponCost(columns, input.columnPrice);
  return {
    columns,
    cost,
    withinBudget: input.budget === undefined ? null : cost <= input.budget + 1e-9,
    withinColumnLimit: columns <= MAX_COLUMNS_PER_COUPON,
    errors,
  };
}

/** Bir tercihin, maç olasılıklarına göre tutma olasılığı. */
export function pickCoverage(pick: Pick, probs: Probs): number {
  let s = 0;
  for (const o of pickOutcomes(pick)) s += o === "1" ? probs.p1 : o === "X" ? probs.pX : probs.p2;
  return Math.min(1, s);
}

export function pickHits(pick: Pick, result: Outcome): boolean {
  return pickOutcomes(pick).includes(result);
}

/**
 * Sistemli kuponda en iyi kolonun doğru sayısı = tercihi tutan maç sayısı.
 * Maçlar bağımsız kabul edilerek bu sayının dağılımı (Poisson-binom) hesaplanır.
 * dist[k] = tam k maçın tutma olasılığı.
 */
export function hitDistribution(coverages: number[]): number[] {
  let dist = [1];
  for (const q of coverages) {
    const next = new Array(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) {
      next[k] += dist[k] * (1 - q);
      next[k + 1] += dist[k] * q;
    }
    dist = next;
  }
  return dist;
}

export function probAtLeast(dist: number[], k: number): number {
  let s = 0;
  for (let i = k; i < dist.length; i++) s += dist[i];
  return Math.min(1, s);
}
