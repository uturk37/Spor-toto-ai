import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = prisma;

export const SETTING = {
  columnPrice: "kolon_fiyati",
  budget: "butce",
} as const;

/** Kolon fiyatı: resmî kaynaktan doğrulanmadıkça "doğrulanmamış" olarak işaretlenir. */
export async function getColumnPrice(): Promise<{ value: number; verified: boolean; source: string | null; updatedAt: Date | null }> {
  const s = await prisma.setting.findUnique({ where: { key: SETTING.columnPrice } });
  if (!s) {
    return {
      value: Number(process.env.DEFAULT_COLUMN_PRICE ?? 10),
      verified: false,
      source: "https://yardim.bilyoner.com/hc/tr/articles/13885986324625 (2025-03-24 tarihli, resmî değil)",
      updatedAt: null,
    };
  }
  return { value: Number(s.value), verified: s.verified, source: s.source, updatedAt: s.updatedAt };
}

export async function getBudget(): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { key: SETTING.budget } });
  return s ? Number(s.value) : 250;
}
