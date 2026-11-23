import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ALL_PICKS, type Pick } from "@/lib/types";

/** Elle uzman tahmini: kaynaksız görüş kabul edilmez; bağlantı ve yayın tarihi zorunlu. */
const Body = z.object({
  matchId: z.string(),
  sourceName: z.string().min(2).max(120),
  author: z.string().max(120).optional().nullable(),
  url: z.string().url(),
  pick: z.enum(ALL_PICKS as [Pick, ...Pick[]]),
  publishedAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)),
  copiedFrom: z.string().max(120).optional().nullable(),
});

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz tahmin: kaynak adı, bağlantı, tahmin ve yayın tarihi zorunlu", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;
  const m = await prisma.match.findUnique({ where: { id: d.matchId } });
  if (!m) return NextResponse.json({ error: "Maç bulunamadı" }, { status: 404 });
  const host = new URL(d.url).host.replace(/^www\./, "");
  // Başka bir kaynaktan kopyalandıysa o kaynağın kökeni kullanılır; böylece bağımsız görüş sayılmaz.
  const originKey = d.copiedFrom ? `kopya:${d.copiedFrom.toLowerCase()}` : d.author ? `yazar:${d.author.toLowerCase()}` : `site:${host}`;
  const row = await prisma.expertPick.upsert({
    where: { matchId_url_sourceName: { matchId: d.matchId, url: d.url, sourceName: d.sourceName } },
    create: { matchId: d.matchId, sourceName: d.sourceName, author: d.author ?? null, url: d.url, pick: d.pick, publishedAt: new Date(d.publishedAt), originKey, enteredBy: "manuel" },
    update: { pick: d.pick, author: d.author ?? null, publishedAt: new Date(d.publishedAt), originKey },
  });
  return NextResponse.json(row);
}
