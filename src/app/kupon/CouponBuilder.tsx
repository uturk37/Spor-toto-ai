"use client";
import { useMemo, useState } from "react";
import { ALL_PICKS, type Pick, type Probs } from "@/lib/types";
import { MAX_COLUMNS_PER_COUPON, manualCalc } from "@/lib/coupon/math";
import { buildCouponSet, optimizeCoupon, summarize, DEFAULT_BUDGETS, InfeasibleCouponError, type CouponKind } from "@/lib/coupon/optimizer";
import { adminFetch } from "@/components/admin";

interface M {
  id: string;
  order: number;
  home: string;
  away: string;
  probs: Probs | null;
  suggested: Pick | null;
}
interface C {
  id: string;
  name: string;
  picks: Pick[];
  columns: number;
  cost: number;
  origin: string;
}

const UNIFORM: Probs = { p1: 1 / 3, pX: 1 / 3, p2: 1 / 3 };
const tl = (v: number) => v.toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
const pc = (v: number) => `%${(v * 100).toLocaleString("tr-TR", { maximumSignificantDigits: 3 })}`;

export function CouponBuilder(props: {
  weekId: string;
  title: string;
  matches: M[];
  coupons: C[];
  columnPrice: number;
  priceVerified: boolean;
  priceSource: string | null;
  budget: number;
}) {
  const [picks, setPicks] = useState<Pick[]>(() => props.matches.map((m) => m.suggested ?? "1X2"));
  const [locked, setLocked] = useState<boolean[]>(() => props.matches.map(() => false));
  const [price, setPrice] = useState(props.columnPrice);
  const [budget, setBudget] = useState(props.budget);
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState("Kendi kuponum");
  const [editing, setEditing] = useState<string | null>(null);
  const [manual, setManual] = useState({ singles: 11, doubles: 3, triples: 1 });

  const probs = props.matches.map((m) => m.probs ?? UNIFORM);
  const current = useMemo(() => summarize(picks, probs, price), [picks, price]); // eslint-disable-line react-hooks/exhaustive-deps
  const overBudget = current.cost > budget + 1e-9;
  const overLimit = current.columns > MAX_COLUMNS_PER_COUPON;
  const manualRes = manualCalc({ ...manual, columnPrice: price, budget });

  function optimize(kind: CouponKind | number) {
    setMsg(null);
    try {
      const inputs = props.matches.map((m, i) => ({ probs: probs[i], locked: locked[i] ? picks[i] : undefined }));
      const r = typeof kind === "number" ? optimizeCoupon({ matches: inputs, columnPrice: price, budget: kind }) : buildCouponSet(inputs, price, budget)[kind];
      setPicks(r.picks);
      if (typeof kind === "number") setBudget(kind);
    } catch (e) {
      setMsg(e instanceof InfeasibleCouponError ? e.message : (e as Error).message);
    }
  }

  async function save() {
    setMsg(null);
    try {
      if (editing) await adminFetch(`/api/coupons/${editing}`, { method: "PUT", json: { name, picks, columnPrice: price } });
      else await adminFetch("/api/coupons", { method: "POST", json: { weekId: props.weekId, name, picks, columnPrice: price } });
      setMsg("Kupon kaydedildi. Listeyi görmek için sayfayı yenileyin.");
      setEditing(null);
    } catch (e) {
      setMsg(`Kaydedilemedi: ${(e as Error).message}`);
    }
  }

  async function remove(id: string) {
    try {
      await adminFetch(`/api/coupons/${id}`, { method: "DELETE" });
      setMsg("Kupon silindi. Sayfayı yenileyin.");
    } catch (e) {
      setMsg(`Silinemedi: ${(e as Error).message}`);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Akıllı kupon oluşturucu</h1>
        <p className="text-sm text-slate-400">{props.title}. Her maçta tekli, çifte veya üçlü seçin; kilitlediğiniz maçlar otomatik optimizasyonda değişmez.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2 overflow-x-auto">
          <table className="tbl min-w-[620px]">
            <thead>
              <tr><th>#</th><th>Maç</th><th>Tercih</th><th>Tutma ol.</th><th>Kilit</th></tr>
            </thead>
            <tbody>
              {props.matches.map((m, i) => (
                <tr key={m.id}>
                  <td className="text-slate-400">{m.order}</td>
                  <td>
                    <div className="font-semibold">{m.home} – {m.away}</div>
                    <div className="text-[11px] text-slate-500">
                      {m.probs ? `1 %${Math.round(m.probs.p1 * 100)} · X %${Math.round(m.probs.pX * 100)} · 2 %${Math.round(m.probs.p2 * 100)}` : "veri yetersiz – eşit olasılık varsayıldı"}
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {ALL_PICKS.map((p) => (
                        <button
                          key={p}
                          onClick={() => setPicks((ps) => ps.map((x, j) => (j === i ? p : x)))}
                          className={`rounded-md px-2 py-1 text-xs font-bold ${picks[i] === p ? (p.length === 1 ? "bg-pitch-500 text-ink-950" : p.length === 2 ? "bg-gold-400 text-ink-950" : "bg-sky-500 text-ink-950") : "bg-ink-800 text-slate-300 hover:bg-ink-700"}`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="tabular-nums">{pc(current.coverages[i])}</td>
                  <td>
                    <input type="checkbox" checked={locked[i]} onChange={(e) => setLocked((ls) => ls.map((x, j) => (j === i ? e.target.checked : x)))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="space-y-4">
          <section className="card">
            <div className="card-title">Kupon özeti</div>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="muted">Tekli / çifte / üçlü</dt><dd className="text-right tabular-nums">{current.singles} / {current.doubles} / {current.triples}</dd>
              <dt className="muted">Kolon</dt><dd className="text-right tabular-nums">2^{current.doubles} × 3^{current.triples} = <b>{current.columns}</b></dd>
              <dt className="muted">Kupon bedeli</dt><dd className={`text-right font-bold tabular-nums ${overBudget ? "text-red-400" : "text-pitch-400"}`}>{tl(current.cost)}</dd>
              <dt className="muted">15 bilme olasılığı</dt><dd className="text-right tabular-nums">{pc(current.pAll)}</dd>
              <dt className="muted">≥14 / ≥13 / ≥12</dt><dd className="text-right tabular-nums text-xs">{pc(current.pAtLeast14)} / {pc(current.pAtLeast13)} / {pc(current.pAtLeast12)}</dd>
              <dt className="muted">Beklenen doğru</dt><dd className="text-right tabular-nums">{current.expectedHits.toFixed(2)}</dd>
            </dl>
            {overBudget ? <p className="mt-2 text-sm text-red-400">Bütçeyi {tl(current.cost - budget)} aşıyor.</p> : null}
            {overLimit ? <p className="mt-2 text-sm text-red-400">Bir kupon en fazla {MAX_COLUMNS_PER_COUPON} kolon olabilir.</p> : null}
            <p className="mt-2 text-[11px] text-slate-500">Olasılıklar maçlar bağımsız varsayılarak hesaplanır; garanti değildir.</p>
          </section>

          <section className="card space-y-3">
            <div className="card-title">Fiyat ve bütçe</div>
            <label className="block text-sm">Kolon fiyatı (TL)
              <input className="input mt-1" type="number" min={0.01} step={0.01} value={price} onChange={(e) => setPrice(Number(e.target.value) || 0)} />
            </label>
            <p className={`text-xs ${props.priceVerified ? "text-pitch-400" : "text-gold-300"}`}>
              {props.priceVerified ? "Doğrulanmış fiyat." : "Bu fiyat resmî kaynaktan doğrulanmadı."} Kaynak: {props.priceSource ?? "manuel"}
            </p>
            <label className="block text-sm">Toplam bütçe (TL)
              <input className="input mt-1" type="number" min={1} value={budget} onChange={(e) => setBudget(Number(e.target.value) || 0)} />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button className="btn-ghost" onClick={() => optimize("ekonomik")}>Ekonomik</button>
              <button className="btn-ghost" onClick={() => optimize("dengeli")}>Dengeli</button>
              <button className="btn-primary" onClick={() => optimize("genis")}>Geniş</button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {DEFAULT_BUDGETS.map((b) => (
                <button key={b} className="btn-ghost text-xs" onClick={() => optimize(b)}>{b.toLocaleString("tr-TR")} TL</button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">
              Optimizasyon, bütçeyi aşmadan 15 maçın tamamını tutturma olasılığını en yükseğe çıkaran tekli/çifte/üçlü dağılımını kesin olarak (dinamik programlama) bulur. Ekonomik: bütçenin en fazla %10'u, dengeli: %40, geniş: tamamı.
            </p>
          </section>

          <section className="card space-y-2">
            <div className="card-title">Kaydet</div>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn-primary w-full" disabled={overLimit} onClick={save}>{editing ? "Değişiklikleri kaydet" : "Kuponu kaydet"}</button>
            {msg ? <p className="text-sm text-gold-300">{msg}</p> : null}
          </section>
        </div>
      </div>

      <section className="card">
        <div className="card-title">Elle kolon hesabı</div>
        <div className="grid gap-3 sm:grid-cols-4">
          {(["singles", "doubles", "triples"] as const).map((k) => (
            <label key={k} className="text-sm">{k === "singles" ? "Tekli" : k === "doubles" ? "Çifte" : "Üçlü"}
              <input className="input mt-1" type="number" min={0} max={15} value={manual[k]} onChange={(e) => setManual({ ...manual, [k]: Number(e.target.value) })} />
            </label>
          ))}
          <div className="text-sm">
            {manualRes.errors.length ? (
              <p className="text-red-400">{manualRes.errors.join(" · ")}</p>
            ) : (
              <>
                <p>Kolon: <b>{manualRes.columns}</b></p>
                <p>Bedel: <b className={manualRes.withinBudget ? "text-pitch-400" : "text-red-400"}>{tl(manualRes.cost)}</b></p>
                {!manualRes.withinColumnLimit ? <p className="text-red-400">2500 kolon sınırı aşıldı</p> : null}
              </>
            )}
          </div>
        </div>
      </section>

      <section className="card overflow-x-auto">
        <div className="card-title">Kayıtlı kuponlar</div>
        <table className="tbl min-w-[800px]">
          <thead><tr><th>Ad</th><th>İşaretler (1→15)</th><th>Kolon</th><th>Bedel</th><th></th></tr></thead>
          <tbody>
            {props.coupons.map((c) => (
              <tr key={c.id}>
                <td>{c.name}<div className="text-xs text-slate-500">{c.origin}</div></td>
                <td className="font-mono text-xs">{c.picks.join(" · ")}</td>
                <td className="tabular-nums">{c.columns}</td>
                <td className="tabular-nums">{tl(c.cost)}</td>
                <td className="whitespace-nowrap space-x-1">
                  <button className="btn-ghost text-xs" onClick={() => { setPicks(c.picks); setName(c.name); setEditing(c.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Düzenle</button>
                  <button className="btn-ghost text-xs" onClick={() => remove(c.id)}>Sil</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Otomatik kuponlar her yeni analizde yeniden hesaplanır. Düzenlediğiniz kupon “manuel” olarak saklanır ve üzerine yazılmaz.</p>
      </section>
    </div>
  );
}
