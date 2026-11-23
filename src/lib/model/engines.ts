import type { Level, Outcome, Pick, Probs, Provenance } from "../types";
import { pickOutcomes } from "../coupon/math";
import {
  argmax,
  entropy,
  eloOutcome,
  expectedGoals,
  get,
  jsDivergence,
  logPool,
  normalize,
  oddsToProbs,
  poissonOutcome,
  toPercentages,
  type GoalRecord,
} from "./probability";

// ---------------- Kanıt (evidence) modeli ----------------

export interface EloEvidence {
  home: number;
  away: number;
  /** Tarafsız sahada 0. */
  homeAdvantage: number;
  prov: Provenance;
}

export interface ProbEvidence {
  probs: Probs;
  prov: Provenance;
}

export interface GoalEvidence extends GoalRecord {
  prov: Provenance;
}

export interface OddsEvidence {
  bookmaker: string;
  o1: number;
  oX: number;
  o2: number;
  prov: Provenance;
}

export interface ExpertPick {
  /** Tahmini yayınlayan platform / yazar. */
  sourceName: string;
  author?: string | null;
  url: string;
  pick: Pick;
  publishedAt: string | null;
  fetchedAt: string;
  /**
   * Bağımsızlık anahtarı: aynı kökene (aynı yazar, aynı ajans metni, birbirini alıntılayan siteler)
   * sahip tahminler aynı anahtarı taşır ve tek görüş sayılır.
   */
  originKey: string;
}

export interface AbsenceEvidence {
  side: "home" | "away";
  player: string;
  status: "sakat" | "cezalı" | "şüpheli";
  /** Kaynak oyuncunun düzenli ilk 11 oyuncusu olduğunu söylüyorsa true; bilinmiyorsa null. */
  regularStarter: boolean | null;
  reason?: string | null;
  prov: Provenance;
}

export interface MatchEvidence {
  neutralVenue?: boolean;
  elo?: EloEvidence;
  /** Kaynağın kendi yayınladığı 1/X/2 olasılıkları (ör. ClubElo fixtures). */
  sourceModelProbs?: ProbEvidence[];
  homeAtHome?: GoalEvidence;
  awayAway?: GoalEvidence;
  leagueAverages?: { home: number; away: number; prov: Provenance };
  odds?: OddsEvidence[];
  experts?: ExpertPick[];
  absences?: AbsenceEvidence[];
  /** Veri alınabilen (status=ok) farklı kaynakların kimlikleri. */
  sourcesOk: string[];
}

export interface EngineOutput {
  engine: "istatistik" | "uzman" | "piyasa";
  probs: Probs;
  /** Motorun dayandığı örneklem/kanıt miktarına göre 0..1 nitelik puanı. */
  quality: number;
  notes: string[];
}

// ---------------- İstatistik motoru ----------------

export function statisticalEngine(ev: MatchEvidence): EngineOutput | null {
  const parts: Array<{ probs: Probs; weight: number }> = [];
  const notes: string[] = [];
  let quality = 0;

  if (ev.elo) {
    const hfa = ev.neutralVenue ? 0 : ev.elo.homeAdvantage;
    const p = eloOutcome(ev.elo.home, ev.elo.away, hfa);
    parts.push({ probs: p, weight: 1 });
    const diff = Math.round(ev.elo.home - ev.elo.away);
    notes.push(`Elo farkı ${diff >= 0 ? "+" : ""}${diff} (${ev.elo.prov.sourceName}).`);
    quality += 0.35;
  }
  for (const s of ev.sourceModelProbs ?? []) {
    parts.push({ probs: normalize(s.probs), weight: 1 });
    notes.push(`${s.prov.sourceName} modeli: 1 %${pct(s.probs.p1)}, X %${pct(s.probs.pX)}, 2 %${pct(s.probs.p2)}.`);
    quality += 0.2;
  }
  if (ev.homeAtHome && ev.awayAway && ev.homeAtHome.n >= 3 && ev.awayAway.n >= 3) {
    const lg = ev.leagueAverages;
    const { lambdaHome, lambdaAway } = expectedGoals(ev.homeAtHome, ev.awayAway, lg?.home, lg?.away);
    const p = poissonOutcome(lambdaHome, lambdaAway);
    const n = Math.min(ev.homeAtHome.n, ev.awayAway.n);
    parts.push({ probs: p, weight: Math.min(1, n / 8) });
    notes.push(
      `Poisson gol modeli: beklenen skor ${lambdaHome.toFixed(2)} - ${lambdaAway.toFixed(2)} ` +
        `(ev sahibi iç saha ${ev.homeAtHome.n} maç, deplasman dış saha ${ev.awayAway.n} maç).`,
    );
    quality += 0.35 * Math.min(1, n / 8);
  }
  if (!parts.length) return null;

  let probs = logPool(parts);
  // Eksik oyuncu etkisi: yalnızca kaynağın "düzenli ilk 11" dediği kesin eksikler için, oyuncu başına
  // 2 puan, taraf başına en fazla 8 puan, ilgili tarafın galibiyet olasılığından alınır.
  const shift = (side: "home" | "away") =>
    Math.min(
      0.08,
      0.02 *
        (ev.absences ?? []).filter((a) => a.side === side && a.regularStarter === true && a.status !== "şüpheli").length,
    );
  const sh = shift("home");
  const sa = shift("away");
  if (sh || sa) {
    const p1 = Math.max(0.01, probs.p1 * (1 - sh) * (1 + sa * 0.6));
    const p2 = Math.max(0.01, probs.p2 * (1 - sa) * (1 + sh * 0.6));
    probs = normalize({ p1, pX: probs.pX, p2 });
    notes.push(
      `Kesin eksik ilk 11 oyuncuları hesaba katıldı (ev sahibi -${Math.round(sh * 100)} puan, deplasman -${Math.round(sa * 100)} puan).`,
    );
  }
  return { engine: "istatistik", probs, quality: Math.min(1, quality), notes };
}

// ---------------- Piyasa (bahis oranları) motoru ----------------

export function marketEngine(ev: MatchEvidence): EngineOutput | null {
  const odds = ev.odds ?? [];
  if (!odds.length) return null;
  const list = odds.map((o) => oddsToProbs(o.o1, o.oX, o.o2));
  const avg = normalize({
    p1: list.reduce((a, b) => a + b.p1, 0),
    pX: list.reduce((a, b) => a + b.pX, 0),
    p2: list.reduce((a, b) => a + b.p2, 0),
  });
  return {
    engine: "piyasa",
    probs: avg,
    quality: Math.min(1, 0.5 + 0.1 * odds.length),
    notes: [`${odds.length} bahis şirketinin oranlarından marjı ayıklanmış ortalama.`],
  };
}

// ---------------- Uzman görüşü motoru ----------------

export interface ExpertConsensus {
  /** Bağımsız görüş sayısı (kopyalar birleştirildikten sonra). */
  independentCount: number;
  rawCount: number;
  /** Her tercih tipi için kaç bağımsız görüşün o tercihi verdiği. */
  pickCounts: Record<Pick, number>;
  /** Her sonucun (1/X/2) kaç bağımsız görüşçe desteklendiği (çifte tercih iki sonucu da destekler). */
  supportCounts: Record<Outcome, number>;
  consensusPick: Pick | null;
  /** 0..1: en çok desteklenen sonuca verilen pay. */
  agreement: number;
  contradictions: string[];
  /** Kopya olduğu için ayrı sayılmayan tahminler. */
  duplicates: Array<{ sourceName: string; sameAs: string }>;
}

export function expertConsensus(picks: ExpertPick[]): ExpertConsensus {
  const pickCounts = { "1": 0, X: 0, "2": 0, "1X": 0, X2: 0, "12": 0, "1X2": 0 } as Record<Pick, number>;
  const supportCounts: Record<Outcome, number> = { "1": 0, X: 0, "2": 0 };
  const seen = new Map<string, ExpertPick>();
  const duplicates: Array<{ sourceName: string; sameAs: string }> = [];
  // Aynı köken anahtarı -> ilk yayınlanan tutulur.
  const sorted = [...picks].sort((a, b) => (a.publishedAt ?? a.fetchedAt).localeCompare(b.publishedAt ?? b.fetchedAt));
  for (const p of sorted) {
    const k = p.originKey;
    const first = seen.get(k);
    if (first) {
      duplicates.push({ sourceName: p.sourceName, sameAs: first.sourceName });
      continue;
    }
    seen.set(k, p);
    pickCounts[p.pick]++;
    for (const o of pickOutcomes(p.pick)) supportCounts[o]++;
  }
  const independent = [...seen.values()];
  const n = independent.length;
  let consensusPick: Pick | null = null;
  let best = -1;
  for (const [pk, c] of Object.entries(pickCounts) as Array<[Pick, number]>) {
    if (c > best) {
      best = c;
      consensusPick = c > 0 ? pk : null;
    }
  }
  const totalSupport = supportCounts["1"] + supportCounts.X + supportCounts["2"];
  const agreement = totalSupport ? Math.max(supportCounts["1"], supportCounts.X, supportCounts["2"]) / totalSupport : 0;
  const contradictions: string[] = [];
  if (supportCounts["1"] > 0 && supportCounts["2"] > 0) {
    const s1 = independent.filter((p) => p.pick.includes("1") && !p.pick.includes("2")).map((p) => p.sourceName);
    const s2 = independent.filter((p) => p.pick.includes("2") && !p.pick.includes("1")).map((p) => p.sourceName);
    if (s1.length && s2.length) contradictions.push(`Ev sahibi diyenler (${s1.join(", ")}) ile deplasman diyenler (${s2.join(", ")}) çelişiyor.`);
  }
  return { independentCount: n, rawCount: picks.length, pickCounts, supportCounts, consensusPick, agreement, contradictions, duplicates };
}

export function expertEngine(ev: MatchEvidence): { output: EngineOutput | null; consensus: ExpertConsensus } {
  const consensus = expertConsensus(ev.experts ?? []);
  if (consensus.independentCount < 2) return { output: null, consensus };
  // Her bağımsız görüş 1 oy; çifte tercih oyu ikiye bölünür, üçlü tercih bilgi taşımaz. Laplace düzeltmesi.
  const acc = { "1": 1, X: 1, "2": 1 } as Record<Outcome, number>;
  for (const [pk, c] of Object.entries(consensus.pickCounts) as Array<[Pick, number]>) {
    const outs = pickOutcomes(pk);
    for (const o of outs) acc[o] += c / outs.length;
  }
  const probs = normalize({ p1: acc["1"], pX: acc.X, p2: acc["2"] });
  return {
    output: {
      engine: "uzman",
      probs,
      quality: Math.min(1, consensus.independentCount / 6),
      notes: [`${consensus.independentCount} bağımsız uzman görüşü (${consensus.rawCount} ham tahmin).`],
    },
    consensus,
  };
}

// ---------------- AI karar motoru ----------------

export type EngineWeights = Record<EngineOutput["engine"], number>;
export const DEFAULT_WEIGHTS: EngineWeights = { istatistik: 0.35, piyasa: 0.45, uzman: 0.2 };

export interface DecisionOutput {
  status: "tahmin" | "yetersiz_veri";
  warning: string | null;
  probs: Probs | null;
  percentages: { p1: number; pX: number; p2: number } | null;
  mainPick: Outcome | null;
  /** Olasılık değil: verinin miktarı/uyumu ile ilgili güven. */
  confidence: Level | null;
  confidenceScore: number | null;
  risk: Level | null;
  dataSufficiency: Level;
  reasoning: string[];
  engines: EngineOutput[];
  expert: ExpertConsensus;
  suggestedPick: Pick | null;
}

export function dataSufficiency(ev: MatchEvidence): Level {
  const n = new Set(ev.sourcesOk).size;
  const hasStat = !!(ev.elo || ev.sourceModelProbs?.length || (ev.homeAtHome && ev.awayAway));
  const hasMarket = !!ev.odds?.length;
  if (n >= 7 && hasStat && hasMarket) return "Yüksek";
  if (n >= 4 && (hasStat || hasMarket)) return "Orta";
  return "Düşük";
}

function pct(v: number) {
  return Math.round(v * 100);
}

const OUT_LABEL: Record<Outcome, string> = { "1": "ev sahibi galibiyeti (1)", X: "beraberlik (X)", "2": "deplasman galibiyeti (2)" };

export function decide(ev: MatchEvidence, weights: EngineWeights = DEFAULT_WEIGHTS): DecisionOutput {
  const stat = statisticalEngine(ev);
  const market = marketEngine(ev);
  const { output: expert, consensus } = expertEngine(ev);
  const engines = [stat, market, expert].filter(Boolean) as EngineOutput[];
  const sufficiency = dataSufficiency(ev);

  if (!stat && !market) {
    return {
      status: "yetersiz_veri",
      warning:
        "Bu maç için istatistik veya piyasa verisi alınamadı. Yalnızca uzman görüşüyle olasılık üretilmez; tahmin verilmedi.",
      probs: null,
      percentages: null,
      mainPick: null,
      confidence: null,
      confidenceScore: null,
      risk: null,
      dataSufficiency: sufficiency,
      reasoning: [],
      engines,
      expert: consensus,
      suggestedPick: null,
    };
  }

  const pooled = logPool(engines.map((e) => ({ probs: e.probs, weight: weights[e.engine] * (0.5 + 0.5 * e.quality) })));
  const percentages = toPercentages(pooled);
  const mainPick = argmax(pooled);
  const top = get(pooled, mainPick);

  // Güven: kaynak yeterliliği + motor uyumu + motor nitelikleri. Olasılıktan bağımsızdır.
  const srcScore = Math.min(1, new Set(ev.sourcesOk).size / 10);
  let agree = 1;
  if (engines.length > 1) {
    let s = 0;
    let c = 0;
    for (let i = 0; i < engines.length; i++)
      for (let j = i + 1; j < engines.length; j++) {
        s += jsDivergence(engines[i].probs, engines[j].probs);
        c++;
      }
    agree = Math.max(0, 1 - (s / c) * 8);
  } else agree = 0.5;
  const qual = engines.reduce((a, e) => a + e.quality, 0) / engines.length;
  const confidenceScore = 0.4 * srcScore + 0.35 * agree + 0.25 * qual;
  const confidence: Level = confidenceScore >= 0.7 ? "Yüksek" : confidenceScore >= 0.45 ? "Orta" : "Düşük";

  // Risk: sonucun belirsizliği (en yüksek olasılık ve entropi) + motorların farklı sonuç göstermesi.
  const tops = new Set(engines.map((e) => argmax(e.probs)));
  let riskScore = (1 - top) * 0.6 + entropy(pooled) * 0.4;
  if (tops.size > 1) riskScore += 0.1;
  const risk: Level = riskScore >= 0.6 ? "Yüksek" : riskScore >= 0.45 ? "Orta" : "Düşük";

  const reasoning: string[] = [];
  reasoning.push(`AI karar motoru en olası sonucu ${OUT_LABEL[mainPick]} olarak görüyor (%${percentages[mainPick === "1" ? "p1" : mainPick === "X" ? "pX" : "p2"]}).`);
  for (const e of engines) {
    reasoning.push(
      `${e.engine === "istatistik" ? "İstatistik" : e.engine === "piyasa" ? "Piyasa" : "Uzman"} motoru: 1 %${pct(e.probs.p1)}, X %${pct(e.probs.pX)}, 2 %${pct(e.probs.p2)}. ${e.notes.join(" ")}`,
    );
  }
  if (tops.size > 1) reasoning.push("Motorlar farklı sonuçları öne çıkarıyor; bu durum riski artırıyor.");
  const absences = ev.absences ?? [];
  if (absences.length) reasoning.push(`Kaynaklarda ${absences.length} eksik/şüpheli oyuncu bildirildi.`);
  if (!expert) reasoning.push("Yeterli bağımsız uzman tahmini bulunamadı (en az 2 gerekli); uzman motoru devre dışı.");

  return {
    status: "tahmin",
    warning: sufficiency === "Düşük" ? "Veri yeterliliği düşük; olasılıkları temkinli yorumlayın." : null,
    probs: pooled,
    percentages,
    mainPick,
    confidence,
    confidenceScore,
    risk,
    dataSufficiency: sufficiency,
    reasoning,
    engines,
    expert: consensus,
    suggestedPick: suggestPick(pooled),
  };
}

/** Tek maç için önerilen işaret: belirgin favori tekli, değilse en iyi çifte, çok belirsizse üçlü. */
export function suggestPick(p: Probs): Pick {
  const sorted = (["1", "X", "2"] as Outcome[]).map((o) => ({ o, v: get(p, o) })).sort((a, b) => b.v - a.v);
  if (sorted[0].v >= 0.55) return sorted[0].o;
  if (sorted[0].v + sorted[1].v >= 0.72) {
    const set = new Set([sorted[0].o, sorted[1].o]);
    return (["1", "X", "2"] as Outcome[]).filter((o) => set.has(o)).join("") as Pick;
  }
  return "1X2";
}
