import { historyView } from "@/lib/queries";
import { prisma } from "@/lib/db";
import { rate } from "@/lib/tracking/evaluate";
import { Empty, fmtDate } from "@/components/ui";
import { SuccessChart } from "@/components/charts";

export const dynamic = "force-dynamic";

const pct = (c: number, t: number) => {
  const r = rate(c, t);
  return r == null ? "—" : `%${Math.round(r * 100)} (${c}/${t})`;
};

export default async function HistoryPage() {
  const h = await historyView();
  const weights = await prisma.modelWeights.findMany({ orderBy: { createdAt: "desc" }, take: 10 });
  const chart = [...h.weeks].reverse().map((w) => ({
    hafta: `${w.programNo}.`,
    ai: w.grade.graded ? Math.round((w.grade.aiMainCorrect / w.grade.graded) * 100) : null,
    kupon: w.grade.graded ? Math.round((w.grade.aiPickCorrect / w.grade.graded) * 100) : null,
    uzman: w.grade.expert.total ? Math.round((w.grade.expert.correct / w.grade.expert.total) * 100) : null,
  }));
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Geçmiş tahmin başarısı</h1>
        <p className="text-sm text-slate-400">
          Her maç için başlama saatinden önceki son değiştirilemez kayıt, resmî/gerçek sonuçla karşılaştırılır.
        </p>
      </div>
      <section className="card">
        <div className="card-title">Kayıt bütünlüğü</div>
        {h.chain.ok ? (
          <p className="text-pitch-400">✓ {h.chain.count} tahmin kaydının SHA-256 zinciri doğrulandı; hiçbir kayıt sonradan değiştirilmemiş.</p>
        ) : (
          <p className="text-red-400">✗ Zincir {h.chain.brokenAt}. kayıtta bozuk! Kayıtlar veritabanı dışında değiştirilmiş olabilir.</p>
        )}
      </section>
      {h.weeks.length ? (
        <>
          <section className="card"><div className="card-title">Haftalık başarı</div><SuccessChart data={chart} /></section>
          <section className="card overflow-x-auto">
            <table className="tbl min-w-[820px]">
              <thead>
                <tr><th>Hafta</th><th>Sonuçlanan</th><th>AI ana tahmin</th><th>Tekli</th><th>Çifte</th><th>Üçlü</th><th>Önerilen işaret</th><th>15/15</th><th>Uzman ortak görüş</th></tr>
              </thead>
              <tbody>
                {h.weeks.map((w) => (
                  <tr key={w.weekId}>
                    <td>{w.season} · {w.programNo}.</td>
                    <td>{w.grade.graded} ({w.predictedMatches} tahminli)</td>
                    <td>{pct(w.grade.aiMainCorrect, w.grade.graded)}</td>
                    <td>{pct(w.grade.singles.correct, w.grade.singles.total)}</td>
                    <td>{pct(w.grade.doubles.correct, w.grade.doubles.total)}</td>
                    <td>{pct(w.grade.triples.correct, w.grade.triples.total)}</td>
                    <td>{pct(w.grade.aiPickCorrect, w.grade.graded)}</td>
                    <td>{w.grade.allFifteen == null ? "—" : w.grade.allFifteen ? "✓" : "✗"}</td>
                    <td>{pct(w.grade.expert.correct, w.grade.expert.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card overflow-x-auto">
            <div className="card-title">Sezonluk toplam</div>
            <table className="tbl">
              <thead><tr><th>Sezon</th><th>AI ana tahmin</th><th>Tekli</th><th>Çifte</th><th>Üçlü</th><th>Uzman</th></tr></thead>
              <tbody>
                {Object.entries(h.season).map(([s, g]) => (
                  <tr key={s}>
                    <td>{s}</td>
                    <td>{pct(g.aiMainCorrect, g.graded)}</td>
                    <td>{pct(g.singles.correct, g.singles.total)}</td>
                    <td>{pct(g.doubles.correct, g.doubles.total)}</td>
                    <td>{pct(g.triples.correct, g.triples.total)}</td>
                    <td>{pct(g.expert.correct, g.expert.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : (
        <Empty>Henüz sonuçlanmış maç yok. Başarı oranları yalnızca gerçek sonuçlar geldikten sonra hesaplanır.</Empty>
      )}
      <section className="card overflow-x-auto">
        <div className="card-title">Modelin öğrendiği motor ağırlıkları</div>
        {weights.length ? (
          <table className="tbl">
            <thead><tr><th>Tarih</th><th>İstatistik</th><th>Piyasa</th><th>Uzman</th><th>Örnek sayısı</th></tr></thead>
            <tbody>
              {weights.map((w) => {
                const ww = w.weights as Record<string, number>;
                const ss = w.samples as Record<string, number>;
                return (
                  <tr key={w.id}>
                    <td>{fmtDate(w.createdAt)}</td>
                    <td>%{Math.round(ww.istatistik * 100)}</td>
                    <td>%{Math.round(ww.piyasa * 100)}</td>
                    <td>%{Math.round(ww.uzman * 100)}</td>
                    <td className="text-xs text-slate-400">{Object.entries(ss).map(([k, v]) => `${k}: ${v}`).join(", ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty>Henüz öğrenme yapılmadı; varsayılan ağırlıklar kullanılıyor (istatistik %35, piyasa %45, uzman %20).</Empty>
        )}
      </section>
    </div>
  );
}
