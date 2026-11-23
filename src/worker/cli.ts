/** Elle çalıştırma: `npm run refresh` (liste + tüm analiz) veya `npm run grade` (sonuçlar + öğrenme). */
import { prisma } from "../lib/db";
import { analyzeWeek, refreshProgram, updateResults } from "../lib/pipeline";

async function main() {
  const cmd = process.argv[2];
  if (cmd === "refresh") {
    const r = await refreshProgram();
    console.log(`Program ${r.programNo} ${r.isNew ? "(yeni)" : "(mevcut)"}; analiz ediliyor...`);
    const n = await analyzeWeek(r.weekId, "manuel");
    console.log(`${n} maç analiz edildi.`);
  } else if (cmd === "grade") {
    await updateResults();
    console.log("Sonuçlar güncellendi ve model yeniden öğrendi.");
  } else {
    console.log("Kullanım: tsx src/worker/cli.ts refresh|grade");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
