import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import type { DecisionOutput } from "@/lib/model/engines";
import type { RiskFlag } from "@/lib/model/risk";
import { RISK_TAG_LABEL } from "@/lib/model/risk";
import type { MatchDossier, SnapshotPayload } from "@/lib/pipeline";
import type { FormBlock, TeamStats } from "@/lib/data/stats";
import { ALL_PICKS } from "@/lib/types";
import { Empty, LevelBadge, ProbBar, StatusBadge, fmtDate, fmtNum, fmtPct } from "@/components/ui";
import { EngineChart } from "@/components/charts";

export const dynamic = "force-dynamic";

function Form({ b }: { b: FormBlock | null | undefined }) {
  if (!b || !b.n) return <span className="muted">veri yok</span>;
  return (
    <span className="tabular-nums">
      {b.n} maç: {b.w}G {b.d}B {b.l}M · {b.gf}-{b.ga} · {b.ppg.toFixed(2)} P/M · {b.gfAvg.toFixed(2)} / {b.gaAvg.toFixed(2)} gol
      {b.sequence ? <span className="ml-2 font-mono text-xs text-slate-400">{b.sequence}</span> : null}
    </span>
  );
}

function StatsTable({ s, title }: { s: TeamStats; title: string }) {
  const rows: Array<[string, React.ReactNode]> = [
    ["Son 5", <Form key="5" b={s.last5} />],
    ["Son 10", <Form key="10" b={s.last10} />],
    ["İç saha (son 10)", <><Form b={s.home} /> {s.home.n ? <span className="muted"> · galibiyet {fmtPct(s.home.winRate)}</span> : null}</>],
    ["Deplasman (son 10)", <><Form b={s.away} /> {s.away.n ? <span className="muted"> · galibiyet {fmtPct(s.away.winRate)}</span> : null}</>],
    ["Güçlü rakiplere karşı", <Form key="s" b={s.vsStronger} />],
    ["Zayıf rakiplere karşı", <Form key="w" b={s.vsWeaker} />],
    ["xG / xGA (maç başı)", `${fmtNum(s.xg.value)} / ${fmtNum(s.xga.value)}${s.xg.n ? ` (${s.xg.n} maç)` : ""}`],
    ["Şut / isabetli şut", `${fmtNum(s.shots.value, 1)} / ${fmtNum(s.shotsOnTarget.value, 1)}`],
    ["Topla oynama", s.possession.value == null ? "veri yok" : `%${s.possession.value.toFixed(0)}`],
    ["Korner", fmtNum(s.corners.value, 1)],
    ["İlk yarı", s.firstHalf ? `${s.firstHalf.ppg.toFixed(2)} P/M · ${s.firstHalf.gfAvg.toFixed(2)}-${s.firstHalf.gaAvg.toFixed(2)} gol (${s.firstHalf.n} maç)` : "veri yok"],
    ["2,5 üst / KG var", `${fmtPct(s.over25Rate)} / ${fmtPct(s.bttsRate)}`],
    ["Dinlenme süresi", s.restDays == null ? "veri yok" : `${s.restDays} gün`],
    ["Son 14 günde maç", `${s.matchesLast14Days}`],
    ["İstikrar (puan std. sapma)", s.pointsStdDev == null ? "veri yok" : `${s.pointsStdDev.toFixed(2)} (düşük = istikrarlı)`],
  ];
  return (
    <div>
      <div className="mb-1 text-sm font-semibold text-slate-200">{title}</div>
      <table className="tbl">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="w-48 text-slate-400">{k}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await prisma.match.findUnique({
    where: { id },
    include: {
      analysis: true,
      week: true,
      snapshots: { orderBy: { seq: "desc" } },
      notices: { orderBy: { createdAt: "desc" } },
      experts: { orderBy: { fetchedAt: "desc" } },
    },
  });
  if (!m) notFound();
  const d = m.analysis?.decision as unknown as DecisionOutput | undefined;
  const dossier = m.analysis?.evidence as unknown as MatchDossier | undefined;
  const flags = (m.analysis?.riskFlags as unknown as RiskFlag[]) ?? [];
  const engineData = (d?.engines ?? []).map((e) => ({
    motor: e.engine === "istatistik" ? "İstatistik" : e.engine === "piyasa" ? "Piyasa" : "Uzman",
    "1": Math.round(e.probs.p1 * 100),
    X: Math.round(e.probs.pX * 100),
    "2": Math.round(e.probs.p2 * 100),
  }));
  if (d?.percentages) engineData.push({ motor: "AI karar", "1": d.percentages.p1, X: d.percentages.pX, "2": d.percentages.p2 });
  const ec = d?.expert;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/" className="link text-sm">← Ana panel</Link>
        <h1 className="mt-1 text-2xl font-bold">
          {m.order}. {m.homeName} <span className="text-slate-500">–</span> {m.awayName}
        </h1>
        <p className="text-sm text-slate-400">
          {fmtDate(m.kickoff)} TSİ · {m.week.season} {m.week.programNo}. program · Son analiz: {fmtDate(m.analysis?.updatedAt)}
          {m.result ? <b className="ml-2 text-gold-300">Sonuç: {m.score} ({m.result}) – kaynak: {m.resultSource}</b> : null}
        </p>
      </div>

      {!d ? (
        <Empty>Bu maç henüz analiz edilmedi.</Empty>
      ) : (
        <>
          <section className="card">
            <div className="card-title">AI karar motoru</div>
            {d.status === "yetersiz_veri" ? (
              <div className="rounded-lg border border-gold-500/40 bg-gold-400/10 p-3 text-gold-300">{d.warning}</div>
            ) : (
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <ProbBar {...d.percentages!} />
                  <div className="mt-3 text-sm">
                    Ana tahmin: <b className="text-xl text-pitch-400">{d.mainPick}</b> · Önerilen işaret: <b className="text-gold-300">{d.suggestedPick}</b>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <LevelBadge level={d.confidence} kind="guven" />
                    <LevelBadge level={d.risk} kind="risk" />
                    <LevelBadge level={d.dataSufficiency} kind="veri" />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Güven puanı {(d.confidenceScore! * 100).toFixed(0)}/100: kaynak sayısı, motor uyumu ve örneklem niteliğinden hesaplanır; kazanma olasılığı değildir.</p>
                  {d.warning ? <p className="mt-2 text-xs text-gold-300">{d.warning}</p> : null}
                </div>
                <div className="md:col-span-2">
                  <EngineChart data={engineData} />
                </div>
              </div>
            )}
            {d.reasoning.length ? (
              <div className="mt-4">
                <div className="mb-1 text-sm font-semibold">Tahmin gerekçesi</div>
                <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
                  {d.reasoning.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            ) : null}
            {flags.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {flags.map((f) => (
                  <div key={f.tag} className="rounded-lg border border-gold-500/30 bg-gold-400/10 px-3 py-2 text-sm">
                    <b className="text-gold-300">{RISK_TAG_LABEL[f.tag]}:</b> {f.reason}
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="card">
            <div className="card-title">Uzman tahminleri</div>
            {ec && ec.rawCount ? (
              <>
                <div className="mb-3 grid grid-cols-4 gap-2 text-center text-sm sm:grid-cols-7">
                  {ALL_PICKS.map((p) => (
                    <div key={p} className="rounded-lg bg-ink-800 p-2">
                      <div className="font-bold">{p}</div>
                      <div className="text-lg tabular-nums text-pitch-400">{ec.pickCounts[p]}</div>
                    </div>
                  ))}
                </div>
                <p className="text-sm">
                  {ec.independentCount} bağımsız görüş ({ec.rawCount} ham tahmin). Ortak görüş: <b>{ec.consensusPick ?? "—"}</b> · uyum %{Math.round(ec.agreement * 100)}
                </p>
                {ec.duplicates.length ? (
                  <p className="mt-1 text-xs text-slate-400">Kopya sayılmayanlar: {ec.duplicates.map((x) => `${x.sourceName} (= ${x.sameAs})`).join(", ")}</p>
                ) : null}
                {ec.contradictions.map((c, i) => <p key={i} className="mt-1 text-sm text-gold-300">{c}</p>)}
                <table className="tbl mt-3">
                  <thead><tr><th>Kaynak</th><th>Tahmin</th><th>Yayın</th><th>Giriş</th></tr></thead>
                  <tbody>
                    {m.experts.map((e) => (
                      <tr key={e.id}>
                        <td><a className="link" href={e.url} target="_blank">{e.sourceName}</a></td>
                        <td className="font-bold">{e.pick}</td>
                        <td className="text-slate-400">{fmtDate(e.publishedAt)}</td>
                        <td className="text-xs text-slate-400">{e.enteredBy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <Empty>Bu maç için kaynağı doğrulanabilir uzman tahmini bulunamadı. Kurulum sayfasından bağlantısıyla birlikte elle eklenebilir.</Empty>
            )}
          </section>

          <section className="card">
            <div className="card-title">Takım formu ve istatistikler</div>
            {dossier && (dossier.homeStats.length || dossier.awayStats.length) ? (
              <div className="space-y-6">
                {dossier.homeStats.map((s) => (
                  <div key={`h-${s.sourceId}`}>
                    <StatsTable s={s.stats} title={`${m.homeName} · kaynak: ${s.prov.sourceName}`} />
                    <p className="mt-1 text-xs text-slate-500">
                      <a className="link" href={s.prov.url} target="_blank">{s.prov.url}</a> · alındı {fmtDate(s.prov.fetchedAt)} · son maç {fmtDate(s.prov.dataAsOf, false)}
                    </p>
                  </div>
                ))}
                {dossier.awayStats.map((s) => (
                  <div key={`a-${s.sourceId}`}>
                    <StatsTable s={s.stats} title={`${m.awayName} · kaynak: ${s.prov.sourceName}`} />
                    <p className="mt-1 text-xs text-slate-500">
                      <a className="link" href={s.prov.url} target="_blank">{s.prov.url}</a> · alındı {fmtDate(s.prov.fetchedAt)} · son maç {fmtDate(s.prov.dataAsOf, false)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>Takım istatistiği alınamadı.</Empty>
            )}
            <p className="mt-3 text-xs text-slate-500">Teknik direktör değişikliği verisi şu an bağlı kaynaklarda yapılandırılmış olarak yok; gösterilmiyor.</p>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card">
              <div className="card-title">İkili rekabet</div>
              {dossier?.h2h.length ? (
                dossier.h2h.map((h, i) => (
                  <div key={i} className="mb-3">
                    <table className="tbl">
                      <tbody>
                        {h.matches.map((x, j) => (
                          <tr key={j}>
                            <td className="text-slate-400">{fmtDate(x.date, false)}</td>
                            <td>{x.home} {x.hg}-{x.ag} {x.away}</td>
                            <td className="text-xs text-slate-500">{x.competition}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-xs text-slate-500">Kaynak: {h.prov.sourceName}</p>
                  </div>
                ))
              ) : (
                <Empty>İkili rekabet verisi yok.</Empty>
              )}
            </section>
            <section className="card">
              <div className="card-title">Kadro, sakatlık ve son dakika</div>
              {dossier?.absences.length ? (
                <table className="tbl mb-3">
                  <thead><tr><th>Takım</th><th>Oyuncu</th><th>Durum</th><th>İlk 11 oyuncusu</th></tr></thead>
                  <tbody>
                    {dossier.absences.map((a, i) => (
                      <tr key={i}>
                        <td>{a.side === "home" ? m.homeName : m.awayName}</td>
                        <td>{a.player}<div className="text-xs text-slate-500">{a.reason}</div></td>
                        <td>{a.status}</td>
                        <td>{a.regularStarter == null ? "bilinmiyor" : a.regularStarter ? "evet" : "hayır"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty>Yapılandırılmış sakat/cezalı listesi yok (API-Football anahtarı gerekir).</Empty>
              )}
              {dossier?.lineups.length ? (
                <div className="mb-3 text-sm">
                  {dossier.lineups.map((l, i) => (
                    <p key={i}><b>{l.side === "home" ? m.homeName : m.awayName} {l.formation}:</b> {l.startXI.join(", ")} <span className="text-xs text-slate-500">({l.official ? "resmî" : "muhtemel"})</span></p>
                  ))}
                </div>
              ) : (
                <p className="mb-3 text-xs text-slate-500">Resmî ilk 11 maçtan yaklaşık 20-40 dk önce açıklanır. Muhtemel 11 için bağlı kaynaklarda yapılandırılmış veri yok.</p>
              )}
              {dossier?.news.length ? (
                <ul className="space-y-1 text-sm">
                  {dossier.news.map((n, i) => (
                    <li key={i}>
                      <span className={`badge mr-1 ${n.kind === "sakatlik" ? "bg-red-500/15 text-red-400" : "bg-ink-700 text-slate-300"}`}>{n.kind}</span>
                      <a className="link" href={n.url} target="_blank">{n.title}</a>
                      <span className="text-xs text-slate-500"> · {n.prov.sourceName} · {fmtDate(n.publishedAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">Haber akışlarında bu takımlarla ilgili son 7 günde haber bulunamadı.</p>
              )}
            </section>
          </div>

          <section className="card overflow-x-auto">
            <div className="card-title">Kaynaklar ({dossier ? new Set(dossier.evidence.sourcesOk).size : 0} kaynaktan veri alındı)</div>
            <table className="tbl min-w-[700px]">
              <thead><tr><th>Kaynak</th><th>Durum</th><th>Özet / hata</th><th>Alınma</th><th>Veri tarihi</th></tr></thead>
              <tbody>
                {dossier?.sources.map((s, i) => (
                  <tr key={i}>
                    <td><a className="link" href={s.url} target="_blank">{s.sourceName}</a></td>
                    <td><StatusBadge status={s.status} /></td>
                    <td className="text-xs text-slate-400">{s.summary ?? s.error ?? ""}</td>
                    <td className="whitespace-nowrap text-xs">{fmtDate(s.fetchedAt)}</td>
                    <td className="whitespace-nowrap text-xs">{fmtDate(s.dataAsOf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      <section className="card overflow-x-auto">
        <div className="card-title">Değiştirilemez tahmin kayıtları</div>
        {m.snapshots.length ? (
          <table className="tbl min-w-[700px]">
            <thead><tr><th>Zaman damgası</th><th>Aşama</th><th>1 / X / 2</th><th>Tahmin</th><th>Özet (SHA-256)</th></tr></thead>
            <tbody>
              {m.snapshots.map((s) => {
                const p = s.payload as unknown as SnapshotPayload;
                return (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap">{fmtDate(s.createdAt)}</td>
                    <td>{s.stage}</td>
                    <td className="tabular-nums">{p.percentages ? `%${p.percentages.p1} / %${p.percentages.pX} / %${p.percentages.p2}` : "veri yetersiz"}</td>
                    <td>{p.mainPick ?? "—"} ({p.suggestedPick ?? "—"})</td>
                    <td className="font-mono text-xs text-slate-500">{s.hash.slice(0, 16)}…</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty>Kayıt yok.</Empty>
        )}
        {m.notices.length ? (
          <div className="mt-3 space-y-1 text-sm">
            {m.notices.map((n) => (
              <p key={n.id}><b className="text-gold-300">{n.reason}</b> ({fmtDate(n.createdAt)}): {n.summary}</p>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
