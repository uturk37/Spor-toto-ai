import { prisma, getColumnPrice, getBudget } from "./db";
import type { DecisionOutput } from "./model/engines";
import type { RiskFlag } from "./model/risk";
import type { MatchDossier, SnapshotPayload } from "./pipeline";
import { gradeWeek, verifyChain, type WeekGrade } from "./tracking/evaluate";
import type { Outcome, Pick } from "./types";

export interface MatchRow {
  id: string;
  order: number;
  home: string;
  away: string;
  kickoff: string;
  result: string | null;
  score: string | null;
  decision: DecisionOutput | null;
  flags: RiskFlag[];
  sourcesOk: number;
  sourcesTried: number;
  analyzedAt: string | null;
}

export async function weekView(weekId?: string) {
  const week = weekId
    ? await prisma.week.findUnique({ where: { id: weekId } })
    : await prisma.week.findFirst({ orderBy: [{ season: "desc" }, { programNo: "desc" }] });
  if (!week) return null;
  const matches = await prisma.match.findMany({ where: { weekId: week.id }, orderBy: { order: "asc" }, include: { analysis: true } });
  const rows: MatchRow[] = matches.map((m) => {
    const dossier = m.analysis?.evidence as unknown as MatchDossier | undefined;
    return {
      id: m.id,
      order: m.order,
      home: m.homeName,
      away: m.awayName,
      kickoff: m.kickoff.toISOString(),
      result: m.result,
      score: m.score,
      decision: (m.analysis?.decision as unknown as DecisionOutput) ?? null,
      flags: (m.analysis?.riskFlags as unknown as RiskFlag[]) ?? [],
      sourcesOk: dossier ? new Set(dossier.evidence.sourcesOk).size : 0,
      sourcesTried: dossier ? dossier.sources.filter((s) => s.status !== "not_applicable").length : 0,
      analyzedAt: m.analysis?.updatedAt.toISOString() ?? null,
    };
  });
  const allSources = new Set<string>();
  for (const m of matches) {
    const d = m.analysis?.evidence as unknown as MatchDossier | undefined;
    d?.evidence.sourcesOk.forEach((s) => allSources.add(s));
  }
  const coupons = await prisma.coupon.findMany({ where: { weekId: week.id }, orderBy: [{ origin: "asc" }, { cost: "asc" }] });
  const notices = await prisma.changeNotice.findMany({
    where: { match: { weekId: week.id } },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { match: { select: { order: true, homeName: true, awayName: true } } },
  });
  return {
    week: { ...week, closesAt: week.closesAt?.toISOString() ?? null, fetchedAt: week.fetchedAt.toISOString(), createdAt: week.createdAt.toISOString() },
    rows,
    distinctSources: [...allSources],
    coupons: coupons.map((c) => ({ ...c, picks: c.picks as unknown as Pick[], columnPrice: Number(c.columnPrice), cost: Number(c.cost), createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() })),
    notices: notices.map((n) => ({ id: n.id, createdAt: n.createdAt.toISOString(), reason: n.reason, summary: n.summary, match: n.match })),
    columnPrice: await getColumnPrice(),
    budget: await getBudget(),
  };
}

export interface WeekHistory {
  weekId: string;
  season: string;
  programNo: number;
  grade: WeekGrade;
  predictedMatches: number;
}

/** Her hafta için maç başlamadan önceki SON değiştirilemez kayıt gerçek sonuçla karşılaştırılır. */
export async function historyView(): Promise<{ weeks: WeekHistory[]; season: Record<string, WeekGrade>; chain: { ok: boolean; brokenAt: number | null; count: number } }> {
  const weeks = await prisma.week.findMany({ orderBy: [{ season: "desc" }, { programNo: "desc" }], include: { matches: { orderBy: { order: "asc" } } } });
  const out: WeekHistory[] = [];
  for (const w of weeks) {
    if (!w.matches.some((m) => m.result)) continue;
    const inputs = [];
    let predicted = 0;
    for (const m of w.matches) {
      const snap = await prisma.predictionSnapshot.findFirst({ where: { matchId: m.id, createdAt: { lt: m.kickoff } }, orderBy: { seq: "desc" } });
      const p = snap?.payload as unknown as SnapshotPayload | undefined;
      if (p?.probs) predicted++;
      inputs.push({
        order: m.order,
        result: (m.result as Outcome) ?? null,
        aiProbs: p?.probs ?? null,
        aiPick: p?.suggestedPick ?? null,
        expertConsensus: p?.expert.independent && p.expert.independent >= 2 ? p.expert.consensusPick : null,
      });
    }
    out.push({ weekId: w.id, season: w.season, programNo: w.programNo, grade: gradeWeek(inputs), predictedMatches: predicted });
  }
  const season: Record<string, WeekGrade> = {};
  for (const h of out) {
    const s = (season[h.season] ??= {
      graded: 0, aiMainCorrect: 0, aiPickCorrect: 0,
      singles: { total: 0, correct: 0 }, doubles: { total: 0, correct: 0 }, triples: { total: 0, correct: 0 },
      expert: { total: 0, correct: 0 }, allFifteen: null,
    });
    const g = h.grade;
    s.graded += g.graded;
    s.aiMainCorrect += g.aiMainCorrect;
    s.aiPickCorrect += g.aiPickCorrect;
    for (const k of ["singles", "doubles", "triples", "expert"] as const) {
      s[k].total += g[k].total;
      s[k].correct += g[k].correct;
    }
  }
  return { weeks: out, season, chain: await verifyStoredChain() };
}

export async function verifyStoredChain() {
  const all = await prisma.predictionSnapshot.findMany({ orderBy: { seq: "asc" }, select: { createdAt: true, payload: true, prevHash: true, hash: true } });
  const r = verifyChain(all.map((s) => ({ createdAt: s.createdAt.toISOString(), payload: s.payload, prevHash: s.prevHash, hash: s.hash })));
  return { ...r, count: all.length };
}
