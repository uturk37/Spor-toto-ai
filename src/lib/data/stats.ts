import type { Provenance } from "../types";

/** Bir takımın oynadığı tek maç (takım perspektifinden). Bilinmeyen alanlar null kalır, asla tahmin edilmez. */
export interface TeamMatch {
  date: string; // ISO
  competition: string | null;
  opponent: string;
  home: boolean;
  neutral?: boolean;
  gf: number;
  ga: number;
  htGf?: number | null;
  htGa?: number | null;
  shots?: number | null;
  shotsOnTarget?: number | null;
  shotsAgainst?: number | null;
  shotsOnTargetAgainst?: number | null;
  corners?: number | null;
  cornersAgainst?: number | null;
  possession?: number | null;
  xg?: number | null;
  xga?: number | null;
  opponentElo?: number | null;
}

export interface FormBlock {
  n: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  ppg: number;
  gfAvg: number;
  gaAvg: number;
  sequence: string; // ör. "GGBMG" (en yeni solda)
}

function avgOrNull(vals: Array<number | null | undefined>): { value: number | null; n: number } {
  const v = vals.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return { value: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, n: v.length };
}

export function formBlock(ms: TeamMatch[]): FormBlock {
  let w = 0, d = 0, l = 0, gf = 0, ga = 0;
  let seq = "";
  for (const m of ms) {
    gf += m.gf;
    ga += m.ga;
    if (m.gf > m.ga) { w++; seq += "G"; }
    else if (m.gf === m.ga) { d++; seq += "B"; }
    else { l++; seq += "M"; }
  }
  const n = ms.length;
  return { n, w, d, l, gf, ga, ppg: n ? (3 * w + d) / n : 0, gfAvg: n ? gf / n : 0, gaAvg: n ? ga / n : 0, sequence: seq };
}

export interface TeamStats {
  last5: FormBlock;
  last10: FormBlock;
  home: FormBlock & { winRate: number };
  away: FormBlock & { winRate: number };
  vsStronger: FormBlock | null;
  vsWeaker: FormBlock | null;
  xg: { value: number | null; n: number };
  xga: { value: number | null; n: number };
  shots: { value: number | null; n: number };
  shotsOnTarget: { value: number | null; n: number };
  possession: { value: number | null; n: number };
  corners: { value: number | null; n: number };
  firstHalf: { ppg: number; gfAvg: number; gaAvg: number; n: number } | null;
  over25Rate: number | null;
  bttsRate: number | null;
  restDays: number | null;
  matchesLast14Days: number;
  /** Puan dağılımının standart sapması; düşük = istikrarlı. */
  pointsStdDev: number | null;
  sampleSize: number;
}

/** Maç listesinden (en yeni önce) istatistik özeti. `ownElo` verilirse rakip gücüne göre ayrım yapılır. */
export function computeTeamStats(matchesNewestFirst: TeamMatch[], asOf: Date, ownElo?: number | null): TeamStats {
  const ms = matchesNewestFirst.filter((m) => new Date(m.date) < asOf);
  const last10 = ms.slice(0, 10);
  const homeMs = ms.filter((m) => m.home && !m.neutral).slice(0, 10);
  const awayMs = ms.filter((m) => !m.home && !m.neutral).slice(0, 10);
  const hb = formBlock(homeMs);
  const ab = formBlock(awayMs);
  let vsStronger: FormBlock | null = null;
  let vsWeaker: FormBlock | null = null;
  if (ownElo) {
    const withElo = ms.slice(0, 20).filter((m) => m.opponentElo);
    const s = withElo.filter((m) => m.opponentElo! >= ownElo);
    const w = withElo.filter((m) => m.opponentElo! < ownElo);
    vsStronger = s.length ? formBlock(s) : null;
    vsWeaker = w.length ? formBlock(w) : null;
  }
  const ht = last10.filter((m) => m.htGf != null && m.htGa != null);
  const firstHalf = ht.length
    ? (() => {
        const b = formBlock(ht.map((m) => ({ ...m, gf: m.htGf!, ga: m.htGa! })));
        return { ppg: b.ppg, gfAvg: b.gfAvg, gaAvg: b.gaAvg, n: b.n };
      })()
    : null;
  const pts = last10.map((m) => (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0));
  const mean = pts.length ? pts.reduce((a: number, b: number) => a + b, 0) / pts.length : 0;
  const sd = pts.length >= 3 ? Math.sqrt(pts.reduce((a: number, b: number) => a + (b - mean) ** 2, 0) / pts.length) : null;
  const last = ms[0] ? new Date(ms[0].date) : null;
  return {
    last5: formBlock(ms.slice(0, 5)),
    last10: formBlock(last10),
    home: { ...hb, winRate: hb.n ? hb.w / hb.n : 0 },
    away: { ...ab, winRate: ab.n ? ab.w / ab.n : 0 },
    vsStronger,
    vsWeaker,
    xg: avgOrNull(last10.map((m) => m.xg)),
    xga: avgOrNull(last10.map((m) => m.xga)),
    shots: avgOrNull(last10.map((m) => m.shots)),
    shotsOnTarget: avgOrNull(last10.map((m) => m.shotsOnTarget)),
    possession: avgOrNull(last10.map((m) => m.possession)),
    corners: avgOrNull(last10.map((m) => m.corners)),
    firstHalf,
    over25Rate: last10.length ? last10.filter((m) => m.gf + m.ga > 2.5).length / last10.length : null,
    bttsRate: last10.length ? last10.filter((m) => m.gf > 0 && m.ga > 0).length / last10.length : null,
    restDays: last ? Math.floor((asOf.getTime() - last.getTime()) / 86400000) : null,
    matchesLast14Days: ms.filter((m) => asOf.getTime() - new Date(m.date).getTime() <= 14 * 86400000).length,
    pointsStdDev: sd,
    sampleSize: ms.length,
  };
}

export interface H2HMatch {
  date: string;
  home: string;
  away: string;
  hg: number;
  ag: number;
  competition: string | null;
}

export interface SourcedTeamStats {
  stats: TeamStats;
  matches: TeamMatch[];
  prov: Provenance;
}
