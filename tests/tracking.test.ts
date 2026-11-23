import { describe, expect, it } from "vitest";
import { chainHash, gradeWeek, verifyChain, canonicalJson, type ChainRecord } from "@/lib/tracking/evaluate";

describe("haftalık değerlendirme", () => {
  it("tekli/çifte/üçlü ve 15/15 sayımı", () => {
    const ms = Array.from({ length: 15 }, (_, i) => ({
      order: i + 1,
      result: "1" as const,
      aiProbs: { p1: 0.6, pX: 0.25, p2: 0.15 },
      aiPick: (i === 0 ? "1X" : i === 1 ? "1X2" : "1") as "1" | "1X" | "1X2",
      expertConsensus: i < 5 ? ("2" as const) : null,
    }));
    const g = gradeWeek(ms);
    expect(g.graded).toBe(15);
    expect(g.aiMainCorrect).toBe(15);
    expect(g.singles).toEqual({ total: 13, correct: 13 });
    expect(g.doubles).toEqual({ total: 1, correct: 1 });
    expect(g.triples).toEqual({ total: 1, correct: 1 });
    expect(g.expert).toEqual({ total: 5, correct: 0 });
    expect(g.allFifteen).toBe(true);
    ms[3].result = "2" as never;
    expect(gradeWeek(ms).allFifteen).toBe(false);
    ms[4].result = null as never;
    expect(gradeWeek(ms).allFifteen).toBeNull();
  });
});

describe("değiştirilemez kayıt zinciri", () => {
  it("kanonik JSON anahtar sırasından bağımsız", () => {
    expect(canonicalJson({ b: 1, a: [1, { y: 2, x: 1 }] })).toBe(canonicalJson({ a: [1, { x: 1, y: 2 }], b: 1 }));
  });
  it("sonradan değiştirilen kaydı yakalar", () => {
    const recs: ChainRecord[] = [];
    let prev: string | null = null;
    for (let i = 0; i < 3; i++) {
      const createdAt = `2026-11-2${i}T10:00:00.000Z`;
      const payload = { match: i, p1: 50 };
      const hash = chainHash(prev, createdAt, payload);
      recs.push({ createdAt, payload, prevHash: prev, hash });
      prev = hash;
    }
    expect(verifyChain(recs)).toEqual({ ok: true, brokenAt: null });
    (recs[1].payload as { p1: number }).p1 = 70;
    expect(verifyChain(recs)).toEqual({ ok: false, brokenAt: 1 });
  });
});
