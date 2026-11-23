/**
 * Veri kaynakları kataloğu. Bu liste arayüzdeki "Kaynaklar" sayfasının ve kurulum ekranının temelidir.
 * "erisilemez" olan kaynaklardan veri çekilmez ve hiçbir zaman veri varmış gibi gösterilmez.
 */
export type SourceAccess = "ucretsiz" | "ucretsiz_anahtar" | "ucretli" | "erisilemez";
export type SourceKind = "fikstur" | "sonuc" | "istatistik" | "xg" | "guc" | "oran" | "kadro" | "haber" | "uzman" | "h2h";

export interface SourceDef {
  id: string;
  name: string;
  homepage: string;
  access: SourceAccess;
  kinds: SourceKind[];
  envKey?: string;
  coverage: string;
  note: string;
}

export const SOURCES: SourceDef[] = [
  {
    id: "sportoto",
    name: "Spor Toto Teşkilat Başkanlığı",
    homepage: "https://www.sportoto.gov.tr/spor-toto-listeler",
    access: "ucretsiz",
    kinds: ["fikstur", "sonuc"],
    coverage: "Resmî 15 maçlık oyun programı ve sonuçlar",
    note: "Resmî kaynak. API yok; herkese açık liste sayfası okunur.",
  },
  {
    id: "clubelo",
    name: "ClubElo",
    homepage: "http://clubelo.com",
    access: "ucretsiz",
    kinds: ["guc", "istatistik"],
    coverage: "Avrupa kulüpleri Elo puanı ve yaklaşan maç olasılıkları (milli takımlar yok)",
    note: "Herkese açık CSV API (api.clubelo.com).",
  },
  {
    id: "footballdata_couk",
    name: "Football-Data.co.uk",
    homepage: "https://www.football-data.co.uk",
    access: "ucretsiz",
    kinds: ["istatistik", "oran", "h2h", "sonuc"],
    coverage: "22 Avrupa ligi (Süper Lig dahil) sonuç, şut, korner, kart ve bahis oranları; yaklaşan maç oranları",
    note: "Ücretsiz CSV dosyaları; kişisel/araştırma kullanımı.",
  },
  {
    id: "espn",
    name: "ESPN",
    homepage: "https://www.espn.com/soccer/",
    access: "ucretsiz",
    kinds: ["fikstur", "istatistik", "sonuc"],
    coverage: "Fikstür, skor, takım maç geçmişi (lig, kupa, milli maçlar)",
    note: "Belgelenmemiş herkese açık JSON uç noktası; değişebilir.",
  },
  {
    id: "understat",
    name: "Understat",
    homepage: "https://understat.com",
    access: "ucretsiz",
    kinds: ["xg"],
    coverage: "xG/xGA: Premier Lig, LaLiga, Bundesliga, Serie A, Ligue 1, RFPL",
    note: "Sayfa içi JSON verisi okunur; düşük istek sıklığı.",
  },
  {
    id: "bbc",
    name: "BBC Sport",
    homepage: "https://www.bbc.com/sport/football",
    access: "ucretsiz",
    kinds: ["haber", "kadro"],
    coverage: "Futbol haberleri RSS (sakatlık/kadro haberleri süzülür)",
    note: "Resmî RSS akışı.",
  },
  {
    id: "skysports",
    name: "Sky Sports",
    homepage: "https://www.skysports.com/football",
    access: "ucretsiz",
    kinds: ["haber", "kadro"],
    coverage: "Futbol haberleri RSS",
    note: "Resmî RSS akışı.",
  },
  {
    id: "tipster_blogs",
    name: "Spor Toto tahmin blogları (Atom/RSS)",
    homepage: "https://www.sportotolistesi.com",
    access: "ucretsiz",
    kinds: ["uzman"],
    coverage: "Haftalık Spor Toto tahmin yazıları (EXPERT_FEEDS ile genişletilebilir)",
    note: "Yalnızca yazıda açıkça yazan tahmin alınır; yazar ve bağlantı gösterilir.",
  },
  {
    id: "api_football",
    name: "API-Football (api-sports.io)",
    homepage: "https://www.api-football.com",
    access: "ucretsiz_anahtar",
    envKey: "API_FOOTBALL_KEY",
    kinds: ["kadro", "istatistik", "fikstur", "sonuc"],
    coverage: "Sakat/cezalı oyuncular, muhtemel ve resmî 11'ler, takım istatistikleri, 1.100+ lig",
    note: "Ücretsiz plan: günde 100 istek. Yoğun kullanımda ücretli plan gerekir.",
  },
  {
    id: "football_data_org",
    name: "football-data.org",
    homepage: "https://www.football-data.org",
    access: "ucretsiz_anahtar",
    envKey: "FOOTBALL_DATA_ORG_KEY",
    kinds: ["fikstur", "istatistik", "h2h", "sonuc"],
    coverage: "Ücretsiz planda 12 büyük turnuva (Süper Lig yok)",
    note: "Ücretsiz plan: dakikada 10 istek.",
  },
  {
    id: "the_odds_api",
    name: "The Odds API",
    homepage: "https://the-odds-api.com",
    access: "ucretsiz_anahtar",
    envKey: "ODDS_API_KEY",
    kinds: ["oran"],
    coverage: "Avrupa bahis şirketlerinin 1X2 oranları (Süper Lig dahil)",
    note: "Ücretsiz plan: ayda 500 istek.",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude API (opsiyonel)",
    homepage: "https://www.anthropic.com/api",
    access: "ucretli",
    envKey: "ANTHROPIC_API_KEY",
    kinds: ["uzman"],
    coverage: "EXPERT_ARTICLE_URLS içindeki uzman yazılarından tahmini yapılandırılmış olarak çıkarma",
    note: "Ücretli. Yalnızca metinde açıkça yazılan tahminleri, alıntısıyla birlikte çıkarır.",
  },
  // ---- Erişilemeyen kaynaklar: resmî açık API yok ve kullanım şartları otomatik veri çekmeyi yasaklıyor ----
  ...(
    [
      ["sofascore", "SofaScore", "https://www.sofascore.com"],
      ["flashscore", "Flashscore", "https://www.flashscore.com"],
      ["fotmob", "FotMob", "https://www.fotmob.com"],
      ["transfermarkt", "Transfermarkt", "https://www.transfermarkt.com"],
      ["mackolik", "Mackolik", "https://www.mackolik.com"],
      ["soccerway", "Soccerway", "https://www.soccerway.com"],
      ["worldfootball", "WorldFootball.net", "https://www.worldfootball.net"],
      ["opta", "Opta (Stats Perform)", "https://www.statsperform.com/opta/"],
      ["whoscored", "WhoScored", "https://www.whoscored.com"],
    ] as const
  ).map(
    ([id, name, homepage]): SourceDef => ({
      id,
      name,
      homepage,
      access: "erisilemez",
      kinds: [],
      coverage: "—",
      note: "Herkese açık resmî API yok; kullanım şartları otomatik veri çekmeye izin vermiyor. Lisanslı erişim sağlanırsa adaptör eklenebilir.",
    }),
  ),
];

export function sourceById(id: string): SourceDef | undefined {
  return SOURCES.find((s) => s.id === id);
}

export function hasKey(def: SourceDef): boolean {
  return !def.envKey || !!process.env[def.envKey];
}

export const ACCESS_LABEL: Record<SourceAccess, string> = {
  ucretsiz: "Ücretsiz",
  ucretsiz_anahtar: "Ücretsiz anahtar gerekli",
  ucretli: "Ücretli",
  erisilemez: "Erişilemez",
};
