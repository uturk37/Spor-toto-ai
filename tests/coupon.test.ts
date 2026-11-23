import { describe, expect, it } from "vitest";
import {
  columnCount,
  columnsForPicks,
  countPicks,
  couponCost,
  hitDistribution,
  manualCalc,
  pickCoverage,
  pickHits,
  toPick,
  MAX_COLUMNS_PER_COUPON,
} from "@/lib/coupon/math";
import { buildCouponSet, optimizeCoupon, InfeasibleCouponError, DEFAULT_BUDGETS } from "@/lib/coupon/optimizer";
import { ALL_PICKS, type Pick, type Probs } from "@/lib/types";

describe("kolon hesabı", () => {
  it("2^çifte × 3^üçlü", () => {
    expect(columnCount(0, 0)).toBe(1);
    expect(columnCount(1, 0)).toBe(2);
    expect(columnCount(0, 1)).toBe(3);
    expect(columnCount(3, 1)).toBe(24); // sportoto.gov.tr örneği: 3 ikili + 1 üçlü = 24 kolon
    expect(columnCount(5, 2)).toBe(288);
    expect(columnCount(11, 0)).toBe(2048);
    expect(columnCount(0, 7)).toBe(2187);
  });
  it("negatif veya kesirli girişi reddeder", () => {
    expect(() => columnCount(-1, 0)).toThrow();
    expect(() => columnCount(1.5, 0)).toThrow();
  });
  it("tercih listesinden kolon", () => {
    const picks: Pick[] = ["1", "1X", "X2", "1X2", "2", "12", "1", "1", "1", "1", "1", "1", "1", "1", "1"];
    expect(countPicks(picks)).toEqual({ singles: 11, doubles: 3, triples: 1 });
    expect(columnsForPicks(picks)).toBe(24);
  });
  it("kupon bedeli kuruş hassasiyetinde", () => {
    expect(couponCost(24, 10)).toBe(240);
    expect(couponCost(3, 0.1)).toBe(0.3);
    expect(couponCost(7, 2.5)).toBe(17.5);
  });
  it("elle hesap: toplam 15 kontrolü ve bütçe", () => {
    const ok = manualCalc({ singles: 11, doubles: 3, triples: 1, columnPrice: 10, budget: 250 });
    expect(ok.errors).toEqual([]);
    expect(ok.columns).toBe(24);
    expect(ok.cost).toBe(240);
    expect(ok.withinBudget).toBe(true);
    const over = manualCalc({ singles: 10, doubles: 4, triples: 1, columnPrice: 10, budget: 250 });
    expect(over.cost).toBe(480);
    expect(over.withinBudget).toBe(false);
    const bad = manualCalc({ singles: 10, doubles: 3, triples: 1, columnPrice: 10 });
    expect(bad.errors.length).toBeGreaterThan(0);
    const big = manualCalc({ singles: 3, doubles: 12, triples: 0, columnPrice: 10 });
    expect(big.columns).toBe(4096);
    expect(big.withinColumnLimit).toBe(false);
  });
  it("tercih yardımcıları", () => {
    expect(toPick(["2", "1"])).toBe("12");
    expect(toPick(["X", "2", "1"])).toBe("1X2");
    expect(pickHits("1X", "X")).toBe(true);
    expect(pickHits("1X", "2")).toBe(false);
    expect(pickCoverage("X2", { p1: 0.5, pX: 0.3, p2: 0.2 })).toBeCloseTo(0.5);
  });
  it("doğru sayısı dağılımı toplamı 1", () => {
    const d = hitDistribution([0.5, 0.5]);
    expect(d).toEqual([0.25, 0.5, 0.25]);
    const d2 = hitDistribution(new Array(15).fill(0.7));
    expect(d2.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(d2[15]).toBeCloseTo(0.7 ** 15, 12);
  });
});

function randomProbs(seed: number): Probs[] {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  return Array.from({ length: 15 }, () => {
    const a = rnd() + 0.05;
    const b = rnd() * 0.6 + 0.1;
    const c = rnd() + 0.05;
    const t = a + b + c;
    return { p1: a / t, pX: b / t, p2: c / t };
  });
}

/** Küçük örnekte kaba kuvvetle (tüm 7^n kombinasyon) optimumu doğrular. */
function bruteForce(probs: Probs[], maxCols: number): number {
  let best = 0;
  const n = probs.length;
  const idx = new Array(n).fill(0);
  for (;;) {
    const picks = idx.map((i) => ALL_PICKS[i]);
    if (columnsForPicks(picks) <= maxCols) {
      const v = picks.reduce((a, p, i) => a * pickCoverage(p, probs[i]), 1);
      if (v > best) best = v;
    }
    let k = 0;
    while (k < n && ++idx[k] === ALL_PICKS.length) idx[k++] = 0;
    if (k === n) break;
  }
  return best;
}

describe("kupon optimizasyonu", () => {
  it("küçük örnekte kaba kuvvetle aynı optimumu bulur", () => {
    for (const seed of [1, 7, 42]) {
      const probs = randomProbs(seed).slice(0, 5);
      for (const cols of [1, 2, 3, 6, 12, 30]) {
        const r = optimizeCoupon({ matches: probs.map((p) => ({ probs: p })), columnPrice: 10, budget: cols * 10 });
        expect(r.pAll).toBeCloseTo(bruteForce(probs, cols), 10);
        expect(r.columns).toBeLessThanOrEqual(cols);
      }
    }
  });

  it("bütçeyi ve 2500 kolon sınırını asla aşmaz", () => {
    const probs = randomProbs(99);
    for (const budget of [...DEFAULT_BUDGETS, 10, 37, 99999]) {
      const r = optimizeCoupon({ matches: probs.map((p) => ({ probs: p })), columnPrice: 10, budget });
      expect(r.cost).toBeLessThanOrEqual(budget);
      expect(r.columns).toBeLessThanOrEqual(MAX_COLUMNS_PER_COUPON);
      expect(r.columns).toBe(2 ** r.doubles * 3 ** r.triples);
      expect(r.singles + r.doubles + r.triples).toBe(15);
    }
  });

  it("bütçe arttıkça 15 tutma olasılığı azalmaz", () => {
    const probs = randomProbs(5);
    let prev = 0;
    for (const budget of [10, 20, 40, 100, 250, 500, 1000, 5000, 25000]) {
      const r = optimizeCoupon({ matches: probs.map((p) => ({ probs: p })), columnPrice: 10, budget });
      expect(r.pAll).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = r.pAll;
    }
  });

  it("kilitli tercihlere uyar", () => {
    const probs = randomProbs(3);
    const matches = probs.map((p, i) => ({ probs: p, locked: i === 0 ? ("1X2" as Pick) : i === 1 ? ("2" as Pick) : undefined }));
    const r = optimizeCoupon({ matches, columnPrice: 10, budget: 250 });
    expect(r.picks[0]).toBe("1X2");
    expect(r.picks[1]).toBe("2");
  });

  it("bütçe yetmezse hata verir", () => {
    const probs = randomProbs(3);
    expect(() => optimizeCoupon({ matches: probs.map((p) => ({ probs: p })), columnPrice: 10, budget: 5 })).toThrow(InfeasibleCouponError);
    const locked = probs.map((p) => ({ probs: p, locked: "1X2" as Pick }));
    expect(() => optimizeCoupon({ matches: locked, columnPrice: 10, budget: 1000 })).toThrow(InfeasibleCouponError);
  });

  it("ekonomik ≤ dengeli ≤ geniş kolon sayısı", () => {
    const probs = randomProbs(11);
    const set = buildCouponSet(probs.map((p) => ({ probs: p })), 10, 1000);
    expect(set.ekonomik.columns).toBeLessThanOrEqual(10);
    expect(set.dengeli.columns).toBeLessThanOrEqual(40);
    expect(set.genis.columns).toBeLessThanOrEqual(100);
    expect(set.ekonomik.pAll).toBeLessThanOrEqual(set.dengeli.pAll + 1e-12);
    expect(set.dengeli.pAll).toBeLessThanOrEqual(set.genis.pAll + 1e-12);
  });
});
