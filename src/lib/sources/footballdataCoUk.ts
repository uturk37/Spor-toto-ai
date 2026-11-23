import { bestMatch, similarity } from "../data/teams";
import { computeTeamStats, type H2HMatch, type TeamMatch } from "../data/stats";
import type { OddsEvidence } from "../model/engines";
import { httpGet, parseCsv, provenance } from "./http";
import type { Adapter, AdapterResult, MatchContext } from "./types";

const BASE = "https://www.football-data.co.uk";
const DIVS = ["T1", "E0", "E1", "SP1", "D1", "I1", "F1", "N1", "P1", "B1", "SC0", "G1", "D2", "I2", "SP2", "F2"];
const BOOKMAKERS: Array<[string, string]> = [
  ["B365", "Bet365"], ["BW", "Bet&Win"], ["PS", "Pinnacle"], ["WH", "William Hill"], ["VC", "VC Bet"], ["IW", "Interwetten"], ["BF", "Betfair"],
];
const NAME_FIX: Record<string, string> = {
  "Manchester United": "Man United",
  "Manchester City": "Man City",
  "Paris Saint-Germain": "Paris SG",
  Internazionale: "Inter",
  "AC Milan": "Milan",
  "AS Roma": "Roma",
  "Atletico Madrid": "Ath Madrid",
  "Athletic Bilbao": "Ath Bilbao",
  "Istanbul Basaksehir": "Buyuksehyr",
  "Borussia Dortmund": "Dortmund",
  "Bayer Leverkusen": "Leverkusen",
  "Borussia Monchengladbach": "M'gladbach",
  "Real Sociedad": "Sociedad",
  "Real Betis": "Betis",
  "Sporting CP": "Sp Lisbon",
  Rizespor: "Rizespor",
};

export function seasonCode(d: Date): string {
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 6 ? y : y - 1;
  return `${String(start % 100).padStart(2, "0")}${String((start + 1) % 100).padStart(2, "0")}`;
}

/** "21/11/2026" veya "21/11/26" -> ISO (saat bilinmiyorsa 12:00 UTC). */
export function fdDate(date: string, time?: string): string {
  const [d, m, y] = date.split("/").map(Number);
  const year = y < 100 ? 2000 + y : y;
  const [hh, mm] = time ? time.split(":").map(Number) : [12, 0];
  // football-data.co.uk saatleri İngiltere saatidir; ±1 saat tarih düzeyindeki analizi etkilemez.
  return new Date(Date.UTC(year, m - 1, d, hh, mm)).toISOString();
}

const csvCache = new Map<string, { at: number; rows: Array<Record<string, string>> }>();
async function csv(url: string, ttlMs = 3 * 3600000) {
  const c = csvCache.get(url);
  if (c && Date.now() - c.at < ttlMs) return c.rows;
  const { text } = await httpGet(url, { minGapMs: 1500 });
  const rows = parseCsv(text);
  csvCache.set(url, { at: Date.now(), rows });
  return rows;
}

const nm = (eng: string, raw: string) => [NAME_FIX[eng], eng, raw].filter(Boolean) as string[];

function teamMatchesFrom(rows: Array<Record<string, string>>, team: string, div: string): TeamMatch[] {
  const out: TeamMatch[] = [];
  for (const r of rows) {
    if (!r.FTHG || r.FTHG === "") continue;
    const isHome = r.HomeTeam === team;
    if (!isHome && r.AwayTeam !== team) continue;
    const num = (k: string) => (r[k] === undefined || r[k] === "" ? null : Number(r[k]));
    out.push({
      date: fdDate(r.Date, r.Time),
      competition: div,
      opponent: isHome ? r.AwayTeam : r.HomeTeam,
      home: isHome,
      gf: Number(isHome ? r.FTHG : r.FTAG),
      ga: Number(isHome ? r.FTAG : r.FTHG),
      htGf: num(isHome ? "HTHG" : "HTAG"),
      htGa: num(isHome ? "HTAG" : "HTHG"),
      shots: num(isHome ? "HS" : "AS"),
      shotsAgainst: num(isHome ? "AS" : "HS"),
      shotsOnTarget: num(isHome ? "HST" : "AST"),
      shotsOnTargetAgainst: num(isHome ? "AST" : "HST"),
      corners: num(isHome ? "HC" : "AC"),
      cornersAgainst: num(isHome ? "AC" : "HC"),
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

function findTeam(rows: Array<Record<string, string>>, eng: string, raw: string): string | null {
  const teams = [...new Set(rows.flatMap((r) => [r.HomeTeam, r.AwayTeam]).filter(Boolean))];
  for (const n of nm(eng, raw)) if (teams.includes(n)) return n;
  return bestMatch(eng, teams, (t) => [t], 0.8) ?? bestMatch(raw, teams, (t) => [t], 0.8);
}

export function oddsFromRow(r: Record<string, string>, prov: ReturnType<typeof provenance>): OddsEvidence[] {
  const out: OddsEvidence[] = [];
  for (const [code, name] of BOOKMAKERS) {
    const o1 = Number(r[`${code}H`]), oX = Number(r[`${code}D`]), o2 = Number(r[`${code}A`]);
    if (o1 > 1 && oX > 1 && o2 > 1) out.push({ bookmaker: name, o1, oX, o2, prov });
  }
  if (!out.length) {
    const o1 = Number(r.AvgH), oX = Number(r.AvgD), o2 = Number(r.AvgA);
    if (o1 > 1 && oX > 1 && o2 > 1) out.push({ bookmaker: "Piyasa ortalaması", o1, oX, o2, prov });
  }
  return out;
}

export const footballDataCoUkAdapter: Adapter = {
  id: "footballdata_couk",
  applies: (ctx) => !ctx.national,
  async collect(ctx: MatchContext): Promise<AdapterResult> {
    const code = seasonCode(ctx.kickoff);
    // 1) Takımların ligini bul (bu sezonun lig dosyalarında ikisi birden geçen ilk lig).
    let div: string | null = null;
    let rows: Array<Record<string, string>> = [];
    let homeName: string | null = null;
    let awayName: string | null = null;
    type League = { div: string; rows: Array<Record<string, string>>; name: string };
    let homeLeague: League | null = null;
    let awayLeague: League | null = null;
    for (const d of DIVS) {
      let r: Array<Record<string, string>>;
      try {
        r = await csv(`${BASE}/mmz4281/${code}/${d}.csv`);
      } catch {
        continue;
      }
      const h = findTeam(r, ctx.home.english, ctx.home.input);
      const a = findTeam(r, ctx.away.english, ctx.away.input);
      if (h && !homeLeague) homeLeague = { div: d, rows: r, name: h };
      if (a && !awayLeague) awayLeague = { div: d, rows: r, name: a };
      if (h && a) {
        div = d;
        rows = r;
        homeName = h;
        awayName = a;
        break;
      }
      if (homeLeague && awayLeague) break;
    }
    if (!homeLeague && !awayLeague) {
      return { sourceId: "footballdata_couk", status: "empty", url: `${BASE}/data.php`, error: "Takımlar kapsanan liglerde bulunamadı" };
    }
    const asOf = new Date(Math.min(ctx.kickoff.getTime(), Date.now()));
    const res: AdapterResult = { sourceId: "footballdata_couk", status: "ok", url: `${BASE}/mmz4281/${code}/${div ?? homeLeague?.div ?? awayLeague?.div}.csv` };
    const mk = (lg: { div: string; rows: Array<Record<string, string>>; name: string }) => {
      const url = `${BASE}/mmz4281/${code}/${lg.div}.csv`;
      const matches = teamMatchesFrom(lg.rows, lg.name, lg.div);
      return { stats: computeTeamStats(matches, asOf), matches, prov: provenance("footballdata_couk", url, matches[0]?.date ?? null) };
    };
    if (homeLeague) res.homeStats = mk(homeLeague);
    if (awayLeague) res.awayStats = mk(awayLeague);

    // Lig ortalamaları ve gol kayıtları (Poisson modeli için) yalnızca iki takım aynı ligdeyse.
    if (div && homeName && awayName) {
      const played = rows.filter((r) => r.FTHG !== "" && r.FTHG !== undefined && new Date(fdDate(r.Date, r.Time)) < asOf);
      const prov = provenance("footballdata_couk", res.url, played.length ? fdDate(played[played.length - 1].Date) : null);
      if (played.length >= 30) {
        res.evidence = {
          leagueAverages: {
            home: played.reduce((a, r) => a + Number(r.FTHG), 0) / played.length,
            away: played.reduce((a, r) => a + Number(r.FTAG), 0) / played.length,
            prov,
          },
        };
      }
      const hm = res.homeStats!.matches.filter((m) => m.home).slice(0, 10);
      const am = res.awayStats!.matches.filter((m) => !m.home).slice(0, 10);
      res.evidence = {
        ...res.evidence,
        homeAtHome: { n: hm.length, goalsFor: hm.reduce((a, m) => a + m.gf, 0), goalsAgainst: hm.reduce((a, m) => a + m.ga, 0), prov },
        awayAway: { n: am.length, goalsFor: am.reduce((a, m) => a + m.gf, 0), goalsAgainst: am.reduce((a, m) => a + m.ga, 0), prov },
      };

      // İkili rekabet: bu ve önceki 4 sezonun lig maçları.
      const h2h: H2HMatch[] = [];
      const start = Number(code.slice(0, 2));
      for (let i = 0; i < 5; i++) {
        const c = `${String((start - i + 100) % 100).padStart(2, "0")}${String((start - i + 101) % 100).padStart(2, "0")}`;
        let r: Array<Record<string, string>>;
        try {
          r = i === 0 ? rows : await csv(`${BASE}/mmz4281/${c}/${div}.csv`, 7 * 86400000);
        } catch {
          continue;
        }
        for (const x of r) {
          const pair = (x.HomeTeam === homeName && x.AwayTeam === awayName) || (x.HomeTeam === awayName && x.AwayTeam === homeName);
          if (pair && x.FTHG !== "") h2h.push({ date: fdDate(x.Date, x.Time), home: x.HomeTeam, away: x.AwayTeam, hg: Number(x.FTHG), ag: Number(x.FTAG), competition: div });
        }
      }
      h2h.sort((a, b) => b.date.localeCompare(a.date));
      res.h2h = { matches: h2h.filter((m) => new Date(m.date) < asOf).slice(0, 10), prov: provenance("footballdata_couk", `${BASE}/data.php`) };
    }

    // Yaklaşan maç oranları.
    try {
      const fx = await csv(`${BASE}/fixtures.csv`, 30 * 60000);
      const day = ctx.kickoff.toISOString().slice(0, 10);
      const row = fx.find(
        (r) =>
          Math.abs(new Date(fdDate(r.Date)).getTime() - new Date(`${day}T12:00:00Z`).getTime()) <= 86400000 &&
          similarity(r.HomeTeam, homeName ?? ctx.home.english) >= 0.8 &&
          similarity(r.AwayTeam, awayName ?? ctx.away.english) >= 0.8,
      );
      if (row) {
        const odds = oddsFromRow(row, provenance("footballdata_couk", `${BASE}/fixtures.csv`, new Date()));
        if (odds.length) res.evidence = { ...res.evidence, odds };
      }
    } catch {
      /* oranlar opsiyonel */
    }
    res.summary = div ? `${div} ligi verisi, ${res.h2h?.matches.length ?? 0} ikili rekabet maçı` : "Takımlar farklı liglerde; sadece takım istatistikleri";
    return res;
  },
};
