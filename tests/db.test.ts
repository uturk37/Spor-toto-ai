/**
 * Veritabanı tetikleyicilerinin gerçekten çalıştığını doğrular.
 * Ayrı bir test veritabanı gerekir (TEST_DATABASE_URL); yoksa atlanır.
 * Uygulamanın DATABASE_URL'ü ve boş olması gereken E2E veritabanı bilerek kullanılmaz: bu test silinemeyen
 * "test-…" haftaları yazar ve bunlar sıralamada gerçek sezonların önüne geçip güncel hafta olarak görünürdü.
 */
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const testDbUrl = process.env.TEST_DATABASE_URL;
const hasDb = !!testDbUrl;
const prisma = hasDb ? new PrismaClient({ datasourceUrl: testDbUrl }) : (null as unknown as PrismaClient);

describe.skipIf(!hasDb)("değiştirilemez tahmin kaydı (PostgreSQL)", () => {
  afterAll(async () => prisma?.$disconnect());

  it("UPDATE/DELETE reddedilir, maç sonrası ve geriye dönük kayıt eklenemez", async () => {
    const tag = `test-${Date.now()}`;
    const week = await prisma.week.create({ data: { season: tag, programNo: 1, sourceUrl: "test", fetchedAt: new Date() } });
    const future = await prisma.match.create({ data: { weekId: week.id, order: 1, homeName: "A", awayName: "B", kickoff: new Date(Date.now() + 86400000) } });
    const past = await prisma.match.create({ data: { weekId: week.id, order: 2, homeName: "C", awayName: "D", kickoff: new Date(Date.now() - 3600000) } });

    const snap = await prisma.predictionSnapshot.create({ data: { weekId: week.id, matchId: future.id, createdAt: new Date(), stage: "test", payload: { p1: 50 }, hash: `${tag}-1` } });
    await expect(prisma.predictionSnapshot.update({ where: { id: snap.id }, data: { payload: { p1: 90 } } })).rejects.toThrow(/değiştirilemez/);
    await expect(prisma.predictionSnapshot.delete({ where: { id: snap.id } })).rejects.toThrow(/değiştirilemez/);
    await expect(prisma.$executeRawUnsafe(`TRUNCATE "PredictionSnapshot" CASCADE`)).rejects.toThrow(/değiştirilemez/);
    await expect(
      prisma.predictionSnapshot.create({ data: { weekId: week.id, matchId: past.id, createdAt: new Date(), stage: "test", payload: {}, hash: `${tag}-2` } }),
    ).rejects.toThrow(/Maç başladıktan sonra/);
    await expect(
      prisma.predictionSnapshot.create({ data: { weekId: week.id, matchId: future.id, createdAt: new Date(Date.now() - 3600000), stage: "test", payload: {}, hash: `${tag}-3` } }),
    ).rejects.toThrow(/geriye dönük/);
    const still = await prisma.predictionSnapshot.findUnique({ where: { id: snap.id } });
    expect(still?.payload).toEqual({ p1: 50 });
  });
});
