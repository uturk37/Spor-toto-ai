import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

/** Yazma işlemleri ADMIN_TOKEN gerektirir (istek başlığı: x-admin-token). */
export function requireAdmin(req: Request): NextResponse | null {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return NextResponse.json({ error: "Sunucuda ADMIN_TOKEN tanımlı değil (.env)" }, { status: 503 });
  const got = req.headers.get("x-admin-token") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "Yetkisiz: yönetici anahtarı hatalı" }, { status: 401 });
  return null;
}
