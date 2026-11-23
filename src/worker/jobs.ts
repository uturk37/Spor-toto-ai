import { prisma } from "../lib/db";
import { analyzeMatch, analyzeWeek, checkNews, currentWeek, generateAutoCoupons, refreshProgram, updateResults, type Stage } from "../lib/pipeline";

async function logged<T>(job: string, fn: () => Promise<T>): Promise<T | null> {
  const run = await prisma.jobRun.create({ data: { job } });
  try {
    const r = await fn();
    await prisma.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), status: "tamam", detail: JSON.stringify(r ?? null).slice(0, 500) } });
    return r;
  } catch (e) {
    await prisma.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), status: "hata", detail: (e as Error).message.slice(0, 500) } });
    console.error(`[${job}]`, e);
    return null;
  }
}

/** Yeni program açıklandıysa tüm maçları analiz eder. */
export function fixtureJob() {
  return logged("fikstur", async () => {
    const r = await refreshProgram();
    if (r.isNew) await analyzeWeek(r.weekId, "fikstur");
    return r;
  });
}

const WINDOWS: Array<{ stage: Stage; hours: number }> = [
  { stage: "T-24", hours: 24 },
  { stage: "T-3", hours: 3 },
  { stage: "T-1", hours: 1 },
];

/** Maçlardan 24, 3 ve 1 saat önce yeniden hesaplar (her pencere maç başına bir kez). */
export function windowJob() {
  return logged("zaman-pencereleri", async () => {
    const week = await currentWeek();
    if (!week) return { yapilan: 0 };
    let n = 0;
    for (const m of week.matches) {
      const h = (m.kickoff.getTime() - Date.now()) / 3600000;
      if (h <= 0) continue;
      // En dar uygun pencereyi seç (T-1 < T-3 < T-24).
      const due = [...WINDOWS].reverse().find((w) => h <= w.hours);
      if (!due) continue;
      const done = await prisma.predictionSnapshot.findFirst({ where: { matchId: m.id, stage: due.stage } });
      if (done) continue;
      await analyzeMatch(m.id, due.stage);
      n++;
    }
    if (n) await generateAutoCoupons(week.id);
    return { yapilan: n };
  });
}

export function newsJob() {
  return logged("haberler", async () => ({ yenidenHesaplanan: await checkNews() }));
}

export function resultsJob() {
  return logged("sonuclar", async () => {
    await updateResults();
    return { tamam: true };
  });
}
