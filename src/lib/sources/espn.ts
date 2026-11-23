import { similarity } from "../data/teams";
import { computeTeamStats, type TeamMatch } from "../data/stats";
import { httpJson, provenance } from "./http";
import type { Adapter, AdapterResult, MatchContext } from "./types";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const CLUB_LEAGUES = [
  "tur.1", "uefa.champions", "uefa.europa", "uefa.europa.conf", "eng.1", "esp.1", "ger.1", "ita.1", "fra.1",
  "ned.1", "por.1", "bel.1", "sco.1", "eng.2", "tur.2", "gre.1", "ger.2", "ita.2", "esp.2", "fra.2",
];
const NATIONAL_LEAGUES = ["fifa.worldq.uefa", "uefa.nations", "fifa.friendly", "uefa.euroq", "fifa.world", "uefa.euro"];

interface EspnCompetitor {
  homeAway: "home" | "away";
  team: { id: string; displayName: string; shortDisplayName?: string; name?: string };
  score?: string | { value?: number; displayValue?: string };
}
interface EspnEvent {
  id: string;
  date: string;
  name?: string;
  competitions: Array<{ competitors: EspnCompetitor[]; neutralSite?: boolean; status?: { type?: { completed?: boolean } } }>;
  status?: { type?: { completed?: boolean; state?: string } };
  league?: { name?: string };
  season?: { slug?: string };
}

const sbCache = new Map<string, { at: number; events: EspnEvent[] }>();
async function scoreboard(league: string, ymd: string): Promise<EspnEvent[]> {
  const k = `${league}|${ymd}`;
  const c = sbCache.get(k);
  if (c && Date.now() - c.at < 20 * 60000) return c.events;
  const data = await httpJson<{ events?: EspnEvent[] }>(`${BASE}/${league}/scoreboard?dates=${ymd}`, { minGapMs: 400 });
  const events = data.events ?? [];
  sbCache.set(k, { at: Date.now(), events });
  return events;
}

function scoreOf(c: EspnCompetitor): number | null {
  if (c.score == null) return null;
  if (typeof c.score === "string") return c.score === "" ? null : Number(c.score);
  if (typeof c.score.value === "number") return c.score.value;
  return c.score.displayValue ? Number(c.score.displayValue) : null;
}

const names = (c: EspnCompetitor) => [c.team.displayName, c.team.shortDisplayName, c.team.name].filter(Boolean) as string[];
const sim = (c: EspnCompetitor, n: string) => Math.max(...names(c).map((x) => similarity(x, n)));

export async function findEspnEvent(ctx: MatchContext) {
  const ymd = ctx.kickoff.toISOString().slice(0, 10).replace(/-/g, "");
  const leagues = ctx.national ? NATIONAL_LEAGUES : CLUB_LEAGUES;
  for (const lg of leagues) {
    let events: EspnEvent[];
    try {
      events = await scoreboard(lg, ymd);
    } catch {
      continue;
    }
    for (const ev of events) {
      const comp = ev.competitions?.[0];
      if (!comp) continue;
      const h = comp.competitors.find((c) => c.homeAway === "home");
      const a = comp.competitors.find((c) => c.homeAway === "away");
      if (!h || !a) continue;
      if (sim(h, ctx.home.english) >= 0.75 && sim(a, ctx.away.english) >= 0.75) return { league: lg, event: ev, home: h, away: a, neutral: !!comp.neutralSite };
    }
  }
  return null;
}

async function teamHistory(league: string, teamId: string, teamName: string): Promise<{ url: string; matches: TeamMatch[] }> {
  const url = `${BASE}/${league}/teams/${teamId}/schedule`;
  const data = await httpJson<{ events?: EspnEvent[] }>(url, { minGapMs: 400 });
  const out: TeamMatch[] = [];
  for (const ev of data.events ?? []) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const completed = comp.status?.type?.completed ?? ev.status?.type?.completed;
    if (!completed) continue;
    const me = comp.competitors.find((c) => c.team.id === teamId) ?? comp.competitors.find((c) => similarity(c.team.displayName, teamName) > 0.9);
    const op = comp.competitors.find((c) => c !== me);
    if (!me || !op) continue;
    const gf = scoreOf(me);
    const ga = scoreOf(op);
    if (gf == null || ga == null || Number.isNaN(gf) || Number.isNaN(ga)) continue;
    out.push({ date: ev.date, competition: ev.league?.name ?? league, opponent: op.team.displayName, home: me.homeAway === "home", neutral: !!comp.neutralSite, gf, ga });
  }
  return { url, matches: out.sort((a, b) => b.date.localeCompare(a.date)) };
}

export const espnAdapter: Adapter = {
  id: "espn",
  applies: () => true,
  async collect(ctx: MatchContext): Promise<AdapterResult> {
    const found = await findEspnEvent(ctx);
    const ymd = ctx.kickoff.toISOString().slice(0, 10).replace(/-/g, "");
    if (!found) return { sourceId: "espn", status: "empty", url: `${BASE}/{lig}/scoreboard?dates=${ymd}`, error: "ESPN'de maç bulunamadı" };
    const url = `${BASE}/${found.league}/scoreboard?dates=${ymd}`;
    const asOf = new Date(Math.min(ctx.kickoff.getTime(), Date.now()));
    const res: AdapterResult = { sourceId: "espn", status: "ok", url, summary: `${found.event.name ?? ""} (${found.league})` };
    const [hh, ah] = await Promise.allSettled([
      teamHistory(found.league, found.home.team.id, found.home.team.displayName),
      teamHistory(found.league, found.away.team.id, found.away.team.displayName),
    ]);
    if (hh.status === "fulfilled" && hh.value.matches.length)
      res.homeStats = { matches: hh.value.matches, stats: computeTeamStats(hh.value.matches, asOf), prov: provenance("espn", hh.value.url, hh.value.matches[0].date) };
    if (ah.status === "fulfilled" && ah.value.matches.length)
      res.awayStats = { matches: ah.value.matches, stats: computeTeamStats(ah.value.matches, asOf), prov: provenance("espn", ah.value.url, ah.value.matches[0].date) };
    const completed = found.event.competitions[0].status?.type?.completed ?? found.event.status?.type?.completed;
    const hs = scoreOf(found.home);
    const as = scoreOf(found.away);
    if (completed && hs != null && as != null) res.finalScore = { home: hs, away: as, prov: provenance("espn", url, found.event.date) };
    return res;
  },
};
