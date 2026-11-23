import type { Level, SourceStatus } from "@/lib/types";

export function LevelBadge({ level, kind }: { level: Level | null | undefined; kind: "guven" | "risk" | "veri" }) {
  if (!level) return <span className="badge bg-ink-700 text-slate-400">—</span>;
  // Güven ve veri yeterliliğinde "Yüksek" iyidir; riskte kötüdür.
  const good = kind === "risk" ? level === "Düşük" : level === "Yüksek";
  const bad = kind === "risk" ? level === "Yüksek" : level === "Düşük";
  const cls = good ? "bg-pitch-500/15 text-pitch-400" : bad ? "bg-red-500/15 text-red-400" : "bg-gold-400/15 text-gold-300";
  const prefix = kind === "guven" ? "Güven" : kind === "risk" ? "Risk" : "Veri";
  return <span className={`badge ${cls}`}>{prefix}: {level}</span>;
}

export function ProbBar({ p1, pX, p2 }: { p1: number; pX: number; p2: number }) {
  return (
    <div className="min-w-[150px]">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-ink-700">
        <div className="bg-pitch-500" style={{ width: `${p1}%` }} />
        <div className="bg-gold-400" style={{ width: `${pX}%` }} />
        <div className="bg-sky-500" style={{ width: `${p2}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-slate-400">
        <span><b className="text-pitch-400">1</b> %{p1}</span>
        <span><b className="text-gold-300">X</b> %{pX}</span>
        <span><b className="text-sky-400">2</b> %{p2}</span>
      </div>
    </div>
  );
}

const STATUS: Record<SourceStatus, { t: string; c: string }> = {
  ok: { t: "Veri alındı", c: "bg-pitch-500/15 text-pitch-400" },
  empty: { t: "Veri yok", c: "bg-ink-700 text-slate-300" },
  error: { t: "Erişim hatası", c: "bg-red-500/15 text-red-400" },
  missing_key: { t: "API anahtarı eksik", c: "bg-gold-400/15 text-gold-300" },
  unavailable: { t: "Erişilemez", c: "bg-red-500/15 text-red-400" },
  not_applicable: { t: "Kapsam dışı", c: "bg-ink-700 text-slate-400" },
};

export function StatusBadge({ status }: { status: SourceStatus }) {
  const s = STATUS[status] ?? STATUS.error;
  return <span className={`badge ${s.c}`}>{s.t}</span>;
}

export function Stat({ label, value, hint, accent }: { label: string; value: React.ReactNode; hint?: React.ReactNode; accent?: "green" | "yellow" }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${accent === "yellow" ? "text-gold-400" : accent === "green" ? "text-pitch-400" : "text-slate-100"}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}
    </div>
  );
}

export function fmtDate(d: string | Date | null | undefined, withTime = true) {
  if (!d) return "—";
  return new Date(d).toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function fmtNum(v: number | null | undefined, digits = 2) {
  return v == null || Number.isNaN(v) ? "veri yok" : v.toFixed(digits);
}

export function fmtPct(v: number | null | undefined) {
  return v == null ? "veri yok" : `%${Math.round(v * 100)}`;
}

export function TL(v: number) {
  return v.toLocaleString("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 });
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-ink-600 p-4 text-sm text-slate-400">{children}</div>;
}
