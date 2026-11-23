import type { Outcome, Probs } from "../types";
import { DEFAULT_WEIGHTS, type EngineWeights } from "./engines";
import { logLoss } from "./probability";

export interface GradedEngineRecord {
  engine: keyof EngineWeights;
  probs: Probs;
  result: Outcome;
}

/**
 * Geçmiş sonuçlardan motor ağırlıklarını öğrenir: her motorun ortalama log-kaybı
 * hesaplanır, ağırlık ∝ exp(-k · kayıp). Az örnekte varsayılan ağırlıklara doğru büzülür
 * (n / (n + 30)), böylece birkaç haftalık şans sonucu modeli savurmaz.
 */
export function learnWeights(records: GradedEngineRecord[], k = 4): { weights: EngineWeights; samples: Record<string, number>; avgLoss: Record<string, number> } {
  const engines = Object.keys(DEFAULT_WEIGHTS) as Array<keyof EngineWeights>;
  const sum: Record<string, number> = {};
  const n: Record<string, number> = {};
  for (const r of records) {
    sum[r.engine] = (sum[r.engine] ?? 0) + logLoss(r.probs, r.result);
    n[r.engine] = (n[r.engine] ?? 0) + 1;
  }
  const raw: Record<string, number> = {};
  const avgLoss: Record<string, number> = {};
  for (const e of engines) {
    if (!n[e]) {
      raw[e] = DEFAULT_WEIGHTS[e];
      continue;
    }
    avgLoss[e] = sum[e] / n[e];
    const learned = Math.exp(-k * avgLoss[e]);
    raw[e] = learned;
  }
  // Öğrenilmiş değerleri normalize et, sonra varsayılana doğru büz.
  const learnedTotal = engines.reduce((a, e) => a + (n[e] ? raw[e] : 0), 0);
  const defaultTotalForLearned = engines.reduce((a, e) => a + (n[e] ? DEFAULT_WEIGHTS[e] : 0), 0);
  const weights = {} as EngineWeights;
  for (const e of engines) {
    if (!n[e] || !learnedTotal) {
      weights[e] = DEFAULT_WEIGHTS[e];
      continue;
    }
    const learnedShare = (raw[e] / learnedTotal) * defaultTotalForLearned;
    const shrink = n[e] / (n[e] + 30);
    weights[e] = shrink * learnedShare + (1 - shrink) * DEFAULT_WEIGHTS[e];
  }
  const total = engines.reduce((a, e) => a + weights[e], 0);
  for (const e of engines) weights[e] = weights[e] / total;
  return { weights, samples: n, avgLoss };
}
