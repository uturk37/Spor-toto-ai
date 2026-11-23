import { prisma } from "@/lib/db";
import { ACCESS_LABEL, SOURCES, hasKey } from "@/lib/sources/registry";
import { StatusBadge, fmtDate } from "@/components/ui";
import type { SourceStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const since = new Date(Date.now() - 7 * 86400000);
  const fetches = await prisma.sourceFetch.groupBy({ by: ["sourceId", "status"], where: { fetchedAt: { gt: since } }, _count: true, _max: { fetchedAt: true } });
  const accessible = SOURCES.filter((s) => s.access !== "erisilemez");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Veri kaynakları</h1>
        <p className="text-sm text-slate-400">
          Hedef maç başına 10 kaynak. Katalogda {accessible.length} erişilebilir kaynak var; bunların {accessible.filter(hasKey).length} tanesi şu an etkin.
          Erişilemeyen kaynaklardan veri çekilmez ve veri varmış gibi gösterilmez.
        </p>
      </div>
      <section className="card overflow-x-auto">
        <table className="tbl min-w-[900px]">
          <thead>
            <tr><th>Kaynak</th><th>Erişim</th><th>Kapsam</th><th>Durum</th><th>Son 7 gün</th><th>Not</th></tr>
          </thead>
          <tbody>
            {SOURCES.map((s) => {
              const rows = fetches.filter((f) => f.sourceId === s.id);
              const last = rows.reduce<Date | null>((a, r) => (r._max.fetchedAt && (!a || r._max.fetchedAt > a) ? r._max.fetchedAt : a), null);
              return (
                <tr key={s.id}>
                  <td><a className="link font-semibold" href={s.homepage} target="_blank">{s.name}</a></td>
                  <td className="whitespace-nowrap">
                    <span className={`badge ${s.access === "erisilemez" ? "bg-red-500/15 text-red-400" : s.access === "ucretli" ? "bg-gold-400/15 text-gold-300" : "bg-pitch-500/15 text-pitch-400"}`}>{ACCESS_LABEL[s.access]}</span>
                  </td>
                  <td className="text-xs">{s.coverage}</td>
                  <td>
                    {s.access === "erisilemez" ? <StatusBadge status="unavailable" /> : !hasKey(s) ? <StatusBadge status="missing_key" /> : <span className="badge bg-pitch-500/15 text-pitch-400">Etkin</span>}
                    {s.envKey ? <div className="mt-1 font-mono text-[11px] text-slate-500">{s.envKey}</div> : null}
                  </td>
                  <td className="text-xs">
                    {rows.length ? (
                      <div className="space-y-1">
                        {rows.map((r) => (
                          <div key={r.status}><StatusBadge status={r.status as SourceStatus} /> ×{r._count}</div>
                        ))}
                        <div className="text-slate-500">son: {fmtDate(last)}</div>
                      </div>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="text-xs text-slate-400">{s.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
