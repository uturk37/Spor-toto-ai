import { prisma, getColumnPrice, getBudget } from "@/lib/db";
import { SOURCES } from "@/lib/sources/registry";
import { currentWeek } from "@/lib/pipeline";
import { SetupPanel } from "./SetupPanel";

export const dynamic = "force-dynamic";

const ENV_ROWS: Array<{ key: string; required: boolean; note: string }> = [
  { key: "DATABASE_URL", required: true, note: "PostgreSQL bağlantısı" },
  { key: "ADMIN_TOKEN", required: true, note: "Yenileme, kupon kaydı ve ayarlar için yönetici anahtarı (uzun rastgele bir değer)" },
  { key: "API_FOOTBALL_KEY", required: false, note: "Sakat/cezalı, ilk 11 — ücretsiz plan günde 100 istek" },
  { key: "API_FOOTBALL_DAILY_LIMIT", required: false, note: "Günlük istek sınırı (varsayılan 100)" },
  { key: "FOOTBALL_DATA_ORG_KEY", required: false, note: "Büyük ligler, ikili rekabet — ücretsiz" },
  { key: "ODDS_API_KEY", required: false, note: "Bahis oranları — ücretsiz plan ayda 500 istek" },
  { key: "ANTHROPIC_API_KEY", required: false, note: "Opsiyonel, ücretli: uzman yazılarından tahmin çıkarma" },
  { key: "EXPERT_ARTICLE_URLS", required: false, note: "Claude ile okunacak uzman yazısı bağlantıları (virgülle)" },
  { key: "EXPERT_FEEDS", required: false, note: "Ek tahmin bloğu RSS/Atom akışları (virgülle)" },
  { key: "DEFAULT_COLUMN_PRICE", required: false, note: "Ayar yapılmadıysa kullanılacak kolon fiyatı (varsayılan 10)" },
];

export default async function SetupPage() {
  const week = await currentWeek();
  const aliases = await prisma.teamAlias.findMany({ orderBy: { alias: "asc" } });
  const price = await getColumnPrice();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Kurulum</h1>
        <p className="text-sm text-slate-400">
          API anahtarları güvenlik için yalnızca sunucudaki <code>.env</code> dosyasında tutulur; bu ekran değerleri göstermez, sadece tanımlı olup olmadıklarını gösterir.
        </p>
      </div>
      <section className="card overflow-x-auto">
        <div className="card-title">Ortam değişkenleri (.env)</div>
        <table className="tbl min-w-[640px]">
          <thead><tr><th>Değişken</th><th>Durum</th><th>Açıklama</th></tr></thead>
          <tbody>
            {ENV_ROWS.map((r) => {
              const set = !!process.env[r.key];
              return (
                <tr key={r.key}>
                  <td className="font-mono text-xs">{r.key}</td>
                  <td>
                    {set ? <span className="badge bg-pitch-500/15 text-pitch-400">Tanımlı</span> : r.required ? <span className="badge bg-red-500/15 text-red-400">Eksik (zorunlu)</span> : <span className="badge bg-gold-400/15 text-gold-300">Eksik</span>}
                  </td>
                  <td className="text-xs text-slate-400">{r.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-3 text-xs text-slate-400">
          Eksik anahtarlar kaynakları devre dışı bırakır ama uygulamayı durdurmaz. Anahtar alma sayfaları:{" "}
          {SOURCES.filter((s) => s.envKey).map((s, i) => (
            <span key={s.id}>{i ? " · " : ""}<a className="link" href={s.homepage} target="_blank">{s.name}</a></span>
          ))}
        </div>
      </section>
      <SetupPanel
        matches={(week?.matches ?? []).map((m) => ({ id: m.id, label: `${m.order}. ${m.homeName} – ${m.awayName}` }))}
        aliases={aliases.map((a) => ({ alias: a.alias, canonical: a.canonical }))}
        price={{ value: price.value, verified: price.verified, source: price.source ?? "" }}
        budget={await getBudget()}
      />
    </div>
  );
}
