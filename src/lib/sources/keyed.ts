/** Anahtar gerektiren API'ler: API-Football, football-data.org, The Odds API, Anthropic (opsiyonel). */
import { similarity } from "../data/teams";
import type { H2HMatch } from "../data/stats";
import type { AbsenceEvidence, ExpertPick, OddsEvidence } from "../model/engines";
import { httpGet, httpJson, provenance, requireKey, SourceError } from "./http";
import { parsePickToken, stripHtml } from "./rss";
import type { Adapter, AdapterResult, LineupInfo, MatchContext } from "./types";

// ======================= API-Football =======================

const AF = "https://v3.football.api-sports.io";
interface AfFixture {
  fixture: { id: number; date: string; status: { short: string } };
  league: { id: number; season: number; name: string };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
  goals: { home: number | null; away: number | null };
}
const afDayCache = new Map<string, { at: number; list: AfFixture[] }>();
let afCallsToday = { day: "", n: 0 };

async function af<T>(path: string): Promise<T> {
  const key = requireKey("API_FOOTBALL_KEY");
  const day = new Date().toISOString().slice(0, 10);
  if (afCallsToday.day !== day) afCallsToday = { day, n: 0 };
  const limit = Number(process.env.API_FOOTBALL_DAILY_LIMIT ?? 100);
  if (afCallsToday.n >= limit) throw new SourceError("error", `API-Football günlük istek sınırına (${limit}) ulaşıldı`);
  afCallsToday.n++;
  const j = await httpJson<{ response: T; errors?: unknown }>(`${AF}${path}`, { headers: { "x-apisports-key": key }, minGapMs: 700 });
  const errs = j.errors && typeof j.errors === "object" ? Object.values(j.errors as Record<string, string>) : [];
  if (errs.length) throw new SourceError("error", `API-Football: ${errs.join("; ")}`);
  return j.response;
}

export async function afFindFixture(ctx: MatchContext): Promise<AfFixture | null> {
  const day = ctx.kickoff.toISOString().slice(0, 10);
  let c = afDayCache.get(day);
  if (!c || Date.now() - c.at > 3 * 3600000) {
    c = { at: Date.now(), list: await af<AfFixture[]>(`/fixtures?date=${day}`) };
    afDayCache.set(day, c);
  }
  let best: { f: AfFixture; s: number } | null = null;
  for (const f of c.list) {
    const s = Math.min(similarity(f.teams.home.name, ctx.home.english), similarity(f.teams.away.name, ctx.away.english));
    if (!best || s > best.s) best = { f, s };
  }
  return best && best.s >= 0.72 ? best.f : null;
}

interface AfInjury {
  player: { id: number; name: string; type: string; reason: string };
  team: { id: number; name: string };
}
interface AfPlayerStat {
  statistics: Array<{ games: { appearences: number | null; lineups: number | null } }>;
}

export const apiFootballAdapter: Adapter = {
  id: "api_football",
  applies: () => true,
  async collect(ctx: MatchContext): Promise<AdapterResult> {
    const f = await afFindFixture(ctx);
    const day = ctx.kickoff.toISOString().slice(0, 10);
    if (!f) return { sourceId: "api_football", status: "empty", url: `${AF}/fixtures?date=${day}`, error: "Maç bulunamadı" };
    const url = `${AF}/fixtures?id=${f.fixture.id}`;
    const res: AdapterResult = { sourceId: "api_football", status: "ok", url, summary: `${f.league.name} (#${f.fixture.id})` };

    const inj = await af<AfInjury[]>(`/injuries?fixture=${f.fixture.id}`);
    const absences: AbsenceEvidence[] = [];
    let starterChecks = 0;
    for (const i of inj) {
      const side = i.team.id === f.teams.home.id ? "home" : "away";
      const status: AbsenceEvidence["status"] = /question|doubt/i.test(i.player.type) ? "şüpheli" : /suspend|card/i.test(i.player.reason) ? "cezalı" : "sakat";
      let regularStarter: boolean | null = null;
      if (status !== "şüpheli" && starterChecks < 6) {
        starterChecks++;
        try {
          const ps = await af<AfPlayerStat[]>(`/players?id=${i.player.id}&season=${f.league.season}`);
          const g = ps[0]?.statistics?.reduce(
            (a, s) => ({ apps: a.apps + (s.games.appearences ?? 0), lu: a.lu + (s.games.lineups ?? 0) }),
            { apps: 0, lu: 0 },
          );
          if (g) regularStarter = g.lu >= 5 && g.lu / Math.max(1, g.apps) >= 0.7;
        } catch {
          /* kota dolarsa bilinmiyor kalır */
        }
      }
      absences.push({ side, player: i.player.name, status, regularStarter, reason: i.player.reason, prov: provenance("api_football", `${AF}/injuries?fixture=${f.fixture.id}`, new Date()) });
    }
    res.absences = absences;

    // Resmî ilk 11 genellikle maçtan 20-40 dk önce açıklanır.
    if (ctx.kickoff.getTime() - Date.now() < 90 * 60000) {
      try {
        const lu = await af<Array<{ team: { id: number }; formation: string; startXI: Array<{ player: { name: string } }> }>>(`/fixtures/lineups?fixture=${f.fixture.id}`);
        res.lineups = lu.map(
          (l): LineupInfo => ({
            side: l.team.id === f.teams.home.id ? "home" : "away",
            formation: l.formation,
            startXI: l.startXI.map((p) => p.player.name),
            official: true,
            prov: provenance("api_football", `${AF}/fixtures/lineups?fixture=${f.fixture.id}`, new Date()),
          }),
        );
      } catch {
        /* henüz yok */
      }
    }
    if (["FT", "AET", "PEN"].includes(f.fixture.status.short) && f.goals.home != null && f.goals.away != null) {
      // Spor Toto normal süre sonucunu sayar; AET/PEN için 90 dk skoru ayrıca gerekir, burada sadece FT kullanılır.
      if (f.fixture.status.short === "FT") res.finalScore = { home: f.goals.home, away: f.goals.away, prov: provenance("api_football", url, new Date()) };
    }
    return res;
  },
};

// ======================= football-data.org =======================

const FDO = "https://api.football-data.org/v4";
interface FdoMatch {
  id: number;
  utcDate: string;
  status: string;
  homeTeam: { name: string; shortName?: string };
  awayTeam: { name: string; shortName?: string };
  score: { fullTime: { home: number | null; away: number | null }; duration?: string; regularTime?: { home: number | null; away: number | null } };
  competition?: { name: string };
}
const fdoCache = new Map<string, { at: number; list: FdoMatch[] }>();

export const footballDataOrgAdapter: Adapter = {
  id: "football_data_org",
  applies: () => true,
  async collect(ctx: MatchContext): Promise<AdapterResult> {
    const key = requireKey("FOOTBALL_DATA_ORG_KEY");
    const day = ctx.kickoff.toISOString().slice(0, 10);
    const listUrl = `${FDO}/matches?dateFrom=${day}&dateTo=${day}`;
    let c = fdoCache.get(day);
    if (!c || Date.now() - c.at > 3600000) {
      const j = await httpJson<{ matches: FdoMatch[] }>(listUrl, { headers: { "X-Auth-Token": key }, minGapMs: 6500 });
      c = { at: Date.now(), list: j.matches ?? [] };
      fdoCache.set(day, c);
    }
    const m = c.list.find(
      (x) =>
        Math.max(similarity(x.homeTeam.name, ctx.home.english), similarity(x.homeTeam.shortName ?? "", ctx.home.english)) >= 0.75 &&
        Math.max(similarity(x.awayTeam.name, ctx.away.english), similarity(x.awayTeam.shortName ?? "", ctx.away.english)) >= 0.75,
    );
    if (!m) return { sourceId: "football_data_org", status: "not_applicable", url: listUrl, error: "Maç ücretsiz plan kapsamında değil" };
    const h2hUrl = `${FDO}/matches/${m.id}/head2head?limit=10`;
    const res: AdapterResult = { sourceId: "football_data_org", status: "ok", url: listUrl, summary: m.competition?.name };
    try {
      const j = await httpJson<{ matches: FdoMatch[] }>(h2hUrl, { headers: { "X-Auth-Token": key }, minGapMs: 6500 });
      const list: H2HMatch[] = (j.matches ?? [])
        .filter((x) => x.status === "FINISHED" && x.score.fullTime.home != null)
        .map((x) => ({
          date: x.utcDate,
          home: x.homeTeam.name,
          away: x.awayTeam.name,
          hg: (x.score.regularTime?.home ?? x.score.fullTime.home)!,
          ag: (x.score.regularTime?.away ?? x.score.fullTime.away)!,
          competition: x.competition?.name ?? null,
        }));
      res.h2h = { matches: list, prov: provenance("football_data_org", h2hUrl, new Date()) };
    } catch {
      /* opsiyonel */
    }
    if (m.status === "FINISHED") {
      const rt = m.score.regularTime ?? m.score.fullTime;
      if (rt.home != null && rt.away != null) res.finalScore = { home: rt.home, away: rt.away, prov: provenance("football_data_org", listUrl, m.utcDate) };
    }
    return res;
  },
};

// ======================= The Odds API =======================

const ODDS = "https://api.the-odds-api.com/v4";
const ODDS_SPORTS = [
  "soccer_turkey_super_league", "soccer_epl", "soccer_spain_la_liga", "soccer_germany_bundesliga", "soccer_italy_serie_a",
  "soccer_france_ligue_one", "soccer_uefa_champs_league", "soccer_uefa_europa_league", "soccer_uefa_europa_conference_league",
  "soccer_netherlands_eredivisie", "soccer_portugal_primeira_liga", "soccer_efl_champ", "soccer_uefa_nations_league",
  "soccer_fifa_world_cup_qualifiers_europe", "soccer_belgium_first_div", "soccer_spl", "soccer_greece_super_league",
];
interface OddsEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{ title: string; last_update: string; markets: Array<{ key: string; outcomes: Array<{ name: string; price: number }> }> }>;
}
const oddsCache = new Map<string, { at: number; events: OddsEvent[] }>();
let activeSports: { at: number; keys: Set<string> } | null = null;

export const oddsApiAdapter: Adapter = {
  id: "the_odds_api",
  applies: () => true,
  async collect(ctx: MatchContext): Promise<AdapterResult> {
    const key = requireKey("ODDS_API_KEY");
    if (!activeSports || Date.now() - activeSports.at > 6 * 3600000) {
      const s = await httpJson<Array<{ key: string; active: boolean }>>(`${ODDS}/sports?apiKey=${key}`);
      activeSports = { at: Date.now(), keys: new Set(s.filter((x) => x.active).map((x) => x.key)) };
    }
    for (const sport of ODDS_SPORTS.filter((s) => activeSports!.keys.has(s))) {
      let c = oddsCache.get(sport);
      if (!c || Date.now() - c.at > 60 * 60000) {
        const events = await httpJson<OddsEvent[]>(`${ODDS}/sports/${sport}/odds?regions=eu&markets=h2h&oddsFormat=decimal&apiKey=${key}`);
        c = { at: Date.now(), events };
        oddsCache.set(sport, c);
      }
      const ev = c.events.find(
        (e) =>
          Math.abs(new Date(e.commence_time).getTime() - ctx.kickoff.getTime()) < 6 * 3600000 &&
          similarity(e.home_team, ctx.home.english) >= 0.72 &&
          similarity(e.away_team, ctx.away.english) >= 0.72,
      );
      if (!ev) continue;
      const publicUrl = `${ODDS}/sports/${sport}/odds?regions=eu&markets=h2h`;
      const odds: OddsEvidence[] = [];
      for (const b of ev.bookmakers) {
        const mk = b.markets.find((m) => m.key === "h2h");
        if (!mk) continue;
        const o1 = mk.outcomes.find((o) => o.name === ev.home_team)?.price;
        const o2 = mk.outcomes.find((o) => o.name === ev.away_team)?.price;
        const oX = mk.outcomes.find((o) => o.name === "Draw")?.price;
        if (o1 && oX && o2) odds.push({ bookmaker: b.title, o1, oX, o2, prov: provenance("the_odds_api", publicUrl, b.last_update) });
      }
      if (!odds.length) continue;
      return { sourceId: "the_odds_api", status: "ok", url: publicUrl, evidence: { odds }, summary: `${odds.length} bahis şirketi` };
    }
    return { sourceId: "the_odds_api", status: "empty", url: `${ODDS}/sports`, error: "Maç için oran bulunamadı" };
  },
};

// ======================= Anthropic: uzman yazılarından tahmin çıkarma (opsiyonel) =======================

export interface ArticlePick {
  home: string;
  away: string;
  pick: string;
  author: string | null;
  quote: string;
}

/**
 * EXPERT_ARTICLE_URLS içindeki yazıları indirir, Claude'dan yalnızca metinde açıkça geçen tahminleri
 * birebir alıntıyla istemesini ister. Alıntı metinde birebir yoksa tahmin atılır (uydurma koruması).
 */
export async function extractArticlePicks(url: string): Promise<{ picks: ArticlePick[]; publishedAt: string | null }> {
  const key = requireKey("ANTHROPIC_API_KEY");
  const { text: html } = await httpGet(url, { minGapMs: 2000 });
  const text = stripHtml(html).replace(/\s+/g, " ").slice(0, 60000);
  const publishedAt = html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1] ?? html.match(/article:published_time"\s+content="([^"]+)"/)?.[1] ?? null;
  const body = {
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
    max_tokens: 2000,
    system:
      "Futbol yazılarından maç sonucu tahminlerini çıkaran bir ayrıştırıcısın. Yalnızca metinde AÇIKÇA yazılan 1/X/2, 1X, X2, 12 (veya 0=beraberlik) tahminlerini al. Kendi tahminini ekleme. Her tahmin için metindeki birebir cümleyi 'quote' alanına koy. Çıktı yalnızca JSON dizisi: [{\"home\":\"\",\"away\":\"\",\"pick\":\"\",\"author\":null,\"quote\":\"\"}]. Tahmin yoksa [] döndür.",
    messages: [{ role: "user", content: `Kaynak: ${url}\n\nMetin:\n${text}` }],
  };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new SourceError("error", `Anthropic API HTTP ${res.status}`);
  const j = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const out = j.content.find((c) => c.type === "text")?.text ?? "[]";
  let picks: ArticlePick[] = [];
  try {
    picks = JSON.parse(out.slice(out.indexOf("["), out.lastIndexOf("]") + 1));
  } catch {
    picks = [];
  }
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  return { picks: picks.filter((p) => p.quote && text.includes(norm(p.quote)) && parsePickToken(p.pick)), publishedAt };
}

export const articleExpertAdapter: Adapter = {
  id: "anthropic",
  applies: () => !!(process.env.EXPERT_ARTICLE_URLS ?? "").trim(),
  async collect(ctx: MatchContext): Promise<AdapterResult> {
    const urls = (process.env.EXPERT_ARTICLE_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const experts: ExpertPick[] = [];
    for (const u of urls) {
      const { picks, publishedAt } = await extractArticlePicks(u);
      for (const p of picks) {
        if (similarity(p.home, ctx.home.input) < 0.72 && similarity(p.home, ctx.home.english) < 0.72) continue;
        if (similarity(p.away, ctx.away.input) < 0.72 && similarity(p.away, ctx.away.english) < 0.72) continue;
        const host = new URL(u).host.replace(/^www\./, "");
        experts.push({
          sourceName: `${host}${p.author ? ` (${p.author})` : ""}`,
          author: p.author,
          url: u,
          pick: parsePickToken(p.pick)!,
          publishedAt,
          fetchedAt: new Date().toISOString(),
          originKey: p.author ? `yazar:${p.author.toLowerCase()}` : `site:${host}`,
        });
      }
    }
    return { sourceId: "anthropic", status: experts.length ? "ok" : "empty", url: urls[0], experts, summary: `${experts.length} tahmin (alıntı doğrulamalı)` };
  },
};
