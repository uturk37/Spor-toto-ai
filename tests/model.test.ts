import { describe, expect, it } from "vitest";
import {
  eloOutcome,
  expectedGoals,
  jsDivergence,
  logPool,
  oddsToProbs,
  poissonOutcome,
  toPercentages,
  bookmakerMargin,
} from "@/lib/model/probability";
import { decide, expertConsensus, suggestPick, type ExpertPick, type MatchEvidence } from "@/lib/model/engines";
import { learnWeights } from "@/lib/model/learning";
import { riskFlags } from "@/lib/model/risk";
import type { Provenance } from "@/lib/types";

const prov = (id: string): Provenance => ({ sourceId: id, sourceName: id, url: `https://example.org/${id}`, fetchedAt: "2026-11-20T10:00:00Z", dataAsOf: null });

describe("olasılık yardımcıları", () => {
  it("yüzdeler her zaman toplam 100", () => {
    for (const p of [
      { p1: 1 / 3, pX: 1 / 3, p2: 1 / 3 },
      { p1: 0.555, pX: 0.255, p2: 0.19 },
      { p1: 0.0049, pX: 0.0051, p2: 0.99 },
    ]) {
      const r = toPercentages(p);
      expect(r.p1 + r.pX + r.p2).toBe(100);
    }
  });
  it("orandan marjsız olasılık", () => {
    const p = oddsToProbs(1.8, 3.6, 4.5);
    expect(p.p1 + p.pX + p.p2).toBeCloseTo(1, 12);
    expect(p.p1).toBeGreaterThan(p.p2);
    expect(bookmakerMargin(1.8, 3.6, 4.5)).toBeCloseTo(1 / 1.8 + 1 / 3.6 + 1 / 4.5 - 1);
    expect(() => oddsToProbs(1, 3, 3)).toThrow();
  });
  it("Poisson: eşit güçte ev avantajı yok, toplam 1", () => {
    const p = poissonOutcome(1.3, 1.3);
    expect(p.p1).toBeCloseTo(p.p2, 10);
    expect(p.p1 + p.pX + p.p2).toBeCloseTo(1, 12);
    const q = poissonOutcome(2.2, 0.7);
    expect(q.p1).toBeGreaterThan(0.6);
  });
  it("gol beklentisi az örnekte lig ortalamasına büzülür", () => {
    const e = expectedGoals({ n: 1, goalsFor: 5, goalsAgainst: 0 }, { n: 1, goalsFor: 0, goalsAgainst: 5 });
    expect(e.lambdaHome).toBeLessThan(3);
  });
  it("Elo: güçlü ev sahibi favori; tarafsız eşitlikte simetrik", () => {
    const a = eloOutcome(1900, 1600);
    expect(a.p1).toBeGreaterThan(0.6);
    const b = eloOutcome(1700, 1700, 0);
    expect(b.p1).toBeCloseTo(b.p2, 10);
    expect(b.pX).toBeCloseTo(0.29, 2);
  });
  it("log havuzu ve JS ıraksaması", () => {
    const p = { p1: 0.6, pX: 0.25, p2: 0.15 };
    expect(logPool([{ probs: p, weight: 1 }]).p1).toBeCloseTo(0.6, 10);
    expect(jsDivergence(p, p)).toBeCloseTo(0, 12);
    expect(jsDivergence({ p1: 1, pX: 0, p2: 0 }, { p1: 0, pX: 0, p2: 1 })).toBeCloseTo(1, 6);
  });
});

describe("uzman görüşü", () => {
  const base = { url: "https://example.org", publishedAt: "2026-11-20T10:00:00Z", fetchedAt: "2026-11-20T11:00:00Z" };
  it("kopyalanan tahminleri tek görüş sayar", () => {
    const picks: ExpertPick[] = [
      { ...base, sourceName: "A", pick: "1", originKey: "yazar-a" },
      { ...base, sourceName: "B (A'dan alıntı)", pick: "1", originKey: "yazar-a", publishedAt: "2026-11-20T12:00:00Z" },
      { ...base, sourceName: "C", pick: "X", originKey: "c" },
      { ...base, sourceName: "D", pick: "1X", originKey: "d" },
      { ...base, sourceName: "E", pick: "2", originKey: "e" },
    ];
    const c = expertConsensus(picks);
    expect(c.rawCount).toBe(5);
    expect(c.independentCount).toBe(4);
    expect(c.duplicates).toEqual([{ sourceName: "B (A'dan alıntı)", sameAs: "A" }]);
    expect(c.pickCounts["1"]).toBe(1);
    expect(c.pickCounts["1X"]).toBe(1);
    expect(c.supportCounts).toEqual({ "1": 2, X: 2, "2": 1 });
    expect(c.contradictions.length).toBe(1);
  });
});

describe("AI karar motoru", () => {
  it("istatistik ve piyasa verisi yoksa tahmin üretmez", () => {
    const d = decide({ sourcesOk: ["x"], experts: [] });
    expect(d.status).toBe("yetersiz_veri");
    expect(d.probs).toBeNull();
    expect(d.warning).toBeTruthy();
  });
  it("tahmin üretir, yüzdeler 100, güven ile olasılık ayrı", () => {
    const ev: MatchEvidence = {
      elo: { home: 1850, away: 1650, homeAdvantage: 65, prov: prov("clubelo") },
      odds: [
        { bookmaker: "b1", o1: 1.55, oX: 4.1, o2: 5.8, prov: prov("odds") },
        { bookmaker: "b2", o1: 1.6, oX: 4.0, o2: 5.5, prov: prov("odds") },
      ],
      homeAtHome: { n: 8, goalsFor: 18, goalsAgainst: 6, prov: prov("espn") },
      awayAway: { n: 8, goalsFor: 8, goalsAgainst: 14, prov: prov("espn") },
      sourcesOk: ["clubelo", "odds", "espn", "sportoto"],
    };
    const d = decide(ev);
    expect(d.status).toBe("tahmin");
    expect(d.percentages!.p1 + d.percentages!.pX + d.percentages!.p2).toBe(100);
    expect(d.mainPick).toBe("1");
    expect(["Yüksek", "Orta", "Düşük"]).toContain(d.confidence);
    expect(d.dataSufficiency).toBe("Orta");
    expect(d.engines.map((e) => e.engine).sort()).toEqual(["istatistik", "piyasa"]);
  });
  it("öneri: belirgin favori tekli, belirsiz maç üçlü", () => {
    expect(suggestPick({ p1: 0.7, pX: 0.2, p2: 0.1 })).toBe("1");
    expect(suggestPick({ p1: 0.45, pX: 0.3, p2: 0.25 })).toBe("1X");
    expect(suggestPick({ p1: 0.36, pX: 0.33, p2: 0.31 })).toBe("1X2");
  });
  it("risk etiketleri", () => {
    const ev: MatchEvidence = {
      odds: [{ bookmaker: "b", o1: 2.6, oX: 3.0, o2: 2.9, prov: prov("odds") }],
      sourcesOk: ["odds"],
    };
    const flags = riskFlags(decide(ev), "A", "B").map((f) => f.tag);
    expect(flags).toContain("yuksek_belirsizlik");
    expect(flags).toContain("beraberlik_yuksek");
  });
});

describe("öğrenme", () => {
  it("daha isabetli motorun ağırlığı artar, toplam 1", () => {
    const recs = [];
    for (let i = 0; i < 200; i++) {
      recs.push({ engine: "piyasa" as const, probs: { p1: 0.7, pX: 0.2, p2: 0.1 }, result: "1" as const });
      recs.push({ engine: "istatistik" as const, probs: { p1: 0.2, pX: 0.3, p2: 0.5 }, result: "1" as const });
    }
    const { weights } = learnWeights(recs);
    expect(weights.piyasa).toBeGreaterThan(weights.istatistik);
    expect(weights.piyasa + weights.istatistik + weights.uzman).toBeCloseTo(1, 12);
  });
  it("veri yoksa varsayılan ağırlıklar", () => {
    const { weights } = learnWeights([]);
    expect(weights.piyasa).toBeCloseTo(0.45);
  });
});
