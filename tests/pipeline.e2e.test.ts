/**
 * Uçtan uca hat testi: resmî liste → kaynak adaptörleri → motorlar → değiştirilemez kayıt → kuponlar → sonuç → öğrenme.
 * Ağ çağrıları sahte yanıtlarla değiştirilir (gerçek sitelerin biçiminde). Bu veriler YALNIZCA testte kullanılır.
 * Çalıştırmak için ayrı, boş bir veritabanı gerekir:  E2E_DATABASE_URL=postgresql://… npx vitest run tests/pipeline.e2e.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const E2E = process.env.E2E_DATABASE_URL;

const TEAMS: Array<[string, string]> = [
  ["Galatasaray", "Fenerbahçe"], ["Beşiktaş", "Trabzonspor"], ["Göztepe", "Kasımpaşa"], ["Konyaspor", "Alanyaspor"],
  ["Samsunspor", "Eyüpspor"], ["Kocaelispor", "Gençlerbirliği"], ["Çaykur Rizespor", "Gaziantep FK"], ["Başakşehir", "Antalyaspor"],
  ["Arsenal", "Chelsea"], ["Liverpool", "Everton"], ["Real Madrid", "Sevilla"], ["Bayern Münih", "Mainz"], ["Inter", "Juventus"],
  ["Lyon", "Lille"], ["Ajax", "PSV"],
];

function ddmmyyyy(d: Date) {
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
}

function setupFetch(kick: Date, withResults: boolean) {
  const trDate = new Date(kick.getTime() + 3 * 3600000);
  const day = ddmmyyyy(trDate);
  const hh = `${String(trDate.getUTCHours()).padStart(2, "0")}:00`;
  const html = `<html><body>2026/2027 Sezonu <p>99. Oyun Programı</p><table>${TEAMS.map(
    ([h, a], i) => `<tr><td>${i + 1}</td><td>${h} - ${a}</td><td>${day} - Gün</td><td>${hh}</td><td>${withResults ? (i % 3 === 0 ? "2-0" : i % 3 === 1 ? "1-1" : "0-1") : "-"}</td><td>${withResults ? (i % 3 === 0 ? "1" : i % 3 === 1 ? "0" : "2") : "-"}</td></tr>`,
  ).join("")}</table></body></html>`;
  const t1 = ["Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HTHG,HTAG,HS,AS,HST,AST,HC,AC"];
  const tk = ["Galatasaray", "Fenerbahce", "Besiktas", "Trabzonspor", "Goztep", "Kasimpasa", "Konyaspor", "Alanyaspor", "Samsunspor", "Eyupspor", "Kocaelispor", "Genclerbirligi", "Rizespor", "Gaziantep", "Buyuksehyr", "Antalyaspor"];
  let n = 0;
  for (let r = 0; r < 4; r++)
    for (let i = 0; i < tk.length; i++)
      for (let j = 0; j < tk.length; j += 5) {
        if (i === j) continue;
        const d = new Date(kick.getTime() - (10 + n++) * 86400000 * 0.3);
        const hg = (i * 7 + j * 3 + r) % 4;
        const ag = (i * 3 + j * 5 + r) % 3;
        t1.push(`${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()},19:00,${tk[i]},${tk[j]},${hg},${ag},${hg > ag ? "H" : hg === ag ? "D" : "A"},${Math.min(hg, 1)},0,12,9,5,3,6,4`);
      }
  const fixturesCsv = `Div,Date,Time,HomeTeam,AwayTeam,B365H,B365D,B365A,PSH,PSD,PSA\nT1,${day.replace(/\./g, "/")},19:00,Galatasaray,Fenerbahce,1.95,3.6,3.8,2.0,3.65,3.9\n`;
  const elo = `Rank,Club,Country,Level,Elo,From,To\n1,Galatasaray,TUR,1,1720,2026-01-01,2026-12-31\n2,Fenerbahce,TUR,1,1700,2026-01-01,2026-12-31\n3,Arsenal,ENG,1,2000,2026-01-01,2026-12-31\n4,Chelsea,ENG,1,1850,2026-01-01,2026-12-31\n`;
  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>99.Hafta Spor Toto Tahminleri</title><published>${new Date(Date.now() - 3600000).toISOString()}</published><author><name>yazar1</name></author><link rel="alternate" href="https://blog.example.com/a"/><content type="html">1. Galatasaray - Fenerbahçe..........1&lt;br/&gt;9. Arsenal - Chelsea..........10</content></entry></feed>`;
  const atom2 = atom.replace("yazar1", "yazar2").replace("blog.example.com/a", "blog2.example.com/b").replace("..........1&lt;", "..........0&lt;");
  const rss = `<rss><channel><item><title>Arsenal defender ruled out with hamstring injury</title><link>https://bbc.example/x</link><description>Arsenal news</description><pubDate>${new Date(Date.now() - 7200000).toUTCString()}</pubDate></item></channel></rss>`;

  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    const ok = (body: string) => new Response(body, { status: 200 });
    if (url.includes("sportoto.gov.tr")) return ok(html);
    if (url.includes("api.clubelo.com/Fixtures")) return ok("Date,Country,Home,Away\n");
    if (url.includes("api.clubelo.com")) return ok(elo);
    if (url.includes("football-data.co.uk/fixtures.csv")) return ok(fixturesCsv);
    if (url.includes("football-data.co.uk/mmz4281/2627/T1.csv")) return ok(t1.join("\n"));
    if (url.includes("football-data.co.uk")) return new Response("not found", { status: 404 });
    if (url.includes("espn.com")) return ok(JSON.stringify({ events: [] }));
    if (url.includes("sportotolistesi.com")) return ok(atom);
    if (url.includes("sportotolistesi.blogspot.com")) return ok(atom2);
    if (url.includes("bbci.co.uk")) return ok(rss);
    if (url.includes("skysports.com")) return ok("<rss><channel></channel></rss>");
    return new Response("blocked", { status: 403 });
  });
}

describe.skipIf(!E2E)("uçtan uca analiz hattı", { timeout: 120000 }, () => {
  let p: typeof import("@/lib/pipeline");
  let q: typeof import("@/lib/queries");
  let db: typeof import("@/lib/db");
  const kick = new Date(Date.now() + 30 * 3600000);
  kick.setUTCMinutes(0, 0, 0);

  beforeAll(async () => {
    process.env.DATABASE_URL = E2E;
    process.env.HTTP_THROTTLE_SCALE = "0";
    delete process.env.API_FOOTBALL_KEY;
    delete process.env.FOOTBALL_DATA_ORG_KEY;
    delete process.env.ODDS_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    setupFetch(kick, false);
    p = await import("@/lib/pipeline");
    q = await import("@/lib/queries");
    db = await import("@/lib/db");
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await db?.prisma.$disconnect();
  });

  it("listeyi alır, 15 maçı analiz eder, kayıt ve kupon üretir", async () => {
    const r = await p.refreshProgram();
    expect(r.programNo).toBe(99);
    const n = await p.analyzeWeek(r.weekId, "fikstur");
    expect(n).toBe(15);
    const v = (await q.weekView(r.weekId))!;
    const gs = v.rows[0];
    expect(gs.decision?.status).toBe("tahmin");
    expect(gs.decision!.percentages!.p1 + gs.decision!.percentages!.pX + gs.decision!.percentages!.p2).toBe(100);
    expect(gs.decision!.engines.map((e) => e.engine).sort()).toEqual(["istatistik", "piyasa", "uzman"]);
    expect(gs.decision!.expert.independentCount).toBe(2);
    // Veri olmayan maçta tahmin üretilmez.
    const ajax = v.rows[14];
    expect(ajax.decision?.status).toBe("yetersiz_veri");
    // Eksik anahtarlı kaynaklar dürüstçe raporlanır.
    const dossier = (await db.prisma.analysis.findUnique({ where: { matchId: gs.id } }))!.evidence as unknown as import("@/lib/pipeline").MatchDossier;
    expect(dossier.sources.find((s) => s.sourceId === "api_football")?.status).toBe("missing_key");
    expect(dossier.sources.find((s) => s.sourceId === "espn")?.status).toBe("empty");
    expect(dossier.h2h.length).toBe(1);
    // Kuponlar bütçeyi aşmaz.
    expect(v.coupons.length).toBeGreaterThanOrEqual(4);
    for (const c of v.coupons) if (c.kind.startsWith("butce-")) expect(c.cost).toBeLessThanOrEqual(Number(c.kind.split("-")[1]));
    // Değiştirilemez kayıt zinciri.
    const chain = await q.verifyStoredChain();
    expect(chain.ok).toBe(true);
    expect(chain.count).toBe(15);
  });

  it("aynı aşamada yeniden hesaplama yeni kayıt ekler, değişiklik varsa bildirir", async () => {
    const w = (await p.currentWeek())!;
    await db.prisma.expertPick.create({
      data: { matchId: w.matches[0].id, sourceName: "Elle eklenen", url: "https://ornek.example/yazi", pick: "2", publishedAt: new Date(), originKey: "yazar:elle", enteredBy: "manuel" },
    });
    await p.analyzeMatch(w.matches[0].id, "T-24");
    const snaps = await db.prisma.predictionSnapshot.findMany({ where: { matchId: w.matches[0].id } });
    expect(snaps.length).toBe(2);
    expect((await q.verifyStoredChain()).ok).toBe(true);
  });
});
