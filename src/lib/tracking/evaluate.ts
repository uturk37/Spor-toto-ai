import type { Outcome, Pick, Probs } from "../types";
import { pickHits, pickSize } from "../coupon/math";
import { argmax } from "../model/probability";
import { createHash } from "node:crypto";

export interface GradeInputMatch {
  order: number;
  result: Outcome | null; // null: henüz bitmedi / ertelendi
  aiProbs: Probs | null;
  aiPick: Pick | null; // önerilen tercih (tekli/çifte/üçlü)
  expertConsensus: Pick | null;
}

export interface WeekGrade {
  graded: number;
  aiMainCorrect: number;
  aiPickCorrect: number;
  singles: { total: number; correct: number };
  doubles: { total: number; correct: number };
  triples: { total: number; correct: number };
  expert: { total: number; correct: number };
  allFifteen: boolean | null;
}

/** Bir haftanın tahminlerini gerçek sonuçlarla karşılaştırır. Sonucu olmayan maçlar sayılmaz. */
export function gradeWeek(matches: GradeInputMatch[]): WeekGrade {
  const g: WeekGrade = {
    graded: 0,
    aiMainCorrect: 0,
    aiPickCorrect: 0,
    singles: { total: 0, correct: 0 },
    doubles: { total: 0, correct: 0 },
    triples: { total: 0, correct: 0 },
    expert: { total: 0, correct: 0 },
    allFifteen: null,
  };
  let allHit = true;
  let complete = true;
  for (const m of matches) {
    if (!m.result) {
      complete = false;
      continue;
    }
    g.graded++;
    if (m.aiProbs && argmax(m.aiProbs) === m.result) g.aiMainCorrect++;
    if (m.aiPick) {
      const hit = pickHits(m.aiPick, m.result);
      if (hit) g.aiPickCorrect++;
      else allHit = false;
      const bucket = pickSize(m.aiPick) === 1 ? g.singles : pickSize(m.aiPick) === 2 ? g.doubles : g.triples;
      bucket.total++;
      if (hit) bucket.correct++;
    } else allHit = false;
    if (m.expertConsensus) {
      g.expert.total++;
      if (pickHits(m.expertConsensus, m.result)) g.expert.correct++;
    }
  }
  g.allFifteen = complete && matches.length === 15 ? allHit : null;
  return g;
}

export function rate(correct: number, total: number): number | null {
  return total ? correct / total : null;
}

// ---------------- Değiştirilemez kayıt zinciri ----------------

/**
 * Kayıttaki tüm sayıları 6 ondalığa yuvarlar. Veritabanının JSON sayı gösterimi ile JavaScript'inki
 * çok uzun ondalıklarda farklılaşabildiği için kayıt hem saklanmadan hem özetlenmeden önce yuvarlanır.
 */
export function roundDeep<T>(value: T, digits = 6): T {
  const f = 10 ** digits;
  if (typeof value === "number") return (Number.isFinite(value) ? Math.round(value * f) / f : value) as T;
  if (Array.isArray(value)) return value.map((v) => roundDeep(v, digits)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).map(([k, v]) => [k, roundDeep(v, digits)])) as T;
  }
  return value;
}

/** Kanonik JSON (anahtarlar sıralı) — aynı içerik her zaman aynı özeti verir. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

export function chainHash(prevHash: string | null, createdAtIso: string, payload: unknown): string {
  return createHash("sha256")
    .update(prevHash ?? "GENESIS")
    .update("|")
    .update(createdAtIso)
    .update("|")
    .update(canonicalJson(payload))
    .digest("hex");
}

export interface ChainRecord {
  createdAt: string;
  payload: unknown;
  prevHash: string | null;
  hash: string;
}

/** Zinciri baştan doğrular; herhangi bir kayıt sonradan değiştirildiyse ilk bozuk kaydın indeksini döner. */
export function verifyChain(records: ChainRecord[]): { ok: boolean; brokenAt: number | null } {
  let prev: string | null = null;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.prevHash !== prev || chainHash(prev, r.createdAt, r.payload) !== r.hash) return { ok: false, brokenAt: i };
    prev = r.hash;
  }
  return { ok: true, brokenAt: null };
}
