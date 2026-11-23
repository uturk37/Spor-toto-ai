import type { Pick, Probs } from "../types";
import { ALL_PICKS } from "../types";
import {
  MAX_COLUMNS_PER_COUPON,
  columnCount,
  couponCost,
  hitDistribution,
  pickCoverage,
  pickSize,
  probAtLeast,
} from "./math";

export interface OptimizeMatchInput {
  probs: Probs;
  /** Kullanıcı bu maçın tercihini kilitlediyse optimizasyon onu değiştirmez. */
  locked?: Pick;
  /** İzin verilen tercih boyutları (ör. sadece tekli/çifte). Varsayılan: hepsi. */
  allowedSizes?: Array<1 | 2 | 3>;
}

export interface OptimizeInput {
  matches: OptimizeMatchInput[];
  columnPrice: number;
  budget: number;
  /** Ek kolon sınırı (ör. ekonomik kupon için). */
  maxColumns?: number;
}

export interface OptimizedCoupon {
  picks: Pick[];
  coverages: number[];
  columns: number;
  cost: number;
  doubles: number;
  triples: number;
  singles: number;
  /** 15 maçın tamamının tercih içinde kalma olasılığı (maçlar bağımsız varsayımıyla). */
  pAll: number;
  pAtLeast14: number;
  pAtLeast13: number;
  pAtLeast12: number;
  expectedHits: number;
}

export class InfeasibleCouponError extends Error {}

function bestPickOfSize(probs: Probs, size: 1 | 2 | 3): { pick: Pick; cov: number } {
  let best: { pick: Pick; cov: number } | null = null;
  for (const p of ALL_PICKS) {
    if (pickSize(p) !== size) continue;
    const cov = pickCoverage(p, probs);
    if (!best || cov > best.cov + 1e-12) best = { pick: p, cov };
  }
  return best!;
}

/**
 * Bütçe ve kolon sınırı içinde, 15 maçın tamamını tutturma olasılığını
 * (Π tercih kapsama olasılığı) en yükseğe çıkaran tercihleri bulur.
 *
 * Kolon sayısı yalnızca (çifte sayısı d, üçlü sayısı t) ile belirlendiği için
 * durum uzayı küçüktür: 2^d·3^t ≤ 2500 ⇒ d ≤ 11, t ≤ 7. Dinamik programlama
 * tüm kombinasyonları kesin olarak tarar; sezgisel değildir.
 */
export function optimizeCoupon(input: OptimizeInput): OptimizedCoupon {
  const { matches, columnPrice, budget } = input;
  if (!(columnPrice > 0)) throw new Error("Kolon fiyatı sıfırdan büyük olmalı");
  const budgetCols = Math.floor((budget + 1e-9) / columnPrice);
  const limit = Math.min(budgetCols, MAX_COLUMNS_PER_COUPON, input.maxColumns ?? Infinity);
  if (limit < 1) throw new InfeasibleCouponError("Bütçe tek kolonluk kupon için bile yetmiyor");

  const maxD = Math.floor(Math.log2(limit) + 1e-9);
  const maxT = Math.floor(Math.log(limit) / Math.log(3) + 1e-9);
  const feasible = (d: number, t: number) => d <= maxD && t <= maxT && columnCount(d, t) <= limit;

  type Cell = { score: number; prev: [number, number] | null; pick: Pick | null } | null;
  const key = (d: number, t: number) => d * (maxT + 1) + t;
  let layer: Cell[] = new Array((maxD + 1) * (maxT + 1)).fill(null);
  layer[key(0, 0)] = { score: 0, prev: null, pick: null };
  const history: Cell[][] = [];

  for (const m of matches) {
    const options: Array<{ pick: Pick; cov: number; size: 1 | 2 | 3 }> = [];
    if (m.locked) {
      options.push({ pick: m.locked, cov: pickCoverage(m.locked, m.probs), size: pickSize(m.locked) });
    } else {
      for (const size of m.allowedSizes ?? [1, 2, 3]) {
        const b = bestPickOfSize(m.probs, size);
        options.push({ ...b, size });
      }
    }
    const next: Cell[] = new Array(layer.length).fill(null);
    for (let d = 0; d <= maxD; d++) {
      for (let t = 0; t <= maxT; t++) {
        const cur = layer[key(d, t)];
        if (!cur) continue;
        for (const o of options) {
          const nd = d + (o.size === 2 ? 1 : 0);
          const nt = t + (o.size === 3 ? 1 : 0);
          if (!feasible(nd, nt)) continue;
          const score = cur.score + Math.log(Math.max(o.cov, 1e-12));
          const ex = next[key(nd, nt)];
          if (!ex || score > ex.score + 1e-12) next[key(nd, nt)] = { score, prev: [d, t], pick: o.pick };
        }
      }
    }
    history.push(next);
    layer = next;
  }

  // En iyi son durumu seç; eşitlikte daha az kolonu tercih et.
  let best: { d: number; t: number; score: number; cols: number } | null = null;
  for (let d = 0; d <= maxD; d++) {
    for (let t = 0; t <= maxT; t++) {
      const c = layer[key(d, t)];
      if (!c) continue;
      const cols = columnCount(d, t);
      if (!best || c.score > best.score + 1e-9 || (Math.abs(c.score - best.score) <= 1e-9 && cols < best.cols)) {
        best = { d, t, score: c.score, cols };
      }
    }
  }
  if (!best) throw new InfeasibleCouponError("Kilitli tercihler bütçeyi veya kolon sınırını aşıyor");

  const picks: Pick[] = new Array(matches.length);
  let d = best.d;
  let t = best.t;
  for (let i = matches.length - 1; i >= 0; i--) {
    const cell = history[i][key(d, t)]!;
    picks[i] = cell.pick!;
    [d, t] = cell.prev!;
  }
  return summarize(picks, matches.map((m) => m.probs), columnPrice);
}

export function summarize(picks: Pick[], probs: Probs[], columnPrice: number): OptimizedCoupon {
  const coverages = picks.map((p, i) => pickCoverage(p, probs[i]));
  let doubles = 0;
  let triples = 0;
  for (const p of picks) {
    if (pickSize(p) === 2) doubles++;
    if (pickSize(p) === 3) triples++;
  }
  const columns = columnCount(doubles, triples);
  const dist = hitDistribution(coverages);
  const n = picks.length;
  return {
    picks,
    coverages,
    columns,
    cost: couponCost(columns, columnPrice),
    doubles,
    triples,
    singles: n - doubles - triples,
    pAll: coverages.reduce((a, b) => a * b, 1),
    pAtLeast14: probAtLeast(dist, n - 1),
    pAtLeast13: probAtLeast(dist, n - 2),
    pAtLeast12: probAtLeast(dist, n - 3),
    expectedHits: coverages.reduce((a, b) => a + b, 0),
  };
}

export type CouponKind = "ekonomik" | "dengeli" | "genis";

export const COUPON_KIND_LABEL: Record<CouponKind, string> = {
  ekonomik: "Ekonomik kupon",
  dengeli: "Dengeli kupon",
  genis: "Geniş kupon",
};

/**
 * Üç kupon tipi aynı bütçe tavanını kullanır, kolon sınırı farklıdır:
 * ekonomik ≤ bütçenin %10'u (en az 1 kolon), dengeli ≤ %40, geniş = bütçenin tamamı.
 */
export function buildCouponSet(
  matches: OptimizeMatchInput[],
  columnPrice: number,
  budget: number,
): Record<CouponKind, OptimizedCoupon> {
  const budgetCols = Math.min(Math.floor((budget + 1e-9) / columnPrice), MAX_COLUMNS_PER_COUPON);
  const cap = (f: number) => Math.max(1, Math.floor(budgetCols * f));
  return {
    ekonomik: optimizeCoupon({ matches, columnPrice, budget, maxColumns: cap(0.1) }),
    dengeli: optimizeCoupon({ matches, columnPrice, budget, maxColumns: cap(0.4) }),
    genis: optimizeCoupon({ matches, columnPrice, budget }),
  };
}

export const DEFAULT_BUDGETS = [100, 250, 500, 1000];
