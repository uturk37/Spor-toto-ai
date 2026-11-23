import { weekView } from "@/lib/queries";
import { Empty } from "@/components/ui";
import { CouponBuilder } from "./CouponBuilder";

export const dynamic = "force-dynamic";

export default async function CouponPage() {
  const v = await weekView();
  if (!v || v.rows.length !== 15) return <Empty>15 maçlık güncel program henüz yok.</Empty>;
  return (
    <CouponBuilder
      weekId={v.week.id}
      title={`${v.week.season} · ${v.week.programNo}. Oyun Programı`}
      matches={v.rows.map((r) => ({
        id: r.id,
        order: r.order,
        home: r.home,
        away: r.away,
        probs: r.decision?.probs ?? null,
        suggested: r.decision?.suggestedPick ?? null,
      }))}
      coupons={v.coupons.map((c) => ({ id: c.id, name: c.name, picks: c.picks, columns: c.columns, cost: c.cost, origin: c.origin }))}
      columnPrice={v.columnPrice.value}
      priceVerified={v.columnPrice.verified}
      priceSource={v.columnPrice.source}
      budget={v.budget}
    />
  );
}
