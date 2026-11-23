import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { columnsForPicks, couponCost, MAX_COLUMNS_PER_COUPON } from "@/lib/coupon/math";
import { PickArray } from "@/lib/validation";
const Body = z.object({ weekId: z.string(), name: z.string().min(1).max(80), picks: PickArray, columnPrice: z.number().positive() });

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz kupon", issues: parsed.error.issues }, { status: 400 });
  const { weekId, name, picks, columnPrice } = parsed.data;
  const columns = columnsForPicks(picks);
  if (columns > MAX_COLUMNS_PER_COUPON) return NextResponse.json({ error: `Kolon sayısı ${columns}; bir kupon en fazla ${MAX_COLUMNS_PER_COUPON} kolon olabilir` }, { status: 400 });
  const c = await prisma.coupon.create({ data: { weekId, name, kind: "manuel", picks, columns, columnPrice, cost: couponCost(columns, columnPrice), origin: "manuel" } });
  return NextResponse.json(c);
}
