import type { Outcome, Probs } from "../types";

export function normalize(p: Probs): Probs {
  const s = p.p1 + p.pX + p.p2;
  if (!(s > 0)) throw new Error("Olasılık toplamı sıfır");
  return { p1: p.p1 / s, pX: p.pX / s, p2: p.p2 / s };
}

export function get(p: Probs, o: Outcome): number {
  return o === "1" ? p.p1 : o === "X" ? p.pX : p.p2;
}

export function argmax(p: Probs): Outcome {
  if (p.p1 >= p.pX && p.p1 >= p.p2) return "1";
  if (p.p2 >= p.pX) return "2";
  return "X";
}

/** Tam sayı yüzdeler; en büyük kalan yöntemiyle toplam her zaman 100. */
export function toPercentages(p: Probs): { p1: number; pX: number; p2: number } {
  const n = normalize(p);
  const raw = [n.p1 * 100, n.pX * 100, n.p2 * 100];
  const floors = raw.map(Math.floor);
  let rest = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, r: v - floors[i] })).sort((a, b) => b.r - a.r);
  for (const { i } of order) {
    if (rest <= 0) break;
    floors[i]++;
    rest--;
  }
  return { p1: floors[0], pX: floors[1], p2: floors[2] };
}

/** Ondalık oranlardan marjı ayıklanmış olasılık (orantılı yöntem). */
export function oddsToProbs(o1: number, oX: number, o2: number): Probs {
  if (!(o1 > 1 && oX > 1 && o2 > 1)) throw new Error("Geçersiz oran");
  return normalize({ p1: 1 / o1, pX: 1 / oX, p2: 1 / o2 });
}

export function bookmakerMargin(o1: number, oX: number, o2: number): number {
  return 1 / o1 + 1 / oX + 1 / o2 - 1;
}

export function entropy(p: Probs): number {
  let h = 0;
  for (const v of [p.p1, p.pX, p.p2]) if (v > 0) h -= v * Math.log(v);
  return h / Math.log(3); // 0..1
}

function kl(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) if (a[i] > 0) s += a[i] * Math.log(a[i] / Math.max(b[i], 1e-12));
  return s;
}

/** Jensen-Shannon ıraksaması, 0..1 (log taban 2). */
export function jsDivergence(p: Probs, q: Probs): number {
  const a = [p.p1, p.pX, p.p2];
  const b = [q.p1, q.pX, q.p2];
  const m = a.map((v, i) => (v + b[i]) / 2);
  return (0.5 * kl(a, m) + 0.5 * kl(b, m)) / Math.log(2);
}

/** Ağırlıklı logaritmik havuzlama (geometrik ortalama), sonra normalize. */
export function logPool(items: Array<{ probs: Probs; weight: number }>): Probs {
  const valid = items.filter((i) => i.weight > 0);
  if (!valid.length) throw new Error("Havuzlanacak dağılım yok");
  const W = valid.reduce((a, b) => a + b.weight, 0);
  const acc = { p1: 0, pX: 0, p2: 0 };
  for (const { probs, weight } of valid) {
    acc.p1 += (weight / W) * Math.log(Math.max(probs.p1, 1e-6));
    acc.pX += (weight / W) * Math.log(Math.max(probs.pX, 1e-6));
    acc.p2 += (weight / W) * Math.log(Math.max(probs.p2, 1e-6));
  }
  return normalize({ p1: Math.exp(acc.p1), pX: Math.exp(acc.pX), p2: Math.exp(acc.p2) });
}

export function logLoss(p: Probs, result: Outcome): number {
  return -Math.log(Math.max(get(p, result), 1e-12));
}

export function brier(p: Probs, result: Outcome): number {
  const y = { p1: result === "1" ? 1 : 0, pX: result === "X" ? 1 : 0, p2: result === "2" ? 1 : 0 };
  return (p.p1 - y.p1) ** 2 + (p.pX - y.pX) ** 2 + (p.p2 - y.p2) ** 2;
}

// ---------- Poisson / Dixon-Coles ----------

function poissonPmf(k: number, lambda: number): number {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (Math.exp(-lambda) * lambda ** k) / f;
}

/** Dixon-Coles düzeltmeli bağımsız Poisson skor matrisinden 1/X/2. */
export function poissonOutcome(lambdaHome: number, lambdaAway: number, rho = -0.08, maxGoals = 10): Probs {
  if (!(lambdaHome > 0 && lambdaAway > 0)) throw new Error("Gol beklentisi pozitif olmalı");
  let p1 = 0;
  let pX = 0;
  let p2 = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      let tau = 1;
      if (h === 0 && a === 0) tau = 1 - lambdaHome * lambdaAway * rho;
      else if (h === 0 && a === 1) tau = 1 + lambdaHome * rho;
      else if (h === 1 && a === 0) tau = 1 + lambdaAway * rho;
      else if (h === 1 && a === 1) tau = 1 - rho;
      const p = tau * poissonPmf(h, lambdaHome) * poissonPmf(a, lambdaAway);
      if (h > a) p1 += p;
      else if (h === a) pX += p;
      else p2 += p;
    }
  }
  return normalize({ p1, pX, p2 });
}

export interface GoalRecord {
  /** Maç sayısı. */
  n: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Varsa toplam xG / xGA (aynı maçlar için). */
  xg?: number | null;
  xga?: number | null;
}

/**
 * Ev sahibinin iç saha ve deplasman takımının dış saha kayıtlarından gol beklentisi.
 * Az maçlı örnekler lig ortalamasına doğru büzülür (n / (n + 6)).
 */
export function expectedGoals(
  home: GoalRecord,
  away: GoalRecord,
  leagueHomeGoals = 1.45,
  leagueAwayGoals = 1.15,
): { lambdaHome: number; lambdaAway: number } {
  const rate = (sum: number, xsum: number | null | undefined, n: number, prior: number) => {
    if (n <= 0) return prior;
    const g = xsum != null ? 0.5 * (sum / n) + 0.5 * (xsum / n) : sum / n;
    const w = n / (n + 6);
    return w * g + (1 - w) * prior;
  };
  const homeAttack = rate(home.goalsFor, home.xg, home.n, leagueHomeGoals) / leagueHomeGoals;
  const homeDefence = rate(home.goalsAgainst, home.xga, home.n, leagueAwayGoals) / leagueAwayGoals;
  const awayAttack = rate(away.goalsFor, away.xg, away.n, leagueAwayGoals) / leagueAwayGoals;
  const awayDefence = rate(away.goalsAgainst, away.xga, away.n, leagueHomeGoals) / leagueHomeGoals;
  return {
    lambdaHome: Math.max(0.15, homeAttack * awayDefence * leagueHomeGoals),
    lambdaAway: Math.max(0.15, awayAttack * homeDefence * leagueAwayGoals),
  };
}

// ---------- Elo ----------

/**
 * Elo farkından 1/X/2. Beklenen skor E = 1/(1+10^(-dr/400)); beraberlik payı
 * farka göre azalan bir Gauss eğrisiyle, kalan pay E'ye göre bölüştürülür.
 * homeAdvantage kulüp maçlarında ~65, tarafsız sahada 0.
 */
export function eloOutcome(eloHome: number, eloAway: number, homeAdvantage = 65): Probs {
  const dr = eloHome - eloAway + homeAdvantage;
  const e = 1 / (1 + 10 ** (-dr / 400));
  const pX = 0.29 * Math.exp(-((dr / 600) ** 2));
  let p1 = e - pX / 2;
  let p2 = 1 - e - pX / 2;
  p1 = Math.max(p1, 0.01);
  p2 = Math.max(p2, 0.01);
  return normalize({ p1, pX, p2 });
}
