import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { columnsForPicks, couponCost, MAX_COLUMNS_PER_COUPON } from "@/lib/coupon/math";
import { PickArray } from "@/lib/validation";

const Body = z.object({ name: z.string().min(1).max(80).optional(), picks: PickArray, columnPrice: z.number().positive() });

/** Kupon düzenleme. Düzenlenen otomatik kupon "manuel" olur; böylece yeni analizde üzerine yazılmaz. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz kupon" }, { status: 400 });
  const columns = columnsForPicks(parsed.data.picks);
  if (columns > MAX_COLUMNS_PER_COUPON) return NextResponse.json({ error: `En fazla ${MAX_COLUMNS_PER_COUPON} kolon` }, { status: 400 });
  const c = await prisma.coupon.update({
    where: { id },
    data: { ...(parsed.data.name ? { name: parsed.data.name } : {}), picks: parsed.data.picks, columns, columnPrice: parsed.data.columnPrice, cost: couponCost(columns, parsed.data.columnPrice), origin: "manuel" },
  });
  return NextResponse.json(c);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await params;
  await prisma.coupon.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
