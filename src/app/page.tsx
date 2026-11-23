import Link from "next/link";
import { weekView, historyView } from "@/lib/queries";
import { Empty, LevelBadge, ProbBar, Stat, TL, fmtDate } from "@/components/ui";
import { RISK_TAG_LABEL } from "@/lib/model/risk";
import { SuccessChart } from "@/components/charts";
import { SOURCES } from "@/lib/sources/registry";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const v = await weekView();
  if (!v) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Ana Panel</h1>
        <Empty>
          Henüz bir Spor Toto programı alınmadı. <Link className="link" href="/kurulum">Kurulum</Link> sayfasından
          “Şimdi yenile” düğmesine basın veya sunucuda <code>npm run refresh</code> çalıştırın. Zamanlayıcı (<code>npm run worker</code>)
          çalışıyorsa resmî liste her 30 dakikada bir kontrol edilir.
        </Empty>
      </div>
    );
  }
  const hist = await historyView();
  const analyzed = v.rows.filter((r) => r.decision?.status === "tahmin");
  const insufficient = v.rows.filter((r) => r.decision?.status === "yetersiz_veri");
  const avgSources = v.rows.length ? v.rows.reduce((a, r) => a + r.sourcesOk, 0) / v.rows.length : 0;
  const strongest = [...analyzed]
    .filter((r) => r.decision!.confidence !== "Düşük")
    .sort((a, b) => Math.max(b.decision!.probs!.p1, b.decision!.probs!.pX, b.decision!.probs!.p2) - Math.max(a.decision!.probs!.p1, a.decision!.probs!.pX, a.decision!.probs!.p2))
    .slice(0, 5);
  const risky = v.rows.filter((r) => r.flags.length).sort((a, b) => b.flags.length - a.flags.length).slice(0, 6);
  const autoCoupons = v.coupons.filter((c) => c.origin === "otomatik");
  const accessible = SOURCES.filter((s) => s.access !== "erisilemez").length;
  const chartData = [...hist.weeks].reverse().map((w) => ({
    hafta: `${w.programNo}.`,
    ai: w.grade.graded ? Math.round((w.grade.aiMainCorrect / w.grade.graded) * 100) : null,
    kupon: w.grade.graded ? Math.round((w.grade.aiPickCorrect / w.grade.graded) * 100) : null,
    uzman: w.grade.expert.total ? Math.round((w.grade.expert.correct / w.grade.expert.total) * 100) : null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">
            {v.week.season} · <span className="text-gold-400">{v.week.programNo}. Oyun Programı</span>
          </h1>
          <p className="text-sm text-slate-400">
            Kaynak: <a className="link" href={v.week.sourceUrl} target="_blank">sportoto.gov.tr</a> · Liste alınma: {fmtDate(v.week.fetchedAt)} · Kapanış: {fmtDate(v.week.closesAt)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Analiz edilen maç" value={`${analyzed.length} / ${v.rows.length}`} hint={insufficient.length ? `${insufficient.length} maçta veri yetersiz, tahmin verilmedi` : "Tüm maçlar için tahmin var"} accent="green" />
        <Stat label="Veri alınan kaynak" value={v.distinctSources.length} hint={`Maç başına ort. ${avgSources.toFixed(1)} · erişilebilir katalog: ${accessible} · hedef: 10`} accent={avgSources >= 10 ? "green" : "yellow"} />
        <Stat label="Hazır kupon" value={autoCoupons.length} hint={autoCoupons.length ? `Toplam maliyet ${TL(autoCoupons.reduce((a, c) => a + c.cost, 0))}` : "Analizden sonra oluşur"} />
        <Stat
          label="Kolon fiyatı"
          value={TL(v.columnPrice.value)}
          hint={v.columnPrice.verified ? "Doğrulanmış" : "Doğrulanmamış (Kurulum'dan onaylayın)"}
          accent={v.columnPrice.verified ? "green" : "yellow"}
        />
      </div>

      <section className="card overflow-x-auto">
        <div className="card-title">15 maçlık fikstür ve AI tahminleri</div>
        <table className="tbl min-w-[860px]">
          <thead>
            <tr>
              <th>#</th>
              <th>Maç</th>
              <th>Tarih (TSİ)</th>
              <th>Olasılıklar</th>
              <th>Tahmin</th>
              <th>Güven / Risk / Veri</th>
              <th>Kaynak</th>
              <th>Sonuç</th>
            </tr>
          </thead>
          <tbody>
            {v.rows.map((r) => (
              <tr key={r.id} className="hover:bg-ink-800/50">
                <td className="font-semibold text-slate-400">{r.order}</td>
                <td>
                  <Link className="font-semibold text-slate-100 hover:text-pitch-400" href={`/mac/${r.id}`}>
                    {r.home} – {r.away}
                  </Link>
                </td>
                <td className="whitespace-nowrap text-slate-400">{fmtDate(r.kickoff)}</td>
                <td>
                  {r.decision?.percentages ? (
                    <ProbBar {...r.decision.percentages} />
                  ) : r.decision ? (
                    <span className="text-xs text-gold-300">Veri yetersiz – tahmin yok</span>
                  ) : (
                    <span className="text-xs text-slate-500">Henüz analiz edilmedi</span>
                  )}
                </td>
                <td className="whitespace-nowrap">
                  {r.decision?.mainPick ? (
                    <>
                      <span className="text-lg font-bold text-pitch-400">{r.decision.mainPick}</span>
                      <span className="ml-2 text-xs text-slate-400">öneri: {r.decision.suggestedPick}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="space-x-1 space-y-1">
                  <LevelBadge level={r.decision?.confidence} kind="guven" />
                  <LevelBadge level={r.decision?.risk} kind="risk" />
                  <LevelBadge level={r.decision?.dataSufficiency} kind="veri" />
                </td>
                <td className="tabular-nums">
                  <span className={r.sourcesOk >= 10 ? "text-pitch-400" : "text-gold-300"}>{r.sourcesOk}</span>
                  <span className="text-slate-500"> / {r.sourcesTried}</span>
                </td>
                <td className="font-semibold">{r.result ? `${r.score ?? ""} (${r.result})` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">
          Kaynak sütunu: veri alınan / denenen kaynak sayısı. Güven, verinin miktarı ve motorların uyumunu ölçer; kazanma olasılığı değildir.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <div className="card-title">En güçlü tahminler</div>
          {strongest.length ? (
            <ul className="space-y-2">
              {strongest.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <Link href={`/mac/${r.id}`} className="hover:text-pitch-400">
                    {r.order}. {r.home} – {r.away}
                  </Link>
                  <span className="whitespace-nowrap font-semibold text-pitch-400">
                    {r.decision!.mainPick} · %{Math.max(r.decision!.percentages!.p1, r.decision!.percentages!.pX, r.decision!.percentages!.p2)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Güveni orta veya yüksek tahmin yok.</Empty>
          )}
        </section>
        <section className="card">
          <div className="card-title">Riskli ve sürpriz maçlar</div>
          {risky.length ? (
            <ul className="space-y-2 text-sm">
              {risky.map((r) => (
                <li key={r.id}>
                  <Link href={`/mac/${r.id}`} className="font-semibold hover:text-pitch-400">
                    {r.order}. {r.home} – {r.away}
                  </Link>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.flags.map((f) => (
                      <span key={f.tag} title={f.reason} className="badge bg-gold-400/15 text-gold-300">
                        {RISK_TAG_LABEL[f.tag]}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Risk işareti yok.</Empty>
          )}
          <Link href="/surpriz" className="link mt-3 inline-block text-sm">Tüm risk analizi →</Link>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card overflow-x-auto">
          <div className="card-title">Hazırlanan kuponlar</div>
          {v.coupons.length ? (
            <table className="tbl">
              <thead>
                <tr><th>Kupon</th><th>Kolon</th><th>Bedel</th><th>Tür</th></tr>
              </thead>
              <tbody>
                {v.coupons.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="tabular-nums">{c.columns}</td>
                    <td className="tabular-nums">{TL(c.cost)}</td>
                    <td className="text-xs text-slate-400">{c.origin}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>Kupon yok.</Empty>
          )}
          <Link href="/kupon" className="link mt-3 inline-block text-sm">Kupon oluşturucuya git →</Link>
        </section>
        <section className="card">
          <div className="card-title">Geçmiş haftaların başarı oranı</div>
          {chartData.length ? <SuccessChart data={chartData} /> : <Empty>Sonuçlanmış hafta yok. Başarı oranları yalnızca gerçek sonuçlardan hesaplanır.</Empty>}
          <Link href="/gecmis" className="link mt-3 inline-block text-sm">Ayrıntılı geçmiş →</Link>
        </section>
      </div>

      <section className="card">
        <div className="card-title">Tahmin değişiklik bildirimleri</div>
        {v.notices.length ? (
          <ul className="space-y-2 text-sm">
            {v.notices.map((n) => (
              <li key={n.id} className="flex flex-wrap justify-between gap-2 border-b border-ink-800 pb-2">
                <span>
                  <b>{n.match.order}. {n.match.homeName} – {n.match.awayName}:</b> {n.summary}
                </span>
                <span className="text-xs text-slate-400">{n.reason} · {fmtDate(n.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Henüz tahmin değişikliği yok.</Empty>
        )}
      </section>
    </div>
  );
}
