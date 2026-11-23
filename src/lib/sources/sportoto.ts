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

export async function fetchProgram() {
  const { text } = await httpGet(SPORTOTO_LIST_URL, { minGapMs: 3000 });
  const program = parseProgramHtml(text);
  return { program, prov: provenance("sportoto", SPORTOTO_LIST_URL, new Date()) };
}
