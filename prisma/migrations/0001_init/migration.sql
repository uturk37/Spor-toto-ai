-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Week" (
    "id" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "programNo" INTEGER NOT NULL,
    "closesAt" TIMESTAMP(3),
    "sourceUrl" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Week_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "homeName" TEXT NOT NULL,
    "awayName" TEXT NOT NULL,
    "kickoff" TIMESTAMP(3) NOT NULL,
    "competition" TEXT,
    "result" TEXT,
    "score" TEXT,
    "resultSource" TEXT,
    "resultAt" TIMESTAMP(3),

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceFetch" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataAsOf" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "error" TEXT,
    "matchId" TEXT,
    "payload" JSONB,

    CONSTRAINT "SourceFetch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "matchId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "evidence" JSONB NOT NULL,
    "decision" JSONB NOT NULL,
    "riskFlags" JSONB NOT NULL,
    "weights" JSONB NOT NULL,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("matchId")
);

-- CreateTable
CREATE TABLE "PredictionSnapshot" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "weekId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stage" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,

    CONSTRAINT "PredictionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeNotice" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ChangeNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpertPick" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "author" TEXT,
    "url" TEXT NOT NULL,
    "pick" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "originKey" TEXT NOT NULL,
    "enteredBy" TEXT NOT NULL DEFAULT 'otomatik',

    CONSTRAINT "ExpertPick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsItem" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "teams" TEXT[],
    "kind" TEXT NOT NULL,

    CONSTRAINT "NewsItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "picks" JSONB NOT NULL,
    "columns" INTEGER NOT NULL,
    "columnPrice" DECIMAL(10,2) NOT NULL,
    "cost" DECIMAL(12,2) NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'otomatik',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "TeamAlias" (
    "alias" TEXT NOT NULL,
    "canonical" TEXT NOT NULL,
    "clubElo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamAlias_pkey" PRIMARY KEY ("alias")
);

-- CreateTable
CREATE TABLE "ModelWeights" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weights" JSONB NOT NULL,
    "samples" JSONB NOT NULL,
    "avgLoss" JSONB NOT NULL,

    CONSTRAINT "ModelWeights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'calisiyor',
    "detail" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Week_season_programNo_key" ON "Week"("season", "programNo");

-- CreateIndex
CREATE UNIQUE INDEX "Match_weekId_order_key" ON "Match"("weekId", "order");

-- CreateIndex
CREATE INDEX "SourceFetch_matchId_sourceId_idx" ON "SourceFetch"("matchId", "sourceId");

-- CreateIndex
CREATE INDEX "SourceFetch_sourceId_fetchedAt_idx" ON "SourceFetch"("sourceId", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PredictionSnapshot_seq_key" ON "PredictionSnapshot"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "PredictionSnapshot_hash_key" ON "PredictionSnapshot"("hash");

-- CreateIndex
CREATE INDEX "PredictionSnapshot_matchId_createdAt_idx" ON "PredictionSnapshot"("matchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExpertPick_matchId_url_sourceName_key" ON "ExpertPick"("matchId", "url", "sourceName");

-- CreateIndex
CREATE UNIQUE INDEX "NewsItem_url_key" ON "NewsItem"("url");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceFetch" ADD CONSTRAINT "SourceFetch_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictionSnapshot" ADD CONSTRAINT "PredictionSnapshot_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictionSnapshot" ADD CONSTRAINT "PredictionSnapshot_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeNotice" ADD CONSTRAINT "ChangeNotice_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertPick" ADD CONSTRAINT "ExpertPick_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================
-- Değiştirilemez tahmin kaydı: güncelleme ve silme yasak,
-- maç başladıktan sonra yeni tahmin eklenemez.
-- ============================================================
CREATE OR REPLACE FUNCTION prediction_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PredictionSnapshot kayıtları değiştirilemez veya silinemez';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prediction_snapshot_no_update
  BEFORE UPDATE OR DELETE ON "PredictionSnapshot"
  FOR EACH ROW EXECUTE FUNCTION prediction_snapshot_immutable();

CREATE OR REPLACE FUNCTION prediction_snapshot_before_kickoff() RETURNS trigger AS $$
DECLARE k timestamp(3);
BEGIN
  -- Geriye dönük kayıt engeli: zaman damgası sunucu saatinden en fazla 2 dakika sapabilir.
  IF abs(extract(epoch FROM (NEW."createdAt" - (now() AT TIME ZONE 'UTC')))) > 120 THEN
    RAISE EXCEPTION 'Tahmin zaman damgası sunucu saatiyle uyuşmuyor (geriye dönük kayıt engellendi)';
  END IF;
  SELECT "kickoff" INTO k FROM "Match" WHERE "id" = NEW."matchId";
  IF k IS NOT NULL AND NEW."createdAt" >= k THEN
    RAISE EXCEPTION 'Maç başladıktan sonra tahmin kaydı eklenemez';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prediction_snapshot_kickoff_guard
  BEFORE INSERT ON "PredictionSnapshot"
  FOR EACH ROW EXECUTE FUNCTION prediction_snapshot_before_kickoff();

CREATE TRIGGER prediction_snapshot_no_truncate
  BEFORE TRUNCATE ON "PredictionSnapshot"
  FOR EACH STATEMENT EXECUTE FUNCTION prediction_snapshot_immutable();
