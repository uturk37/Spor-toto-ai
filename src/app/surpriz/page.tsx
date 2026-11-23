import Link from "next/link";
import { weekView } from "@/lib/queries";
import { RISK_TAG_LABEL, type RiskTag } from "@/lib/model/risk";
import { Empty, LevelBadge, ProbBar } from "@/components/ui";

export const dynamic = "force-dynamic";

const ORDER: RiskTag[] = ["favori_kaybedebilir", "beraberlik_yuksek", "surpriz_galibiyet", "uzman_ai_celiski", "yuksek_belirsizlik", "veri_yetersiz"];

export default async function SurprisePage() {
  const v = await weekView();
  if (!v) return <Empty>Henüz program yok.</Empty>;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Sürpriz maç ve risk analizi</h1>
        <p className="text-sm text-slate-400">
          Eşikler: favori ≥%50 ama kazanamama ≥%38 · beraberlik ≥%30 · karşı taraf galibiyeti ≥%25 · en yüksek olasılık &lt;%42 veya entropi ≥0,95.
        </p>
      </div>
      {ORDER.map((tag) => {
        const rows = v.rows.filter((r) => r.flags.some((f) => f.tag === tag));
        return (
          <section key={tag} className="card">
            <div className="card-title">{RISK_TAG_LABEL[tag]} ({rows.length})</div>
            {rows.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {rows.map((r) => (
                  <div key={r.id} className="rounded-lg border border-ink-700 bg-ink-950/60 p-3">
                    <Link href={`/mac/${r.id}`} className="font-semibold hover:text-pitch-400">
                      {r.order}. {r.home} – {r.away}
                    </Link>
                    {r.decision?.percentages ? <div className="mt-2"><ProbBar {...r.decision.percentages} /></div> : null}
                    <p className="mt-2 text-sm text-slate-300">{r.flags.find((f) => f.tag === tag)!.reason}</p>
                    <div className="mt-2 flex gap-1">
                      <LevelBadge level={r.decision?.risk} kind="risk" />
                      <LevelBadge level={r.decision?.confidence} kind="guven" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>Bu kategoride maç yok.</Empty>
            )}
          </section>
        );
      })}
    </div>
  );
}
