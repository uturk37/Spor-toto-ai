import type { Outcome, Probs } from "../types";
import type { DecisionOutput } from "./engines";
import { argmax, entropy, get } from "./probability";

export type RiskTag =
  | "favori_kaybedebilir"
  | "beraberlik_yuksek"
  | "surpriz_galibiyet"
  | "uzman_ai_celiski"
  | "yuksek_belirsizlik"
  | "veri_yetersiz";

export const RISK_TAG_LABEL: Record<RiskTag, string> = {
  favori_kaybedebilir: "Favori ama kaybetme ihtimali var",
  beraberlik_yuksek: "Beraberlik ihtimali yüksek",
  surpriz_galibiyet: "Sürpriz galibiyet ihtimali",
  uzman_ai_celiski: "Uzman görüşü ile AI çelişiyor",
  yuksek_belirsizlik: "Yüksek belirsizlik",
  veri_yetersiz: "Veri yetersiz",
};

export interface RiskFlag {
  tag: RiskTag;
  reason: string;
}

const NAME: Record<Outcome, string> = { "1": "ev sahibi", X: "beraberlik", "2": "deplasman" };

/** Bir maçın karar çıktısından sürpriz/risk etiketleri ve gerekçeleri üretir. Eşikler sabittir ve belgelenmiştir. */
export function riskFlags(d: DecisionOutput, home: string, away: string): RiskFlag[] {
  const flags: RiskFlag[] = [];
  if (d.status !== "tahmin" || !d.probs) {
    flags.push({ tag: "veri_yetersiz", reason: d.warning ?? "Tahmin için yeterli veri yok." });
    return flags;
  }
  const p = d.probs;
  const fav = argmax(p);
  const favP = get(p, fav);
  const underdog: Outcome = fav === "1" ? "2" : "1";
  const favTeam = fav === "1" ? home : fav === "2" ? away : null;

  if (favTeam && favP >= 0.5 && 1 - favP >= 0.38) {
    flags.push({
      tag: "favori_kaybedebilir",
      reason: `${favTeam} favori (%${pc(favP)}) ama kazanamama olasılığı %${pc(1 - favP)}.`,
    });
  }
  if (p.pX >= 0.3) {
    flags.push({ tag: "beraberlik_yuksek", reason: `Beraberlik olasılığı %${pc(p.pX)} (lig ortalaması ~%25-27).` });
  }
  if (fav !== "X" && get(p, underdog) >= 0.25 && favP >= 0.45) {
    const team = underdog === "1" ? home : away;
    flags.push({ tag: "surpriz_galibiyet", reason: `${team} için galibiyet olasılığı %${pc(get(p, underdog))}; sürpriz potansiyeli var.` });
  }
  const ec = d.expert;
  if (ec.independentCount >= 2) {
    const s = ec.supportCounts;
    const expertTop = (["1", "X", "2"] as Outcome[]).reduce((a, b) => (s[b] > s[a] ? b : a), "1" as Outcome);
    if (expertTop !== fav && s[expertTop] > 0) {
      flags.push({
        tag: "uzman_ai_celiski",
        reason: `Uzmanların çoğu ${NAME[expertTop]} derken AI ${NAME[fav]} sonucunu öne çıkarıyor.`,
      });
    }
  }
  if (entropy(p) >= 0.95 || favP < 0.42) {
    flags.push({ tag: "yuksek_belirsizlik", reason: `En yüksek olasılık sadece %${pc(favP)}; sonuçlar birbirine çok yakın.` });
  }
  return flags;
}

function pc(v: number) {
  return Math.round(v * 100);
}

export function isRisky(p: Probs | null): boolean {
  if (!p) return true;
  return get(p, argmax(p)) < 0.5;
}
