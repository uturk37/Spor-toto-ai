/** Ortak tipler. Spor Toto'da beraberlik resmî olarak "0" ile işaretlenir; arayüzde "X" gösterilir. */
export type Outcome = "1" | "X" | "2";
export const OUTCOMES: Outcome[] = ["1", "X", "2"];

/** Bir maç için kupondaki tercih: tekli, çifte veya üçlü. */
export type Pick = "1" | "X" | "2" | "1X" | "X2" | "12" | "1X2";
export const ALL_PICKS: Pick[] = ["1", "X", "2", "1X", "X2", "12", "1X2"];

/** 1/X/2 olasılık dağılımı (0..1, toplam 1). */
export interface Probs {
  p1: number;
  pX: number;
  p2: number;
}

export type Level = "Yüksek" | "Orta" | "Düşük";

/** Bir kaynaktan alınan her veri parçasının künyesi. */
export interface Provenance {
  sourceId: string;
  sourceName: string;
  url: string;
  /** Uygulamanın veriyi çektiği an (ISO). */
  fetchedAt: string;
  /** Kaynağın verinin geçerli olduğunu belirttiği an (ISO), bilinmiyorsa null. */
  dataAsOf: string | null;
}

export type SourceStatus = "ok" | "empty" | "error" | "missing_key" | "unavailable" | "not_applicable";
