/**
 * Zamanlanmış görevler. Ayrı bir süreç olarak çalışır: `npm run worker`.
 *  - Her 30 dk: resmî listeyi kontrol et (yeni program → tüm maçları analiz et)
 *  - Her 10 dk: maçlardan 24s / 3s / 1s önce yeniden hesapla
 *  - Her 20 dk: sakatlık/kadro haberleri (yeni haber → maçı yeniden hesapla, değişikliği bildir)
 *  - Her saat: biten maçların sonuçlarını al, başarıyı ölç, model ağırlıklarını yeniden öğren
 */
import cron from "node-cron";
import { fixtureJob, newsJob, resultsJob, windowJob } from "./jobs";

let busy = false;
async function exclusive(name: string, fn: () => Promise<unknown>) {
  if (busy) {
    console.log(`[${new Date().toISOString()}] ${name} atlandı (başka görev çalışıyor)`);
    return;
  }
  busy = true;
  try {
    console.log(`[${new Date().toISOString()}] ${name} başladı`);
    await fn();
  } finally {
    busy = false;
  }
}

cron.schedule("*/30 * * * *", () => exclusive("fikstür", fixtureJob));
cron.schedule("*/10 * * * *", () => exclusive("zaman pencereleri", windowJob));
cron.schedule("5-59/20 * * * *", () => exclusive("haberler", newsJob));
cron.schedule("15 * * * *", () => exclusive("sonuçlar", resultsJob));

console.log("Spor Toto AI zamanlayıcı çalışıyor.");
void exclusive("ilk fikstür kontrolü", fixtureJob);
