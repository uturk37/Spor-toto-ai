import { bestMatch } from "../data/teams";
import { httpGet, provenance, SourceError } from "./http";
import type { Adapter, AdapterResult, MatchContext } from "./types";

const LEAGUES = ["EPL", "La_liga", "Bundesliga", "Serie_A", "Ligue_1", "RFPL"];

interface UnderstatHistory {
  h_a: "h" | "a";
  xG: number;
  xGA: number;
  scored: number;
  missed: number;
  date: string;
}
interface UnderstatTeam {
  id: string;
  title: string;
  history: UnderstatHistory[];
}

const cache = new Map<string, { at: number; teams: UnderstatTeam[] }>();

/** Understat sayfasındaki `teamsData = JSON.parse('...')` bloğunu çözer. */
export function parseTeamsData(html: string): UnderstatTeam[] {
  const m = html.match(/teamsData\s*=\s*JSON\.parse\('([^']+)'\)/);
  if (!m) throw new SourceError("error", "teamsData bulunamadı");
  const decoded = m[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return Object.values(JSON.parse(decoded)) as UnderstatTeam[];
}

async function leagueTeams(league: string, season: number): Promise<{ url: string; teams: UnderstatTeam[] }> {
  const k = `${league}|${season}`;
  const url = `https://understat.com/league/${league}/${season}`;
  const c = cache.get(k);
  if (c && Date.now() - c.at < 6 * 3600000) return { url, teams: c.teams };
  let teams: UnderstatTeam[];
  try {
    const { text } = await httpGet(url, { minGapMs: 3000 });
    teams = parseTeamsData(text);
  } catch {
    // Yeni sürümde veri ayrı bir JSON uç noktasından geliyor olabilir.
    const { text } = await httpGet(`https://understat.com/getLeagueData/${league}/${season}`, {
      minGapMs: 3000,
      headers: { "X-Requested-With": "XMLHttpRequest", Referer: url },
    });
    const j = JSON.parse(text) as { teams?: Record<string, UnderstatTeam> };
    if (!j.teams) throw new SourceError("error", "Understat yanıtı beklenen biçimde değil");
    teams = Object.values(j.teams);
  }
  cache.set(k, { at: Date.now(), teams });
  return { url, teams };
}

export const understatAdapter: Adapter = {
  id: "understat",
  applies: (ctx) => !ctx.national,
  async collect(ctx: MatchContext): Promise<AdapterResult> {
    const d = ctx.kickoff;
    const season = d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
    let lastUrl = "https://understat.com";
    const found: { home?: UnderstatTeam; away?: UnderstatTeam; url?: string } = {};
    for (const lg of LEAGUES) {
      const { url, teams } = await leagueTeams(lg, season);
      lastUrl = url;
      const h = bestMatch(ctx.home.english, teams, (t) => [t.title], 0.8);
      const a = bestMatch(ctx.away.english, teams, (t) => [t.title], 0.8);
      if (h && !found.home) found.home = h;
      if (a && !found.away) found.away = a;
      if (h || a) found.url = url;
      if (found.home && found.away) break;
    }
    if (!found.home && !found.away) return { sourceId: "understat", status: "not_applicable", url: lastUrl, error: "Takımlar Understat liglerinde değil" };
    const asOf = new Date(Math.min(d.getTime(), Date.now()));
    const toXg = (t?: UnderstatTeam) =>
      t
        ? t.history
            .filter((h) => new Date(h.date.replace(" ", "T") + "Z") < asOf)
            .sort((a, b) => b.date.localeCompare(a.date))
        : [];
    const hh = toXg(found.home);
    const ah = toXg(found.away);
    const prov = provenance("understat", found.url!, hh[0]?.date ?? ah[0]?.date ?? null);
    const res: AdapterResult = { sourceId: "understat", status: "ok", url: found.url! };
    // xG'yi Poisson modeline iç saha / dış saha ayrımıyla aktar.
    const hHome = hh.filter((x) => x.h_a === "h").slice(0, 10);
    const aAway = ah.filter((x) => x.h_a === "a").slice(0, 10);
    if (hHome.length && aAway.length) {
      res.evidence = {
        homeAtHome: {
          n: hHome.length,
          goalsFor: hHome.reduce((s, x) => s + Number(x.scored), 0),
          goalsAgainst: hHome.reduce((s, x) => s + Number(x.missed), 0),
          xg: hHome.reduce((s, x) => s + Number(x.xG), 0),
          xga: hHome.reduce((s, x) => s + Number(x.xGA), 0),
          prov,
        },
        awayAway: {
          n: aAway.length,
          goalsFor: aAway.reduce((s, x) => s + Number(x.scored), 0),
          goalsAgainst: aAway.reduce((s, x) => s + Number(x.missed), 0),
          xg: aAway.reduce((s, x) => s + Number(x.xG), 0),
          xga: aAway.reduce((s, x) => s + Number(x.xGA), 0),
          prov,
        },
      };
    }
    const avg = (arr: UnderstatHistory[], k: "xG" | "xGA") => (arr.length ? arr.slice(0, 10).reduce((s, x) => s + Number(x[k]), 0) / Math.min(10, arr.length) : null);
    res.summary = `xG/xGA son 10: ev ${fmt(avg(hh, "xG"))}/${fmt(avg(hh, "xGA"))}, dep ${fmt(avg(ah, "xG"))}/${fmt(avg(ah, "xGA"))}`;
    res.dataAsOf = prov.dataAsOf;
    return res;
  },
};

function fmt(v: number | null) {
  return v == null ? "—" : v.toFixed(2);
}
