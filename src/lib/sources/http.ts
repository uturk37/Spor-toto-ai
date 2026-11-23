import type { Provenance, SourceStatus } from "../types";
import { sourceById } from "./registry";

const UA = process.env.HTTP_USER_AGENT || "SporTotoAI/0.1 (+kisisel analiz araci)";

export class SourceError extends Error {
  constructor(
    public status: SourceStatus,
    message: string,
  ) {
    super(message);
  }
}

const lastCall = new Map<string, number>();

/** Aynı ana makineye istekler arasında en az minGapMs bekler (nazik erişim). */
async function throttle(host: string, minGapMs: number) {
  const now = Date.now();
  const last = lastCall.get(host) ?? 0;
  const wait = last + minGapMs - now;
  lastCall.set(host, Math.max(now, last + minGapMs));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export async function httpGet(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; minGapMs?: number; retries?: number } = {},
): Promise<{ text: string; status: number; headers: Headers }> {
  const host = new URL(url).host;
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(host, (opts.minGapMs ?? 1000) * Number(process.env.HTTP_THROTTLE_SCALE ?? 1));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "*/*", ...opts.headers },
        signal: ctrl.signal,
        cache: "no-store",
      });
      const text = await res.text();
      if (res.status === 429 || res.status >= 500) {
        lastErr = new SourceError("error", `HTTP ${res.status}`);
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      if (res.status >= 400) throw new SourceError("error", `HTTP ${res.status}: ${text.slice(0, 200)}`);
      return { text, status: res.status, headers: res.headers };
    } catch (e) {
      lastErr = e;
      if (e instanceof SourceError && e.message.startsWith("HTTP 4")) throw e;
    } finally {
      clearTimeout(t);
    }
  }
  if (lastErr instanceof SourceError) throw lastErr;
  throw new SourceError("error", networkErrorMessage(host, lastErr));
}

/** "fetch failed" yerine hangi sunucuya neden ulaşılamadığını söyler. */
export function networkErrorMessage(host: string, err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } } | null;
  if (e?.name === "AbortError") return `${host} zaman aşımı (yanıt gelmedi)`;
  const code = e?.cause?.code ?? e?.cause?.message;
  if (code) return `${host} erişilemedi (${code})`;
  return `${host}: ${e?.message ?? String(err)}`;
}

/** Ağ düzeyinde erişim hatası mı (HTTP yanıtı hiç alınamadı)? */
export function isNetworkError(e: unknown): boolean {
  return e instanceof SourceError && /erişilemedi|zaman aşımı/.test(e.message);
}

export async function httpJson<T>(url: string, opts?: Parameters<typeof httpGet>[1]): Promise<T> {
  const { text } = await httpGet(url, { ...opts, headers: { Accept: "application/json", ...opts?.headers } });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SourceError("error", `Geçersiz JSON: ${url}`);
  }
}

export function provenance(sourceId: string, url: string, dataAsOf: Date | string | null = null): Provenance {
  return {
    sourceId,
    sourceName: sourceById(sourceId)?.name ?? sourceId,
    url,
    fetchedAt: new Date().toISOString(),
    dataAsOf: dataAsOf ? new Date(dataAsOf).toISOString() : null,
  };
}

export function requireKey(envKey: string): string {
  const v = process.env[envKey];
  if (!v) throw new SourceError("missing_key", `${envKey} tanımlı değil`);
  return v;
}

/** Basit CSV ayrıştırıcı (tırnaklı alanları destekler). */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}
