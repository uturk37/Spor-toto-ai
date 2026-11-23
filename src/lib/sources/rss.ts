import { XMLParser } from "fast-xml-parser";
import { normalizeName } from "../data/teams";
import type { ExpertPick } from "../model/engines";
import type { Pick } from "../types";
import { httpGet, provenance } from "./http";
import type { Adapter, AdapterResult, MatchContext, NewsHit } from "./types";

export interface FeedItem {
  title: string;
  link: string;
  description: string;
  content: string;
  author: string | null;
  publishedAt: string | null;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text" });

function txt(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)["#text"]);
  return "";
}

/** RSS 2.0 ve Atom akışlarını tek biçime çevirir. */
export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml);
  const items: FeedItem[] = [];
  const rssItems = doc?.rss?.channel?.item;
  if (rssItems) {
    for (const it of Array.isArray(rssItems) ? rssItems : [rssItems]) {
      items.push({
        title: txt(it.title),
        link: txt(it.link),
        description: txt(it.description),
        content: txt(it["content:encoded"]) || txt(it.description),
        author: txt(it.author) || txt(it["dc:creator"]) || null,
        publishedAt: it.pubDate ? new Date(txt(it.pubDate)).toISOString() : null,
      });
    }
  }
  const entries = doc?.feed?.entry;
  if (entries) {
    for (const e of Array.isArray(entries) ? entries : [entries]) {
      const links = Array.isArray(e.link) ? e.link : [e.link];
      const alt = links.find((l: Record<string, string>) => l?.["@rel"] === "alternate") ?? links[0];
      items.push({
        title: txt(e.title),
        link: alt?.["@href"] ?? "",
        description: txt(e.summary),
        content: txt(e.content) || txt(e.summary),
        author: txt(e.author?.name) || null,
        publishedAt: e.published ? new Date(txt(e.published)).toISOString() : e.updated ? new Date(txt(e.updated)).toISOString() : null,
      });
    }
  }
  return items;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

const feedCache = new Map<string, { at: number; items: FeedItem[] }>();
export async function fetchFeed(url: string, ttlMs = 15 * 60000): Promise<FeedItem[]> {
  const c = feedCache.get(url);
  if (c && Date.now() - c.at < ttlMs) return c.items;
  const { text } = await httpGet(url, { minGapMs: 2000 });
  const items = parseFeed(text);
  feedCache.set(url, { at: Date.now(), items });
  return items;
}

// ---------------- Haber (sakatlık/kadro) akışları ----------------

const INJURY = /\b(injur\w*|ruled out|doubt\w*|suspen\w*|sidelined|hamstring|knock|fitness|miss(es)? the|unavailable|sakat\w*|ceza\w*|kadroda yok|forma giyemeyecek|oynayamayacak)\b/i;
const LINEUP = /\b(line-?up|starting xi|team news|ilk 11|kadro)\b/i;

const NEWS_FEEDS: Array<{ id: string; url: string }> = [
  { id: "bbc", url: "https://feeds.bbci.co.uk/sport/football/rss.xml" },
  { id: "skysports", url: "https://www.skysports.com/rss/12040" },
];

function mentions(text: string, ctxName: { input: string; english: string }) {
  const t = ` ${normalizeName(text)} `;
  return [ctxName.english, ctxName.input].some((n) => {
    const k = normalizeName(n);
    return k.length >= 4 && t.includes(` ${k} `);
  });
}

export function newsAdapterFor(id: string, url: string): Adapter {
  return {
    id,
    applies: () => true,
    async collect(ctx: MatchContext): Promise<AdapterResult> {
      const items = await fetchFeed(url);
      const since = ctx.kickoff.getTime() - 7 * 86400000;
      const hits: NewsHit[] = [];
      for (const it of items) {
        if (it.publishedAt && new Date(it.publishedAt).getTime() < since) continue;
        const text = `${it.title} ${stripHtml(it.description)}`;
        for (const side of ["home", "away"] as const) {
          if (!mentions(text, ctx[side])) continue;
          hits.push({
            title: it.title,
            url: it.link,
            publishedAt: it.publishedAt,
            side,
            kind: INJURY.test(text) ? "sakatlik" : LINEUP.test(text) ? "kadro" : "genel",
            prov: provenance(id, it.link, it.publishedAt),
          });
        }
      }
      return { sourceId: id, status: hits.length ? "ok" : "empty", url, news: hits, summary: `${hits.length} ilgili haber` };
    },
  };
}

export const newsAdapters = NEWS_FEEDS.map((f) => newsAdapterFor(f.id, f.url));

// ---------------- Tahmin blogları (uzman görüşü) ----------------

export function expertFeeds(): string[] {
  const extra = (process.env.EXPERT_FEEDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return [
    "https://www.sportotolistesi.com/feeds/posts/default",
    "https://sportotolistesi.blogspot.com/feeds/posts/default",
    ...extra,
  ];
}

/** Blog yazısındaki "10", "02", "1X", "102" gibi işaretleri tercih tipine çevirir. */
export function parsePickToken(tok: string): Pick | null {
  const t = tok.trim().toUpperCase().replace(/0/g, "X").replace(/[^1X2]/g, "");
  if (!t || t.length > 3) return null;
  const set = new Set(t.split(""));
  if (set.size !== t.length) return null;
  const order = ["1", "X", "2"].filter((o) => set.has(o)).join("");
  return order as Pick;
}

export interface ExtractedPick {
  home: string;
  away: string;
  pick: Pick;
  line: string;
}

/**
 * Yazı metninden maç–tahmin satırlarını çıkarır. Desteklenen biçimler:
 *  "1. Konyaspor - Galatasaray........2"   ve   "Başakşehir – Samsunspor | Tahmin: 1"
 */
export function extractPicksFromText(text: string): ExtractedPick[] {
  const out: ExtractedPick[] = [];
  for (const raw of text.split(/\n+/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    let m = line.match(/^(?:\d{1,2}[.)]\s*)?(.+?)\s*[-–]\s*(.+?)\s*\|\s*Tahmin\s*:\s*([0-2X]{1,3})\b/i);
    if (!m) m = line.match(/^(?:\d{1,2}[.)]\s*)?(.+?)\s*[-–]\s*(.+?)\s*\.{3,}\s*([0-2X]{1,3})\s*$/i);
    if (!m) continue;
    const pick = parsePickToken(m[3]);
    if (!pick) continue;
    out.push({ home: m[1].trim(), away: m[2].replace(/\.+$/, "").trim(), pick, line });
  }
  return out;
}

export const tipsterAdapter: Adapter = {
  id: "tipster_blogs",
  applies: () => true,
  async collect(ctx: MatchContext): Promise<AdapterResult> {
    const picks: ExpertPick[] = [];
    const errors: string[] = [];
    const since = ctx.kickoff.getTime() - 8 * 86400000;
    for (const feed of expertFeeds()) {
      let items: FeedItem[];
      try {
        items = await fetchFeed(feed, 30 * 60000);
      } catch (e) {
        errors.push(`${new URL(feed).host}: ${(e as Error).message}`);
        continue;
      }
      for (const it of items) {
        if (!it.publishedAt || new Date(it.publishedAt).getTime() < since || new Date(it.publishedAt) > ctx.kickoff) continue;
        if (!/tahmin|yorum/i.test(it.title)) continue;
        for (const p of extractPicksFromText(stripHtml(it.content))) {
          if (!mentions(p.home, ctx.home) && normalizeName(p.home) !== ctx.home.normalized) continue;
          if (!mentions(p.away, ctx.away) && normalizeName(p.away) !== ctx.away.normalized) continue;
          const host = new URL(it.link || feed).host.replace(/^www\./, "");
          picks.push({
            sourceName: `${host}${it.author ? ` (${it.author})` : ""}`,
            author: it.author,
            url: it.link,
            pick: p.pick,
            publishedAt: it.publishedAt,
            fetchedAt: new Date().toISOString(),
            // Aynı yazarın farklı sitelerdeki yazıları tek görüş sayılır.
            originKey: it.author ? `yazar:${normalizeName(it.author)}` : `site:${host}`,
          });
        }
      }
    }
    if (!picks.length && errors.length === expertFeeds().length) return { sourceId: "tipster_blogs", status: "error", url: expertFeeds()[0], error: errors.join("; ") };
    return { sourceId: "tipster_blogs", status: picks.length ? "ok" : "empty", url: expertFeeds()[0], experts: picks, summary: `${picks.length} tahmin` };
  },
};
