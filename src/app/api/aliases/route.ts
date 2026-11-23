import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/data/teams";

const Body = z.object({ alias: z.string().min(2), canonical: z.string().min(2) });

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz eşleştirme" }, { status: 400 });
  const alias = normalizeName(parsed.data.alias);
  const row = await prisma.teamAlias.upsert({ where: { alias }, create: { alias, canonical: parsed.data.canonical }, update: { canonical: parsed.data.canonical } });
  return NextResponse.json(row);
}

export async function GET() {
  return NextResponse.json(await prisma.teamAlias.findMany({ orderBy: { alias: "asc" } }));
}
