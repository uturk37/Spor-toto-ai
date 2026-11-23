import { describe, expect, it } from "vitest";
import { parseProgramHtml, trDateTimeToIso } from "@/lib/sources/sportoto";
import { fixtureRowToProbs } from "@/lib/sources/clubelo";
import { parseCsv } from "@/lib/sources/http";
import { extractPicksFromText, parseFeed, parsePickToken, stripHtml } from "@/lib/sources/rss";
import { fdDate, seasonCode, oddsFromRow } from "@/lib/sources/footballdataCoUk";
import { parseTeamsData } from "@/lib/sources/understat";
import { normalizeName, resolveTeam, similarity, bestMatch } from "@/lib/data/teams";
import { computeTeamStats } from "@/lib/data/stats";

// sportoto.gov.tr/spor-toto-listeler sayfasının 2026/2027 15. program içeriğiyle aynı yapıda örnek.
const MATCHES = [
  ["Fransa - Türkiye", "15.11.2026 - Pazar", "22:45"],
  ["Bulgaristan - İzlanda", "13.11.2026 - Cuma", "22:45"],
  ["Lihtenştayn - Azerbaycan", "13.11.2026 - Cuma", "22:45"],
  ["Lüksemburg - Estonya", "13.11.2026 - Cuma", "22:45"],
  ["Slovakya - Faroe Adaları", "13.11.2026 - Cuma", "22:45"],
  ["Gürcistan - Macaristan", "14.11.2026 - Cumartesi", "20:00"],
  ["Norveç - Galler", "14.11.2026 - Cumartesi", "20:00"],
  ["Portekiz - Danimarka", "14.11.2026 - Cumartesi", "22:45"],
  ["Belçika - İtalya", "15.11.2026 - Pazar", "22:45"],
  ["Hırvatistan - Çekya", "15.11.2026 - Pazar", "22:45"],
  ["İspanya - İngiltere", "15.11.2026 - Pazar", "22:45"],
  ["Almanya - Hollanda", "16.11.2026 - Pazartesi", "22:45"],
  ["Kuzey Makedonya Cumhuriyeti - Slovenya", "16.11.2026 - Pazartesi", "22:45"],
  ["Yunanistan - Sırbistan", "16.11.2026 - Pazartesi", "22:45"],
  ["İsviçre - İskoçya", "16.11.2026 - Pazartesi", "22:45"],
];
const html = (resultCells: (i: number) => [string, string]) => `<html><body>
<h2>Spor Toto Listeler</h2><p>Liste 1 Haftalıktır</p><p>2026/2027 Sezonu</p><p>15. Oyun Programı</p>
<a href="https://webapi.sportoto.gov.tr/image/x.jpg">Listeyi İndir</a>
<table>${MATCHES.map(([t, d, h], i) => `<tr><td>${i + 1}</td><td>${t}</td><td>${d}</td><td>${h}</td><td>${resultCells(i)[0]}</td><td>${resultCells(i)[1]}</td></tr>`).join("")}</table>
<table><tr><td>15 Bilen</td><td>---</td></tr><tr><td>Kapanış</td><td>13 Kasım Cuma 2026 22:40</td></tr></table>
</body></html>`;

describe("resmî Spor Toto listesi", () => {
  it("15 maçı, sezonu, program no ve kapanışı okur", () => {
    const p = parseProgramHtml(html(() => ["-", "-"]));
    expect(p.season).toBe("2026/2027");
    expect(p.programNo).toBe(15);
    expect(p.matches).toHaveLength(15);
    expect(p.matches[0]).toMatchObject({ order: 1, home: "Fransa", away: "Türkiye", result: null, score: null });
    expect(p.matches[0].kickoff).toBe("2026-11-15T19:45:00.000Z");
    expect(p.matches[12].home).toBe("Kuzey Makedonya Cumhuriyeti");
    expect(p.closesAt).toBe("2026-11-13T19:40:00.000Z");
    expect(p.downloadUrl).toContain("webapi.sportoto.gov.tr");
  });
  it("sonuç sütunlarını (0 = beraberlik) okur", () => {
    const p = parseProgramHtml(html((i) => (i === 0 ? ["2-1", "1"] : i === 1 ? ["1-1", "0"] : ["0-2", "2"])));
    expect(p.matches[0]).toMatchObject({ score: "2-1", result: "1" });
    expect(p.matches[1].result).toBe("X");
    expect(p.matches[2].result).toBe("2");
  });
  it("eksik listede hata verir (uydurmaz)", () => {
    expect(() => parseProgramHtml("<html><body>2026/2027 Sezonu 15. Oyun Programı</body></html>")).toThrow(/15 yerine 0/);
  });
  it("Türkiye saati UTC+3", () => {
    expect(trDateTimeToIso("01.01.2027", "00:30")).toBe("2026-12-31T21:30:00.000Z");
  });
});

describe("ClubElo ve CSV", () => {
  it("CSV tırnaklı alanlar", () => {
    const rows = parseCsv('a,b,c\n1,"x,y",3\r\n4,"he said ""hi""",6\n');
    expect(rows).toEqual([
      { a: "1", b: "x,y", c: "3" },
      { a: "4", b: 'he said "hi"', c: "6" },
    ]);
  });
  it("GD sütunlarından 1/X/2", () => {
    const row = { Date: "2026-11-22", Home: "Bayern", Away: "Dortmund", "GD<-5": "0.001", "GD=-5": "0.002", "GD=-1": "0.12", "GD=0": "0.22", "GD=1": "0.2", "GD=3": "0.3", "GD>5": "0.157" };
    const p = fixtureRowToProbs(row)!;
    expect(p.p1 + p.pX + p.p2).toBeCloseTo(1, 12);
    expect(p.pX).toBeCloseTo(0.22, 6);
    expect(p.p2).toBeCloseTo(0.123, 6);
  });
});

describe("football-data.co.uk", () => {
  it("sezon kodu ve tarih", () => {
    expect(seasonCode(new Date("2026-11-23"))).toBe("2627");
    expect(seasonCode(new Date("2027-03-01"))).toBe("2627");
    expect(seasonCode(new Date("2026-07-15"))).toBe("2627");
    expect(fdDate("21/11/2026", "15:00")).toBe("2026-11-21T15:00:00.000Z");
    expect(fdDate("21/11/26")).toBe("2026-11-21T12:00:00.000Z");
  });
  it("oranları bahis şirketi bazında okur, yoksa ortalamaya düşer", () => {
    const prov = { sourceId: "x", sourceName: "x", url: "u", fetchedAt: "t", dataAsOf: null };
    expect(oddsFromRow({ B365H: "1.8", B365D: "3.5", B365A: "4.4", PSH: "1.85", PSD: "3.6", PSA: "4.5" }, prov).map((o) => o.bookmaker)).toEqual(["Bet365", "Pinnacle"]);
    expect(oddsFromRow({ AvgH: "2.1", AvgD: "3.3", AvgA: "3.4" }, prov)[0].bookmaker).toBe("Piyasa ortalaması");
    expect(oddsFromRow({ B365H: "" }, prov)).toEqual([]);
  });
});

describe("RSS / Atom ve tahmin çıkarma", () => {
  it("Atom akışı", () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>16.Hafta Spor Toto Tahminleri / 2026</title><published>2026-11-19T10:07:00-08:00</published><author><name>iddacı</name></author><link rel="alternate" href="https://example.blogspot.com/p.html"/><content type="html">&lt;p&gt;1. Konyaspor - Galatasaray....................2&lt;/p&gt;</content></entry></feed>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0].author).toBe("iddacı");
    expect(items[0].link).toBe("https://example.blogspot.com/p.html");
    expect(stripHtml(items[0].content)).toContain("Konyaspor - Galatasaray");
  });
  it("RSS 2.0 akışı", () => {
    const xml = `<rss><channel><item><title>Saka ruled out</title><link>https://bbc.co.uk/a</link><description>Arsenal winger injured</description><pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
    expect(parseFeed(xml)[0]).toMatchObject({ title: "Saka ruled out", link: "https://bbc.co.uk/a", publishedAt: "2026-11-20T10:00:00.000Z" });
  });
  it("tahmin işaretleri", () => {
    expect(parsePickToken("10")).toBe("1X");
    expect(parsePickToken("02")).toBe("X2");
    expect(parsePickToken("21")).toBe("12");
    expect(parsePickToken("102")).toBe("1X2");
    expect(parsePickToken("0")).toBe("X");
    expect(parsePickToken("11")).toBeNull();
  });
  it("blog satırlarından tahmin çıkarır", () => {
    const t = `1. Konyaspor - Galatasaray....................2\n2. Erzurumspor - Çorum FK..................1\nBaşakşehir – Samsunspor | Tahmin: 1\n15. Juventus - Napoli...................10\nKupon Bedeli : 40 TL`;
    const r = extractPicksFromText(t);
    expect(r.map((x) => [x.home, x.away, x.pick])).toEqual([
      ["Konyaspor", "Galatasaray", "2"],
      ["Erzurumspor", "Çorum FK", "1"],
      ["Başakşehir", "Samsunspor", "1"],
      ["Juventus", "Napoli", "1X"],
    ]);
  });
});

describe("Understat", () => {
  it("teamsData hex kaçışlı JSON", () => {
    const data = JSON.stringify({ "1": { id: "1", title: "Arsenal", history: [{ h_a: "h", xG: 2.1, xGA: 0.5, scored: 2, missed: 0, date: "2026-11-01 15:00:00" }] } });
    const esc = data.replace(/"/g, "\\x22");
    expect(parseTeamsData(`<script>var teamsData = JSON.parse('${esc}');</script>`)[0].title).toBe("Arsenal");
  });
});

describe("takım adı eşleştirme", () => {
  it("Türkçe karakterler ve ekler", () => {
    expect(normalizeName("Çaykur Rizespor")).toBe("caykur rizespor");
    expect(normalizeName("Fenerbahçe SK")).toBe("fenerbahce");
    expect(resolveTeam("Bayern Münih").english).toBe("Bayern Munich");
    expect(resolveTeam("Kuzey Makedonya Cumhuriyeti")).toMatchObject({ english: "North Macedonia", isNational: true });
    expect(resolveTeam("İsviçre").english).toBe("Switzerland");
  });
  it("benzerlik ve eşik", () => {
    expect(similarity("Galatasaray", "Galatasaray SK")).toBeGreaterThan(0.85);
    expect(bestMatch("Fenerbahce", ["Galatasaray", "Fenerbahce", "Besiktas"], (x) => [x])).toBe("Fenerbahce");
    expect(bestMatch("Real Madrid", ["Real Sociedad", "Real Betis"], (x) => [x], 0.85)).toBeNull();
  });
});

describe("takım istatistikleri", () => {
  it("form, iç saha/deplasman, 2.5 üst, KG, dinlenme", () => {
    const ms = [
      { date: "2026-11-20T18:00:00Z", competition: "T1", opponent: "A", home: true, gf: 3, ga: 1, htGf: 1, htGa: 0 },
      { date: "2026-11-13T18:00:00Z", competition: "T1", opponent: "B", home: false, gf: 0, ga: 0 },
      { date: "2026-11-06T18:00:00Z", competition: "T1", opponent: "C", home: true, gf: 1, ga: 2 },
      { date: "2026-12-01T18:00:00Z", competition: "T1", opponent: "Z", home: true, gf: 9, ga: 0 }, // gelecekteki maç sayılmaz
    ];
    const s = computeTeamStats(ms, new Date("2026-11-23T12:00:00Z"));
    expect(s.last5).toMatchObject({ n: 3, w: 1, d: 1, l: 1, gf: 4, ga: 3, sequence: "GBM" });
    expect(s.last5.ppg).toBeCloseTo(4 / 3);
    expect(s.home).toMatchObject({ n: 2, w: 1 });
    expect(s.away).toMatchObject({ n: 1, d: 1 });
    expect(s.over25Rate).toBeCloseTo(2 / 3);
    expect(s.bttsRate).toBeCloseTo(2 / 3);
    expect(s.restDays).toBe(2);
    expect(s.firstHalf?.n).toBe(1);
    expect(s.xg.value).toBeNull(); // veri yoksa üretilmez
  });
});
