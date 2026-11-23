import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma, SETTING } from "@/lib/db";

const Body = z.object({
  columnPrice: z.object({ value: z.number().positive().max(10000), source: z.string().min(3), verified: z.boolean() }).optional(),
  budget: z.number().positive().max(1_000_000).optional(),
});

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz ayar" }, { status: 400 });
  const { columnPrice, budget } = parsed.data;
  if (columnPrice) {
    await prisma.setting.upsert({
      where: { key: SETTING.columnPrice },
      create: { key: SETTING.columnPrice, value: String(columnPrice.value), source: columnPrice.source, verified: columnPrice.verified },
      update: { value: String(columnPrice.value), source: columnPrice.source, verified: columnPrice.verified },
    });
  }
  if (budget) await prisma.setting.upsert({ where: { key: SETTING.budget }, create: { key: SETTING.budget, value: String(budget), source: "manuel" }, update: { value: String(budget) } });
  return NextResponse.json({ ok: true });
}
