import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { analyzeWeek, refreshProgram, updateResults } from "@/lib/pipeline";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

let running = false;

/** Arka planda yenileme başlatır; ilerleme JobRun tablosundan izlenir. */
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { mode } = (await req.json().catch(() => ({}))) as { mode?: "refresh" | "grade" };
  if (running) return NextResponse.json({ error: "Bir yenileme zaten çalışıyor" }, { status: 409 });
  running = true;
  const run = await prisma.jobRun.create({ data: { job: mode === "grade" ? "elle-sonuc" : "elle-yenileme" } });
  void (async () => {
    try {
      let detail = "";
      if (mode === "grade") {
        await updateResults();
        detail = "Sonuçlar alındı";
      } else {
        const r = await refreshProgram();
        const n = await analyzeWeek(r.weekId, r.isNew ? "fikstur" : "manuel");
        detail = `Program ${r.programNo}: ${n} maç analiz edildi`;
      }
      await prisma.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), status: "tamam", detail } });
    } catch (e) {
      await prisma.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), status: "hata", detail: (e as Error).message.slice(0, 500) } });
    } finally {
      running = false;
    }
  })();
  return NextResponse.json({ ok: true, jobId: run.id }, { status: 202 });
}

export async function GET() {
  const runs = await prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 15 });
  return NextResponse.json({ running, runs });
}
