import * as cheerio from "cheerio";
import type { Outcome } from "../types";
import { httpGet, provenance, SourceError } from "./http";

export const SPORTOTO_LIST_URL = "https://www.sportoto.gov.tr/spor-toto-listeler";

export interface ProgramMatch {
  order: number;
  home: string;
  away: string;
  /** Türkiye saatiyle (UTC+3) verilen tarih-saatin UTC karşılığı. */
  kickoff: string;
  score: string | null;
  result: Outcome | null;
}

export interface Program {
  season: string;
  programNo: number;
  closesAt: string | null;
  matches: ProgramMatch[];
  downloadUrl: string | null;
}

const TR_MONTHS: Record<string, number> = {
  ocak: 1, subat: 2, şubat: 2, mart: 3, nisan: 4, mayis: 5, mayıs: 5, haziran: 6, temmuz: 7,
  agustos: 8, ağustos: 8, eylul: 9, eylül: 9, ekim: 10, kasim: 11, kasım: 11, aralik: 12, aralık: 12,
};

/** "15.11.2026" + "22:45" (Türkiye saati, UTC+3, yaz saati uygulaması yok) -> ISO UTC. */
export function trDateTimeToIso(date: string, time: string): string {
  const [d, m, y] = date.split(".").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 3, mm)).toISOString();
}

/** Resmî sonuç sütunu: "1", "0" (beraberlik) veya "2". */
function parseResultCell(v: string): Outcome | null {
  const t = v.trim();
  if (t === "1") return "1";
  if (t === "0" || t.toUpperCase() === "X") return "X";
  if (t === "2") return "2";
  return null;
}

export function parseProgramHtml(html: string): Program {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ");
  const season = text.match(/(\d{4}\/\d{4})\s*Sezonu/)?.[1];
  const programNo = Number(text.match(/(\d{1,3})\.\s*Oyun Program/)?.[1]);
  if (!season || !programNo) throw new SourceError("error", "Sezon veya oyun programı numarası bulunamadı (sayfa yapısı değişmiş olabilir)");

  const rows: string[][] = [];
  $("tr").each((_, tr) => {
    rows.push($(tr).find("td,th").map((__, td) => $(td).text().replace(/\s+/g, " ").trim()).get());
  });
  $("li").each((_, li) => {
    const kids = $(li).children();
    if (kids.length >= 4) rows.push(kids.map((__, k) => $(k).text().replace(/\s+/g, " ").trim()).get());
  });

  const byOrder = new Map<number, ProgramMatch>();
  for (const cells of rows) {
    if (cells.length < 4) continue;
    const order = Number(cells[0]);
    if (!Number.isInteger(order) || order < 1 || order > 15) continue;
    const teams = cells[1];
    const dm = cells[2].match(/(\d{2}\.\d{2}\.\d{4})/);
    const tm = (cells[3] ?? "").match(/(\d{2}:\d{2})/);
    if (!teams.includes(" - ") || !dm || !tm) continue;
    const idx = teams.indexOf(" - ");
    const score = cells[4] && /\d+\s*[-:]\s*\d+/.test(cells[4]) ? cells[4].replace(/\s/g, "") : null;
    byOrder.set(order, {
      order,
      home: teams.slice(0, idx).trim(),
      away: teams.slice(idx + 3).trim(),
      kickoff: trDateTimeToIso(dm[1], tm[1]),
      score,
      result: cells[5] !== undefined ? parseResultCell(cells[5]) : null,
    });
  }

  // Yedek: düz metin üzerinde desen arama.
  if (byOrder.size < 15) {
    const re = /(?:^|\s)(\d{1,2})\s*\|?\s*([^|]+?)\s+-\s+([^|]+?)\s*\|?\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*[A-Za-zÇĞİÖŞÜçğıöşü]+\s*\|?\s*(\d{2}:\d{2})/g;
    for (const m of text.matchAll(re)) {
      const order = Number(m[1]);
      if (order < 1 || order > 15 || byOrder.has(order)) continue;
      byOrder.set(order, { order, home: m[2].trim(), away: m[3].trim(), kickoff: trDateTimeToIso(m[4], m[5]), score: null, result: null });
    }
  }
  const matches = [...byOrder.values()].sort((a, b) => a.order - b.order);
  if (matches.length !== 15) throw new SourceError("error", `Resmî listede 15 yerine ${matches.length} maç okunabildi`);

  let closesAt: string | null = null;
  const cm = text.match(/Kapanış\s*\|?\s*(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\s+[A-Za-zÇĞİÖŞÜçğıöşü]+\s+(\d{4})\s+(\d{2}:\d{2})/);
  if (cm) {
    const mon = TR_MONTHS[cm[2].toLocaleLowerCase("tr-TR")];
    if (mon) closesAt = trDateTimeToIso(`${cm[1].padStart(2, "0")}.${String(mon).padStart(2, "0")}.${cm[3]}`, cm[4]);
  }
  const downloadUrl = $("a")
    .filter((_, a) => $(a).text().includes("Listeyi İndir"))
    .first()
    .attr("href") ?? null;
  return { season, programNo, closesAt, matches, downloadUrl };
}

// ---------------------------------------------------------------- Resmî JSON API
// sportoto.gov.tr/spor-toto-listeler sayfası tabloyu artık tarayıcıda, sitenin kendi
// webapi.sportoto.gov.tr uç noktalarından doldurur (sunucu HTML'inde tablo boştur).
// Aşağıdaki çağrılar sayfanın kendi yaptığı çağrıların aynısıdır.

export const SPORTOTO_API_BASE = "https://webapi.sportoto.gov.tr/";

interface ApiEnvelope<T> {
  object: T;
  isSucceed?: boolean;
  message?: string | null;
}
export interface ApiGameRound {
  id: number;
  name: string; // "17. Oyun Programı"
  year: string; // "2026/2027"
  roundCloseDate: string | null; // Türkiye saati, saat dilimi eki yok
  isPublished: boolean | null;
  attachment?: { attachmentName?: string | null } | null;
}
export interface ApiGameMatch {
  match: {
    date: string; // "2026-11-24T20:45:00" (Türkiye saati)
    fullTimeWin: number | null; // 1 / 0 (beraberlik) / 2
    noterWin: number | null; // 1 = sonuç noter çekilişiyle belirlendi
    score: { homeRegular: number | null; awayRegular: number | null } | null;
    homeTeam: { name: string } | null;
    awayTeam: { name: string } | null;
  } | null;
}

/** Saat dilimi eki olmayan "YYYY-MM-DDTHH:mm:ss" (Türkiye saati) -> ISO UTC. */
export function trLocalIsoToUtc(s: string): string | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m || m[1] === "0001") return null;
  return trDateTimeToIso(`${m[3]}.${m[2]}.${m[1]}`, `${m[4]}:${m[5]}`);
}

export function programNoFromName(name: string): number | null {
  const n = Number(name.match(/^\s*(\d{1,3})\.\s*Oyun Program/)?.[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Yayımlanmış programlar arasından en yüksek numaralı (en güncel) olanı seçer. */
export function pickLatestRound(rounds: ApiGameRound[]): ApiGameRound {
  const published = rounds.filter((r) => r.isPublished !== false && programNoFromName(r.name) !== null);
  if (!published.length) throw new SourceError("error", "Resmî API'de yayımlanmış oyun programı bulunamadı");
  return published.reduce((a, b) => (programNoFromName(b.name)! > programNoFromName(a.name)! ? b : a));
}

function apiOutcome(v: number | null | undefined): Outcome | null {
  if (v === 1) return "1";
  if (v === 0) return "X";
  if (v === 2) return "2";
  return null;
}

export function parseProgramApi(round: ApiGameRound, games: ApiGameMatch[]): Program {
  const programNo = programNoFromName(round.name);
  if (!round.year || !programNo) throw new SourceError("error", `Oyun programı adı/sezonu okunamadı: ${round.name}`);
  const matches: ProgramMatch[] = [];
  games.forEach((g, i) => {
    const m = g.match;
    const home = m?.homeTeam?.name?.trim();
    const away = m?.awayTeam?.name?.trim();
    const kickoff = m?.date ? trLocalIsoToUtc(m.date) : null;
    if (!m || !home || !away || !kickoff) return;
    const result = apiOutcome(m.fullTimeWin);
    const s = m.score;
    const score = s && s.homeRegular != null && s.awayRegular != null ? `${s.homeRegular}-${s.awayRegular}` : null;
    // Sıra: resmî listede maçlar API'nin döndürdüğü sırayla numaralanır.
    matches.push({ order: i + 1, home, away, kickoff, score, result });
  });
  if (games.length !== 15 || matches.length !== 15)
    throw new SourceError("error", `Resmî listede 15 yerine ${matches.length} maç okunabildi`);
  const att = round.attachment?.attachmentName;
  return {
    season: round.year,
    programNo,
    closesAt: round.roundCloseDate ? trLocalIsoToUtc(round.roundCloseDate) : null,
    matches,
    downloadUrl: att ? `${SPORTOTO_API_BASE}image/${att}` : null,
  };
}

async function apiGet<T>(path: string): Promise<T> {
  const { text } = await httpGet(SPORTOTO_API_BASE + path, { minGapMs: 1500, headers: { Accept: "application/json" } });
  let env: ApiEnvelope<T>;
  try {
    env = JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    throw new SourceError("error", `Resmî API geçersiz yanıt verdi: ${path}`);
  }
  if (env.isSucceed === false || env.object == null) throw new SourceError("error", `Resmî API başarısız: ${path} ${env.message ?? ""}`.trim());
  return env.object;
}

export async function fetchProgramApi(): Promise<Program> {
  const years = await apiGet<Array<{ year: string }>>("api/GameRound/GetGameRoundYears");
  const season = years[0]?.year;
  if (!season) throw new SourceError("error", "Resmî API'de sezon bulunamadı");
  const rounds = await apiGet<ApiGameRound[]>(`api/GameRound?year=${encodeURIComponent(season)}&isPublished=true`);
  const round = pickLatestRound(rounds);
  const games = await apiGet<ApiGameMatch[]>(`api/GameMatch/GetGameMatches/?gameRoundId=${round.id}`);
  return parseProgramApi(round, games);
}

export async function fetchProgram() {
  let apiErr: Error | null = null;
  try {
    const program = await fetchProgramApi();
    return { program, prov: provenance("sportoto", SPORTOTO_LIST_URL, new Date()) };
  } catch (e) {
    apiErr = e as Error;
  }
  // Yedek: sayfanın sunucu HTML'i (eski yapı). İkisi de başarısızsa iki hatayı birlikte bildir.
  try {
    const { text } = await httpGet(SPORTOTO_LIST_URL, { minGapMs: 3000 });
    const program = parseProgramHtml(text);
    return { program, prov: provenance("sportoto", SPORTOTO_LIST_URL, new Date()) };
  } catch (e) {
    throw new SourceError("error", `Resmî API: ${apiErr?.message}; HTML sayfası: ${(e as Error).message}`);
  }
}
