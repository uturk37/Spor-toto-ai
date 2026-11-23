/**
 * Resmî Spor Toto listesindeki Türkçe takım/ülke adlarını uluslararası kaynaklardaki adlarla eşleştirme.
 * Sözlükte olmayan adlar bulanık eşleştirme ile aranır; eşleşmeyen adlar kurulum ekranındaki
 * "Takım eşleştirme" tablosundan (TeamAlias) elle eklenebilir.
 */

export function normalizeName(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(fk|sk|fc|cf|ac|as|afc|sc|ssc|bk|if|jk|kulubu|spor kulubu|calcio|club|de|1907|1909|1903|1899|1900|1904|1913)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Türkçe ülke adları -> İngilizce (milli maçlar için). */
export const COUNTRY_TR_EN: Record<string, string> = {
  turkiye: "Turkey",
  fransa: "France",
  almanya: "Germany",
  ispanya: "Spain",
  ingiltere: "England",
  italya: "Italy",
  hollanda: "Netherlands",
  belcika: "Belgium",
  portekiz: "Portugal",
  hirvatistan: "Croatia",
  cekya: "Czechia",
  "cek cumhuriyeti": "Czechia",
  isvicre: "Switzerland",
  iskocya: "Scotland",
  galler: "Wales",
  "kuzey irlanda": "Northern Ireland",
  irlanda: "Republic of Ireland",
  norvec: "Norway",
  isvec: "Sweden",
  danimarka: "Denmark",
  finlandiya: "Finland",
  izlanda: "Iceland",
  polonya: "Poland",
  avusturya: "Austria",
  macaristan: "Hungary",
  slovakya: "Slovakia",
  slovenya: "Slovenia",
  sirbistan: "Serbia",
  karadag: "Montenegro",
  "bosna hersek": "Bosnia-Herzegovina",
  arnavutluk: "Albania",
  "kuzey makedonya": "North Macedonia",
  "kuzey makedonya cumhuriyeti": "North Macedonia",
  yunanistan: "Greece",
  bulgaristan: "Bulgaria",
  romanya: "Romania",
  moldova: "Moldova",
  ukrayna: "Ukraine",
  belarus: "Belarus",
  rusya: "Russia",
  gurcistan: "Georgia",
  ermenistan: "Armenia",
  azerbaycan: "Azerbaijan",
  kazakistan: "Kazakhstan",
  litvanya: "Lithuania",
  letonya: "Latvia",
  estonya: "Estonia",
  luksemburg: "Luxembourg",
  lihtenstayn: "Liechtenstein",
  "faroe adalari": "Faroe Islands",
  malta: "Malta",
  kibris: "Cyprus",
  "guney kibris": "Cyprus",
  israil: "Israel",
  "san marino": "San Marino",
  andorra: "Andorra",
  cebelitarik: "Gibraltar",
  kosova: "Kosovo",
  brezilya: "Brazil",
  arjantin: "Argentina",
  abd: "USA",
  "amerika birlesik devletleri": "USA",
  meksika: "Mexico",
  kanada: "Canada",
  japonya: "Japan",
  "guney kore": "South Korea",
  fas: "Morocco",
  misir: "Egypt",
  katar: "Qatar",
  "suudi arabistan": "Saudi Arabia",
  cin: "China",
  avustralya: "Australia",
  kolombiya: "Colombia",
  uruguay: "Uruguay",
  senegal: "Senegal",
  nijerya: "Nigeria",
  tunus: "Tunisia",
  cezayir: "Algeria",
};

/** Türkçe yazımı farklı olan kulüpler -> İngilizce/uluslararası ad. */
export const CLUB_TR_EN: Record<string, string> = {
  "bayern munih": "Bayern Munich",
  "sporting lizbon": "Sporting CP",
  "benfica lizbon": "Benfica",
  "paris st germain": "Paris Saint-Germain",
  "paris saint germain": "Paris Saint-Germain",
  "slavia prag": "Slavia Prague",
  "sparta prag": "Sparta Prague",
  "kizilyildiz": "Crvena Zvezda",
  "kizil yildiz": "Crvena Zvezda",
  "inter": "Internazionale",
  "inter milan": "Internazionale",
  "milan": "AC Milan",
  "roma": "AS Roma",
  "como": "Como",
  "koln": "FC Cologne",
  "monchengladbach": "Borussia Monchengladbach",
  "borussia monchengladbach": "Borussia Monchengladbach",
  "aek": "AEK Athens",
  "olympiakos": "Olympiacos",
  "kopenhag": "FC Copenhagen",
  "dinamo zagreb": "Dinamo Zagreb",
  "sahtar donetsk": "Shakhtar Donetsk",
  "caykur rizespor": "Rizespor",
  "c rizespor": "Rizespor",
  "basaksehir": "Istanbul Basaksehir",
  "istanbul basaksehir": "Istanbul Basaksehir",
  "amed sportif faaliyetler": "Amed SFK",
  "amed sportif": "Amed SFK",
  "erzurumspor": "Erzurumspor",
  "gaziantep": "Gaziantep FK",
};

export interface ResolvedTeam {
  input: string;
  normalized: string;
  /** Uluslararası kaynaklarda aranacak ad. */
  english: string;
  isNational: boolean;
}

export function resolveTeam(name: string, aliases: Record<string, string> = {}): ResolvedTeam {
  const n = normalizeName(name);
  if (aliases[n]) return { input: name, normalized: n, english: aliases[n], isNational: !!COUNTRY_TR_EN[n] };
  if (COUNTRY_TR_EN[n]) return { input: name, normalized: n, english: COUNTRY_TR_EN[n], isNational: true };
  if (CLUB_TR_EN[n]) return { input: name, normalized: n, english: CLUB_TR_EN[n], isNational: false };
  return { input: name, normalized: n, english: name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i"), isNational: false };
}

function bigrams(s: string): string[] {
  const t = ` ${s} `;
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice benzerliği (0..1) normalize edilmiş adlar üzerinde. */
export function similarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const A = bigrams(x);
  const B = bigrams(y);
  const m = new Map<string, number>();
  for (const g of A) m.set(g, (m.get(g) ?? 0) + 1);
  let inter = 0;
  for (const g of B) {
    const c = m.get(g) ?? 0;
    if (c > 0) {
      inter++;
      m.set(g, c - 1);
    }
  }
  return (2 * inter) / (A.length + B.length);
}

/** Aday listesinden en iyi eşleşmeyi döner; eşik altında null (yanlış eşleştirme veri uydurmaktan kötüdür). */
export function bestMatch<T>(target: string, candidates: T[], nameOf: (c: T) => string[], threshold = 0.72): T | null {
  let best: { c: T; s: number } | null = null;
  for (const c of candidates) {
    for (const nm of nameOf(c)) {
      const s = similarity(target, nm);
      if (!best || s > best.s) best = { c, s };
    }
  }
  return best && best.s >= threshold ? best.c : null;
}
