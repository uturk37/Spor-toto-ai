import "./globals.css";
import type { Metadata, Viewport } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Spor Toto AI",
  description: "Gerçek verilerle Spor Toto maç analizi ve kupon optimizasyonu",
};
export const viewport: Viewport = { themeColor: "#05080f", width: "device-width", initialScale: 1 };

const NAV = [
  ["/", "Ana Panel"],
  ["/surpriz", "Sürpriz & Risk"],
  ["/kupon", "Kupon Oluşturucu"],
  ["/gecmis", "Geçmiş Başarı"],
  ["/kaynaklar", "Kaynaklar"],
  ["/kurulum", "Kurulum"],
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <header className="sticky top-0 z-20 border-b border-ink-700 bg-ink-950/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
            <Link href="/" className="flex shrink-0 items-center gap-2 font-bold">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-pitch-500 text-ink-950">ST</span>
              <span>Spor Toto <span className="text-gold-400">AI</span></span>
            </Link>
            <nav className="-mx-1 flex gap-1 overflow-x-auto text-sm">
              {NAV.map(([href, label]) => (
                <Link key={href} href={href} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-slate-300 hover:bg-ink-800 hover:text-white">
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-slate-500">
          Bu uygulama bilgi amaçlıdır; kazanç garantisi vermez. Spor Toto Teşkilat Başkanlığı ile bağı yoktur. 18 yaşından küçükler şans oyunlarına katılamaz.
        </footer>
      </body>
    </html>
  );
}
