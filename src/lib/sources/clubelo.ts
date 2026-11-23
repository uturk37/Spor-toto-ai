import { bestMatch } from "../data/teams";
import { normalize } from "../model/probability";
import { httpGet, parseCsv, provenance } from "./http";
import type { Adapter, AdapterResult, MatchContext } from "./types";

const BASE = "http://api.clubelo.com";

/** Uluslararası ad -> ClubElo'nun kısa adı (bulanık eşleşmenin zorlandığı yaygın durumlar). */
const CLUBELO_NAMES: Record<string, string> = {
  "Paris Saint-Germain": "Paris SG",
  "Manchester United": "Man United",
  "Manchester City": "Man City",
  Internazionale: "Inter",
  "AC Milan": "Milan",
  "AS Roma": "Roma",
  "Atletico Madrid": "Atletico",
  "Sporting CP": "Sporting",
  "Borussia Dortmund": "Dortmund",
  "Borussia Monchengladbach": "Gladbach",
  "Bayer Leverkusen": "Leverkusen",
  "Istanbul Basaksehir": "Bueyueksehir",
  "Shakhtar Donetsk": "Shakhtar",
  "FC Copenhagen": "FC Kobenhavn",
  "Slavia Prague": "Slavia Praha",
  "Sparta Prague": "Sparta Praha",
  "Crvena Zvezda": "Crvena Zvezda",
  "AEK Athens": "AEK",
  "Tottenham Hotspur": "Tottenham",
  "Wolverhampton Wanderers": "Wolves",
  "Newcastle United": "Newcastle",
  "Real Betis": "Betis",
  "Athletic Bilbao": "Bilbao",
  "Real Sociedad": "Sociedad",
};

let rankCache: { day: string; rows: Array<Record<string, string>> } | null = null;
let fixtureCache: { at: number; rows: Array<Record<string, string>> } | null = null;

async function ranks(day: string) {
  if (rankCache?.day === day) return rankCache.rows;
  const { text } = await httpGet(`${BASE}/${day}`, { minGapMs: 1500 });
  rankCache = { day, rows: parseCsv(text) };
  return rankCache.rows;
}

async function fixtures() {
  if (fixtureCache && Date.now() - fixtureCache.at < 30 * 60000) return fixtureCache.rows;
  const { text } = await httpGet(`${BASE}/Fixtures`, { minGapMs: 1500 });
  fixtureCache = { at: Date.now(), rows: parseCsv(text) };
  return fixtureCache.rows;
}

function names(english: string, raw: string) {
  return [CLUBELO_NAMES[english], english, raw].filter(Boolean) as string[];
}

/** ClubElo Fixtures satırındaki "GD=…" sütunlarından 1/X/2. */
export function fixtureRowToProbs(row: Record<string, string>) {
  let p1 = 0, pX = 0, p2 = 0;
  for (const [k, v] of Object.entries(row)) {
    if (!k.startsWith("GD")) continue;
    const val = Number(v);
    if (!Number.isFinite(val)) continue;
    const m = k.match(/^GD([<>=])(-?\d+)$/);
    if (!m) continue;
    const n = Number(m[2]);
    const sign = m[1] === ">" ? 1 : m[1] === "<" ? -1 : Math.sign(n);
    if (sign > 0) p1 += val;
    else if (sign < 0) p2 += val;
    else pX += val;
  }
  if (p1 + pX + p2 <= 0) return null;
  return normalize({ p1, pX, p2 });
}

export const clubEloAdapter: Adapter = {
  id: "clubelo",
  applies: (ctx) => !ctx.national,
  async collect(ctx: MatchContext): Promise<AdapterResult> {
    const day = new Date(Math.min(ctx.kickoff.getTime(), Date.now())).toISOString().slice(0, 10);
    const url = `${BASE}/${day}`;
    const rows = await ranks(day);
    const h = bestMatch(ctx.home.english, rows, (r) => [r.Club], 0.8) ?? bestMatch(ctx.home.input, rows, (r) => [r.Club], 0.8);
    const a = bestMatch(ctx.away.english, rows, (r) => [r.Club], 0.8) ?? bestMatch(ctx.away.input, rows, (r) => [r.Club], 0.8);
    const hn = CLUBELO_NAMES[ctx.home.english] ? rows.find((r) => r.Club === CLUBELO_NAMES[ctx.home.english]) ?? h : h;
    const an = CLUBELO_NAMES[ctx.away.english] ? rows.find((r) => r.Club === CLUBELO_NAMES[ctx.away.english]) ?? a : a;
    if (!hn || !an) {
      return { sourceId: "clubelo", status: "empty", url, error: `Takım bulunamadı: ${!hn ? ctx.home.input : ""} ${!an ? ctx.away.input : ""}`.trim() };
    }
    const prov = provenance("clubelo", url, day);
    const result: AdapterResult = {
      sourceId: "clubelo",
      status: "ok",
      url,
      dataAsOf: prov.dataAsOf,
      evidence: { elo: { home: Number(hn.Elo), away: Number(an.Elo), homeAdvantage: 65, prov } },
      summary: `${hn.Club} ${Math.round(Number(hn.Elo))} – ${an.Club} ${Math.round(Number(an.Elo))}`,
    };
    try {
      const fx = await fixtures();
      const row = fx.find(
        (r) => r.Date === ctx.kickoff.toISOString().slice(0, 10) && names(ctx.home.english, hn.Club).includes(r.Home) && names(ctx.away.english, an.Club).includes(r.Away),
      ) ?? fx.find((r) => r.Home === hn.Club && r.Away === an.Club);
      const probs = row ? fixtureRowToProbs(row) : null;
      if (probs) result.evidence!.sourceModelProbs = [{ probs, prov: provenance("clubelo", `${BASE}/Fixtures`, new Date()) }];
    } catch {
      /* fikstür olasılıkları opsiyonel */
    }
    return result;
  },
};

/** Takımın ClubElo puanını döner (rakip gücü analizi için). */
export async function eloLookup(day: string): Promise<(name: string) => number | null> {
  const rows = await ranks(day);
  return (name: string) => {
    const r = rows.find((x) => x.Club === (CLUBELO_NAMES[name] ?? name)) ?? bestMatch(name, rows, (x) => [x.Club], 0.85);
    return r ? Number(r.Elo) : null;
  };
}
