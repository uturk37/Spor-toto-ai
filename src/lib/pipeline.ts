import type { Match, Prisma } from "@prisma/client";
import { prisma, getBudget, getColumnPrice } from "./db";
import { resolveTeam, COUNTRY_TR_EN, normalizeName } from "./data/teams";
import type { H2HMatch, SourcedTeamStats } from "./data/stats";
import { decide, DEFAULT_WEIGHTS, type AbsenceEvidence, type DecisionOutput, type EngineWeights, type ExpertPick, type MatchEvidence, type OddsEvidence } from "./model/engines";
import { learnWeights, type GradedEngineRecord } from "./model/learning";
import { riskFlags, type RiskFlag } from "./model/risk";
import { buildCouponSet, optimizeCoupon, COUPON_KIND_LABEL, DEFAULT_BUDGETS, type OptimizeMatchInput } from "./coupon/optimizer";
import { chainHash, roundDeep } from "./tracking/evaluate";
import { fetchProgram, SPORTOTO_LIST_URL } from "./sources/sportoto";
import { clubEloAdapter } from "./sources/clubelo";
import { footballDataCoUkAdapter } from "./sources/footballdataCoUk";
import { espnAdapter } from "./sources/espn";
import { understatAdapter } from "./sources/understat";
import { newsAdapters, tipsterAdapter } from "./sources/rss";
import { apiFootballAdapter, articleExpertAdapter, footballDataOrgAdapter, oddsApiAdapter } from "./sources/keyed";
import { SourceError } from "./sources/http";
import { sourceById, hasKey } from "./sources/registry";
import type { Adapter, AdapterResult, LineupInfo, MatchContext, NewsHit } from "./sources/types";
import type { Outcome, Pick, Probs, Provenance, SourceStatus } from "./types";

export const ADAPTERS: Adapter[] = [
  clubEloAdapter,
  footballDataCoUkAdapter,
  espnAdapter,
  understatAdapter,
  ...newsAdapters,
  tipsterAdapter,
  apiFootballAdapter,
  footballDataOrgAdapter,
  oddsApiAdapter,
  articleExpertAdapter,
];

export type Stage = "fikstur" | "T-24" | "T-3" | "T-1" | "haber" | "manuel";
export const STAGE_LABEL: Record<Stage, string> = {
  fikstur: "Fikstür açıklandı",
  "T-24": "Maçtan 24 saat önce",
  "T-3": "Maçtan 3 saat önce",
  "T-1": "Maçtan 1 saat önce",
  haber: "Son dakika kadro/sakatlık haberi",
  manuel: "Elle yenileme",
};

export interface SourceStatusRow {
  sourceId: string;
  sourceName: string;
  status: SourceStatus;
  url: string;
  error: string | null;
  fetchedAt: string;
  dataAsOf: string | null;
  summary: string | null;
}

/** Bir maç için toplanan tüm veriler (arayüzde gösterilen dosya). */
export interface MatchDossier {
  evidence: MatchEvidence;
  homeStats: Array<SourcedTeamStats & { sourceId: string }>;
  awayStats: Array<SourcedTeamStats & { sourceId: string }>;
  h2h: Array<{ matches: H2HMatch[]; prov: Provenance }>;
  absences: AbsenceEvidence[];
  lineups: LineupInfo[];
  news: NewsHit[];
  finalScores: Array<{ home: number; away: number; prov: Provenance }>;
  sources: SourceStatusRow[];
  collectedAt: string;
}

export function matchContext(m: Pick_<Match, "homeName" | "awayName" | "kickoff">, aliases: Record<string, string>): MatchContext {
  const home = resolveTeam(m.homeName, aliases);
  const away = resolveTeam(m.awayName, aliases);
  return { home, away, kickoff: m.kickoff, national: !!(COUNTRY_TR_EN[home.normalized] && COUNTRY_TR_EN[away.normalized]) };
}
type Pick_<T, K extends keyof T> = { [P in K]: T[P] };

async function aliasMap(): Promise<Record<string, string>> {
  const rows = await prisma.teamAlias.findMany();
  return Object.fromEntries(rows.map((r) => [r.alias, r.canonical]));
}

// ---------------------------------------------------------------- Fikstür

export async function refreshProgram(): Promise<{ weekId: string; isNew: boolean; programNo: number }> {
  const { program, prov } = await fetchProgram();
  const existing = await prisma.week.findUnique({ where: { season_programNo: { season: program.season, programNo: program.programNo } } });
  const week =
    existing ??
    (await prisma.week.create({
      data: { season: program.season, programNo: program.programNo, closesAt: program.closesAt ? new Date(program.closesAt) : null, sourceUrl: SPORTOTO_LIST_URL, fetchedAt: new Date(prov.fetchedAt) },
    }));
  if (existing) await prisma.week.update({ where: { id: week.id }, data: { fetchedAt: new Date(prov.fetchedAt), closesAt: program.closesAt ? new Date(program.closesAt) : existing.closesAt } });
  for (const m of program.matches) {
    await prisma.match.upsert({
      where: { weekId_order: { weekId: week.id, order: m.order } },
      create: { weekId: week.id, order: m.order, homeName: m.home, awayName: m.away, kickoff: new Date(m.kickoff), result: m.result, score: m.score, resultSource: m.result ? "sportoto" : null, resultAt: m.result ? new Date() : null },
      update: {
        homeName: m.home,
        awayName: m.away,
        kickoff: new Date(m.kickoff),
        ...(m.result ? { result: m.result, score: m.score, resultSource: "sportoto", resultAt: new Date() } : {}),
      },
    });
  }
  await prisma.sourceFetch.create({ data: { sourceId: "sportoto", url: SPORTOTO_LIST_URL, status: "ok", dataAsOf: new Date(prov.fetchedAt), payload: program as unknown as Prisma.InputJsonValue } });
  return { weekId: week.id, isNew: !existing, programNo: program.programNo };
}

export async function currentWeek() {
  return prisma.week.findFirst({ orderBy: [{ season: "desc" }, { programNo: "desc" }], include: { matches: { orderBy: { order: "asc" } } } });
}

// ---------------------------------------------------------------- Veri toplama

async function runAdapter(a: Adapter, ctx: MatchContext): Promise<AdapterResult> {
  const def = sourceById(a.id);
  if (def && !hasKey(def)) return { sourceId: a.id, status: "missing_key", url: def.homepage, error: `${def.envKey} tanımlı değil` };
  if (!a.applies(ctx)) return { sourceId: a.id, status: "not_applicable", url: def?.homepage ?? "", error: "Bu maç türü için kapsam dışı" };
  try {
    return await a.collect(ctx);
  } catch (e) {
    const status = e instanceof SourceError ? e.status : "error";
    return { sourceId: a.id, status, url: def?.homepage ?? "", error: (e as Error).message.slice(0, 300) };
  }
}

export async function collectDossier(match: Match, aliases?: Record<string, string>): Promise<MatchDossier> {
  const ctx = matchContext(match, aliases ?? (await aliasMap()));
  const results: AdapterResult[] = [];
  // Kaynaklara aynı anda en fazla 4 istek.
  const queue = [...ADAPTERS];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let a = queue.shift(); a; a = queue.shift()) results.push(await runAdapter(a, ctx));
    }),
  );
  const now = new Date().toISOString();
  const get = (id: string) => results.find((r) => r.sourceId === id && r.status === "ok");

  const ev: MatchEvidence = { sourcesOk: ["sportoto"], neutralVenue: false };
  const clubelo = get("clubelo");
  if (clubelo?.evidence?.elo) ev.elo = clubelo.evidence.elo;
  ev.sourceModelProbs = results.flatMap((r) => (r.status === "ok" ? r.evidence?.sourceModelProbs ?? [] : []));
  const us = get("understat");
  const fd = get("footballdata_couk");
  if (us?.evidence?.homeAtHome && us.evidence.awayAway) {
    ev.homeAtHome = us.evidence.homeAtHome;
    ev.awayAway = us.evidence.awayAway;
  } else if (fd?.evidence?.homeAtHome && fd.evidence.awayAway) {
    ev.homeAtHome = fd.evidence.homeAtHome;
    ev.awayAway = fd.evidence.awayAway;
  } else {
    const espn = get("espn");
    if (espn?.homeStats && espn.awayStats) {
      const hs = espn.homeStats.stats.home;
      const as = espn.awayStats.stats.away;
      ev.homeAtHome = { n: hs.n, goalsFor: hs.gf, goalsAgainst: hs.ga, prov: espn.homeStats.prov };
      ev.awayAway = { n: as.n, goalsFor: as.gf, goalsAgainst: as.ga, prov: espn.awayStats.prov };
    }
  }
  if (fd?.evidence?.leagueAverages) ev.leagueAverages = fd.evidence.leagueAverages;
  const odds = new Map<string, OddsEvidence>();
  for (const r of results) if (r.status === "ok") for (const o of r.evidence?.odds ?? []) odds.set(o.bookmaker.toLowerCase(), o);
  ev.odds = [...odds.values()];

  // Uzman görüşleri: otomatik + elle girilenler (veritabanı).
  const auto = results.flatMap((r) => (r.status === "ok" ? r.experts ?? [] : []));
  const manual = await prisma.expertPick.findMany({ where: { matchId: match.id } });
  for (const p of auto) {
    await prisma.expertPick.upsert({
      where: { matchId_url_sourceName: { matchId: match.id, url: p.url, sourceName: p.sourceName } },
      create: { matchId: match.id, sourceName: p.sourceName, author: p.author ?? null, url: p.url, pick: p.pick, publishedAt: p.publishedAt ? new Date(p.publishedAt) : null, originKey: p.originKey, enteredBy: "otomatik" },
      update: { pick: p.pick },
    });
  }
  const experts: ExpertPick[] = [
    ...auto,
    ...manual
      .filter((m) => m.enteredBy === "manuel")
      .map((m) => ({ sourceName: m.sourceName, author: m.author, url: m.url, pick: m.pick as Pick, publishedAt: m.publishedAt?.toISOString() ?? null, fetchedAt: m.fetchedAt.toISOString(), originKey: m.originKey })),
  ];
  ev.experts = experts;
  ev.absences = results.flatMap((r) => (r.status === "ok" ? r.absences ?? [] : []));
  for (const r of results) if (r.status === "ok" && !ev.sourcesOk.includes(r.sourceId)) ev.sourcesOk.push(r.sourceId);
  if (manual.some((m) => m.enteredBy === "manuel")) ev.sourcesOk.push(...new Set(manual.filter((m) => m.enteredBy === "manuel").map((m) => `manuel:${new URL(m.url).host}`)));

  for (const r of results) {
    await prisma.sourceFetch.create({
      data: {
        sourceId: r.sourceId,
        url: r.url,
        status: r.status,
        error: r.error ?? null,
        dataAsOf: r.dataAsOf ? new Date(r.dataAsOf) : null,
        matchId: match.id,
        payload: { summary: r.summary ?? null } as Prisma.InputJsonValue,
      },
    });
  }

  return {
    evidence: ev,
    homeStats: results.flatMap((r) => (r.status === "ok" && r.homeStats ? [{ ...r.homeStats, sourceId: r.sourceId, matches: r.homeStats.matches.slice(0, 10) }] : [])),
    awayStats: results.flatMap((r) => (r.status === "ok" && r.awayStats ? [{ ...r.awayStats, sourceId: r.sourceId, matches: r.awayStats.matches.slice(0, 10) }] : [])),
    h2h: results.flatMap((r) => (r.status === "ok" && r.h2h && r.h2h.matches.length ? [r.h2h] : [])),
    absences: ev.absences,
    lineups: results.flatMap((r) => r.lineups ?? []),
    news: results.flatMap((r) => r.news ?? []),
    finalScores: results.flatMap((r) => (r.finalScore ? [r.finalScore] : [])),
    sources: [
      { sourceId: "sportoto", sourceName: "Spor Toto Teşkilat Başkanlığı", status: "ok", url: SPORTOTO_LIST_URL, error: null, fetchedAt: now, dataAsOf: null, summary: "Resmî program" },
      ...results.map((r) => ({
        sourceId: r.sourceId,
        sourceName: sourceById(r.sourceId)?.name ?? r.sourceId,
        status: r.status,
        url: r.url,
        error: r.error ?? null,
        fetchedAt: now,
        dataAsOf: r.dataAsOf ?? null,
        summary: r.summary ?? null,
      })),
    ],
    collectedAt: now,
  };
}

// ---------------------------------------------------------------- Analiz ve kayıt

export async function currentWeights(): Promise<EngineWeights> {
  const w = await prisma.modelWeights.findFirst({ orderBy: { createdAt: "desc" } });
  return (w?.weights as unknown as EngineWeights) ?? DEFAULT_WEIGHTS;
}

export interface SnapshotPayload {
  match: { order: number; home: string; away: string; kickoff: string };
  stage: Stage;
  status: DecisionOutput["status"];
  warning: string | null;
  percentages: DecisionOutput["percentages"];
  probs: Probs | null;
  mainPick: Outcome | null;
  suggestedPick: Pick | null;
  confidence: DecisionOutput["confidence"];
  risk: DecisionOutput["risk"];
  dataSufficiency: DecisionOutput["dataSufficiency"];
  engines: Array<{ engine: string; probs: Probs }>;
  expert: { independent: number; consensusPick: Pick | null; pickCounts: Record<string, number> };
  sourcesOk: string[];
  weights: EngineWeights;
}

function payloadOf(match: Match, stage: Stage, d: DecisionOutput, weights: EngineWeights, sourcesOk: string[]): SnapshotPayload {
  return roundDeep({
    match: { order: match.order, home: match.homeName, away: match.awayName, kickoff: match.kickoff.toISOString() },
    stage,
    status: d.status,
    warning: d.warning,
    percentages: d.percentages,
    probs: d.probs,
    mainPick: d.mainPick,
    suggestedPick: d.suggestedPick,
    confidence: d.confidence,
    risk: d.risk,
    dataSufficiency: d.dataSufficiency,
    engines: d.engines.map((e) => ({ engine: e.engine, probs: e.probs })),
    expert: { independent: d.expert.independentCount, consensusPick: d.expert.consensusPick, pickCounts: d.expert.pickCounts },
    sourcesOk,
    weights,
  });
}

/** Zincire değiştirilemez kayıt ekler (veritabanı tetikleyicisi maç başladıysa reddeder). */
async function appendSnapshot(match: Match, payload: SnapshotPayload) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(724001)`;
    const last = await tx.predictionSnapshot.findFirst({ orderBy: { seq: "desc" } });
    const createdAt = new Date();
    const hash = chainHash(last?.hash ?? null, createdAt.toISOString(), payload);
    return tx.predictionSnapshot.create({
      data: { weekId: match.weekId, matchId: match.id, createdAt, stage: payload.stage, payload: payload as unknown as Prisma.InputJsonValue, prevHash: last?.hash ?? null, hash },
    });
  });
}

function diffSummary(before: SnapshotPayload, after: SnapshotPayload): string | null {
  if (before.status !== after.status) return `Durum değişti: ${before.status} → ${after.status}`;
  if (!before.percentages || !after.percentages) return null;
  const parts: string[] = [];
  if (before.mainPick !== after.mainPick) parts.push(`Ana tahmin ${before.mainPick} → ${after.mainPick}`);
  for (const k of ["p1", "pX", "p2"] as const) {
    const d = after.percentages[k] - before.percentages[k];
    if (Math.abs(d) >= 5) parts.push(`${k === "p1" ? "1" : k === "pX" ? "X" : "2"}: %${before.percentages[k]} → %${after.percentages[k]}`);
  }
  if (before.suggestedPick !== after.suggestedPick) parts.push(`Önerilen işaret ${before.suggestedPick} → ${after.suggestedPick}`);
  return parts.length ? parts.join(", ") : null;
}

export async function analyzeMatch(matchId: string, stage: Stage, opts: { aliases?: Record<string, string>; weights?: EngineWeights } = {}) {
  const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
  const dossier = await collectDossier(match, opts.aliases);
  const weights = opts.weights ?? (await currentWeights());
  const decision = decide(dossier.evidence, weights);
  const flags: RiskFlag[] = riskFlags(decision, match.homeName, match.awayName);
  await prisma.analysis.upsert({
    where: { matchId },
    create: { matchId, evidence: dossier as unknown as Prisma.InputJsonValue, decision: decision as unknown as Prisma.InputJsonValue, riskFlags: flags as unknown as Prisma.InputJsonValue, weights: weights as unknown as Prisma.InputJsonValue },
    update: { evidence: dossier as unknown as Prisma.InputJsonValue, decision: decision as unknown as Prisma.InputJsonValue, riskFlags: flags as unknown as Prisma.InputJsonValue, weights: weights as unknown as Prisma.InputJsonValue },
  });
  let snapshotId: string | null = null;
  if (match.kickoff.getTime() > Date.now()) {
    const payload = payloadOf(match, stage, decision, weights, dossier.evidence.sourcesOk);
    const prev = await prisma.predictionSnapshot.findFirst({ where: { matchId }, orderBy: { seq: "desc" } });
    try {
      const snap = await appendSnapshot(match, payload);
      snapshotId = snap.id;
      if (prev) {
        const summary = diffSummary(prev.payload as unknown as SnapshotPayload, payload);
        if (summary) {
          await prisma.changeNotice.create({
            data: { matchId, reason: STAGE_LABEL[stage], summary, before: prev.payload as Prisma.InputJsonValue, after: payload as unknown as Prisma.InputJsonValue },
          });
        }
      }
    } catch (e) {
      // Maç başlamışsa tetikleyici reddeder; analiz yine de güncellenmiş olur ama tahmin kaydı eklenmez.
      console.warn(`Tahmin kaydı eklenemedi (${match.homeName}-${match.awayName}): ${(e as Error).message}`);
    }
  }
  return { decision, flags, snapshotId };
}

export async function analyzeWeek(weekId: string, stage: Stage, filter?: (m: Match) => boolean) {
  const aliases = await aliasMap();
  const weights = await currentWeights();
  const matches = await prisma.match.findMany({ where: { weekId }, orderBy: { order: "asc" } });
  let n = 0;
  for (const m of matches) {
    if (filter && !filter(m)) continue;
    await analyzeMatch(m.id, stage, { aliases, weights });
    n++;
  }
  if (n) await generateAutoCoupons(weekId);
  return n;
}

// ---------------------------------------------------------------- Kuponlar

export async function generateAutoCoupons(weekId: string) {
  const matches = await prisma.match.findMany({ where: { weekId }, orderBy: { order: "asc" }, include: { analysis: true } });
  if (matches.length !== 15) return;
  const price = (await getColumnPrice()).value;
  const budget = await getBudget();
  const inputs: OptimizeMatchInput[] = matches.map((m) => {
    const d = m.analysis?.decision as unknown as DecisionOutput | undefined;
    // Verisi olmayan maçlarda olasılık uydurulmaz: eşit dağılım kullanılır ve kupon bu maçı genelde üçlü/çifte işaretler.
    return { probs: d?.probs ?? { p1: 1 / 3, pX: 1 / 3, p2: 1 / 3 } };
  });
  await prisma.coupon.deleteMany({ where: { weekId, origin: "otomatik" } });
  const create = async (name: string, kind: string, r: ReturnType<typeof optimizeCoupon>) =>
    prisma.coupon.create({ data: { weekId, name, kind, picks: r.picks, columns: r.columns, columnPrice: price, cost: r.cost, origin: "otomatik" } });
  try {
    const set = buildCouponSet(inputs, price, budget);
    for (const k of ["ekonomik", "dengeli", "genis"] as const) await create(`${COUPON_KIND_LABEL[k]} (${budget} TL bütçe)`, k, set[k]);
  } catch {
    /* bütçe yetersiz */
  }
  for (const b of DEFAULT_BUDGETS) {
    try {
      await create(`${b} TL bütçe kuponu`, `butce-${b}`, optimizeCoupon({ matches: inputs, columnPrice: price, budget: b }));
    } catch {
      /* bu bütçe kolon fiyatına yetmiyor */
    }
  }
}

// ---------------------------------------------------------------- Sonuçlar ve öğrenme

function outcomeOf(h: number, a: number): Outcome {
  return h > a ? "1" : h === a ? "X" : "2";
}

/** Resmî listeden sonuçları alır; resmî sonuç yoksa API kaynaklarındaki normal süre skoru kullanılır ve kaynağı yazılır. */
export async function updateResults() {
  try {
    await refreshProgram();
  } catch {
    /* resmî site erişilemezse diğer kaynaklar */
  }
  const pending = await prisma.match.findMany({ where: { result: null, kickoff: { lt: new Date(Date.now() - 2.5 * 3600000) } }, include: { analysis: true } });
  const aliases = await aliasMap();
  for (const m of pending) {
    const ctx = matchContext(m, aliases);
    for (const a of [apiFootballAdapter, footballDataOrgAdapter, espnAdapter]) {
      const r = await runAdapter(a, ctx);
      if (r.finalScore) {
        await prisma.match.update({
          where: { id: m.id },
          data: { result: outcomeOf(r.finalScore.home, r.finalScore.away), score: `${r.finalScore.home}-${r.finalScore.away}`, resultSource: r.sourceId, resultAt: new Date() },
        });
        break;
      }
    }
  }
  await relearn();
}

/** Bitmiş maçların son maç-öncesi kayıtlarından motor ağırlıklarını yeniden öğrenir. */
export async function relearn() {
  const done = await prisma.match.findMany({ where: { result: { not: null } }, select: { id: true, result: true } });
  const recs: GradedEngineRecord[] = [];
  for (const m of done) {
    const snap = await prisma.predictionSnapshot.findFirst({ where: { matchId: m.id }, orderBy: { seq: "desc" } });
    if (!snap) continue;
    const p = snap.payload as unknown as SnapshotPayload;
    for (const e of p.engines) recs.push({ engine: e.engine as keyof EngineWeights, probs: e.probs, result: m.result as Outcome });
  }
  if (!recs.length) return null;
  const { weights, samples, avgLoss } = learnWeights(recs);
  return prisma.modelWeights.create({ data: { weights: weights as unknown as Prisma.InputJsonValue, samples, avgLoss } });
}

// ---------------------------------------------------------------- Haber takibi

/** Yaklaşan maçlar için haber akışlarını tarar; yeni sakatlık/kadro haberi varsa maçı yeniden analiz eder. */
export async function checkNews(): Promise<number> {
  const soon = await prisma.match.findMany({ where: { kickoff: { gt: new Date(), lt: new Date(Date.now() + 48 * 3600000) } } });
  const aliases = await aliasMap();
  let re = 0;
  for (const m of soon) {
    const ctx = matchContext(m, aliases);
    let fresh = false;
    for (const a of newsAdapters) {
      const r = await runAdapter(a, ctx);
      for (const n of r.news ?? []) {
        if (n.kind === "genel") continue;
        const exists = await prisma.newsItem.findUnique({ where: { url: n.url } });
        if (exists) continue;
        await prisma.newsItem.create({ data: { sourceId: r.sourceId, title: n.title, url: n.url, publishedAt: n.publishedAt ? new Date(n.publishedAt) : null, teams: [normalizeName(n.side === "home" ? m.homeName : m.awayName)], kind: n.kind } });
        fresh = true;
      }
    }
    if (fresh) {
      await analyzeMatch(m.id, "haber", { aliases });
      re++;
    }
  }
  if (re && soon[0]) await generateAutoCoupons(soon[0].weekId);
  return re;
}
