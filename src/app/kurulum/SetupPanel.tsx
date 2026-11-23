"use client";
import { useEffect, useState } from "react";
import { adminFetch, getToken, setToken } from "@/components/admin";
import { ALL_PICKS } from "@/lib/types";

interface Run { id: string; job: string; startedAt: string; finishedAt: string | null; status: string; detail: string | null }

export function SetupPanel(props: {
  matches: Array<{ id: string; label: string }>;
  aliases: Array<{ alias: string; canonical: string }>;
  price: { value: number; verified: boolean; source: string };
  budget: number;
}) {
  const [token, setTok] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [price, setPrice] = useState(props.price);
  const [budget, setBudget] = useState(props.budget);
  const [alias, setAlias] = useState({ alias: "", canonical: "" });
  const [ex, setEx] = useState({ matchId: props.matches[0]?.id ?? "", sourceName: "", author: "", url: "", pick: "1", publishedAt: "", copiedFrom: "" });

  useEffect(() => setTok(getToken()), []);
  async function loadRuns() {
    const r = await fetch("/api/refresh").then((x) => x.json()).catch(() => ({ runs: [] }));
    setRuns(r.runs ?? []);
  }
  useEffect(() => {
    void loadRuns();
    const t = setInterval(loadRuns, 5000);
    return () => clearInterval(t);
  }, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      void loadRuns();
    } catch (e) {
      setMsg(`Hata: ${(e as Error).message}`);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card space-y-3">
        <div className="card-title">Yönetici anahtarı ve yenileme</div>
        <input className="input" type="password" placeholder="ADMIN_TOKEN" value={token} onChange={(e) => setTok(e.target.value)} />
        <button className="btn-ghost" onClick={() => { setToken(token); setMsg("Anahtar bu tarayıcıya kaydedildi."); }}>Anahtarı kaydet</button>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => run(() => adminFetch("/api/refresh", { method: "POST", json: { mode: "refresh" } }), "Yenileme başladı (birkaç dakika sürebilir).")}>Şimdi yenile (liste + analiz)</button>
          <button className="btn-ghost" onClick={() => run(() => adminFetch("/api/refresh", { method: "POST", json: { mode: "grade" } }), "Sonuç kontrolü başladı.")}>Sonuçları al</button>
        </div>
        {msg ? <p className="text-sm text-gold-300">{msg}</p> : null}
        <div className="max-h-60 overflow-y-auto text-xs">
          {runs.map((r) => (
            <div key={r.id} className="border-b border-ink-800 py-1">
              <b className={r.status === "hata" ? "text-red-400" : r.status === "tamam" ? "text-pitch-400" : "text-gold-300"}>{r.status}</b> {r.job} · {new Date(r.startedAt).toLocaleString("tr-TR")}
              {r.detail ? <div className="text-slate-500">{r.detail}</div> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="card space-y-3">
        <div className="card-title">Kolon fiyatı ve bütçe</div>
        <label className="block text-sm">Kolon fiyatı (TL)
          <input className="input mt-1" type="number" step={0.01} value={price.value} onChange={(e) => setPrice({ ...price, value: Number(e.target.value) })} />
        </label>
        <label className="block text-sm">Fiyat kaynağı (bağlantı)
          <input className="input mt-1" value={price.source} onChange={(e) => setPrice({ ...price, source: e.target.value })} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={price.verified} onChange={(e) => setPrice({ ...price, verified: e.target.checked })} />
          Bu fiyatı resmî/güncel kaynaktan kontrol ettim
        </label>
        <label className="block text-sm">Varsayılan bütçe (TL)
          <input className="input mt-1" type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
        </label>
        <button className="btn-primary" onClick={() => run(() => adminFetch("/api/settings", { method: "POST", json: { columnPrice: price, budget } }), "Ayarlar kaydedildi.")}>Kaydet</button>
        <p className="text-xs text-slate-500">Spor Toto'nun resmî sitesinde kolon fiyatı metin olarak yayımlanmadığı için otomatik doğrulanamaz. Bilinen son değer 10 TL (Bilyoner yardım sayfası, 24.03.2025).</p>
      </section>

      <section className="card space-y-3">
        <div className="card-title">Elle uzman tahmini ekle</div>
        <p className="text-xs text-slate-400">Kaynaksız görüş kabul edilmez. Bağlantı ve yayın tarihi zorunludur. Başka bir kaynaktan alıntıysa “kopyalandığı kaynak” alanını doldurun; bağımsız görüş sayılmaz.</p>
        <select className="input" value={ex.matchId} onChange={(e) => setEx({ ...ex, matchId: e.target.value })}>
          {props.matches.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <input className="input" placeholder="Kaynak adı (ör. Fanatik)" value={ex.sourceName} onChange={(e) => setEx({ ...ex, sourceName: e.target.value })} />
          <input className="input" placeholder="Yazar (opsiyonel)" value={ex.author} onChange={(e) => setEx({ ...ex, author: e.target.value })} />
        </div>
        <input className="input" placeholder="https://… (yazının bağlantısı)" value={ex.url} onChange={(e) => setEx({ ...ex, url: e.target.value })} />
        <div className="grid grid-cols-3 gap-2">
          <select className="input" value={ex.pick} onChange={(e) => setEx({ ...ex, pick: e.target.value })}>
            {ALL_PICKS.map((p) => <option key={p}>{p}</option>)}
          </select>
          <input className="input col-span-2" type="datetime-local" value={ex.publishedAt} onChange={(e) => setEx({ ...ex, publishedAt: e.target.value })} />
        </div>
        <input className="input" placeholder="Kopyalandığı kaynak (varsa)" value={ex.copiedFrom} onChange={(e) => setEx({ ...ex, copiedFrom: e.target.value })} />
        <button className="btn-primary" disabled={!ex.matchId} onClick={() => run(() => adminFetch("/api/experts", { method: "POST", json: { ...ex, author: ex.author || null, copiedFrom: ex.copiedFrom || null } }), "Tahmin eklendi; bir sonraki analizde hesaba katılır.")}>Ekle</button>
      </section>

      <section className="card space-y-3">
        <div className="card-title">Takım adı eşleştirme</div>
        <p className="text-xs text-slate-400">Resmî listedeki Türkçe adı uluslararası kaynaklardaki adla eşleştirin (ör. “Kızılyıldız” → “Crvena Zvezda”). Yanlış eşleşme yerine veri yok göstermek tercih edilir.</p>
        <div className="grid grid-cols-2 gap-2">
          <input className="input" placeholder="Listedeki ad" value={alias.alias} onChange={(e) => setAlias({ ...alias, alias: e.target.value })} />
          <input className="input" placeholder="Uluslararası ad" value={alias.canonical} onChange={(e) => setAlias({ ...alias, canonical: e.target.value })} />
        </div>
        <button className="btn-ghost" onClick={() => run(() => adminFetch("/api/aliases", { method: "POST", json: alias }), "Eşleştirme kaydedildi.")}>Kaydet</button>
        <ul className="max-h-40 overflow-y-auto text-xs text-slate-400">
          {props.aliases.map((a) => <li key={a.alias}>{a.alias} → {a.canonical}</li>)}
        </ul>
      </section>
    </div>
  );
}
