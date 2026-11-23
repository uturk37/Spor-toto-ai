# Spor Toto AI – Akıllı Maç Analiz ve Kupon Sistemi

Her hafta resmî Spor Toto listesindeki 15 maçı gerçek kaynaklardan toplanan verilerle analiz eden, üç motorlu
(istatistik, piyasa, uzman) olasılık modeli kuran, bütçeye göre matematiksel olarak optimize edilmiş kupon hazırlayan
ve tahminlerini değiştirilemez biçimde kaydedip gerçek sonuçlarla karşılaştıran Next.js uygulaması.

> Uygulama veri uydurmaz. Bir kaynaktan veri alınamazsa “veri yok”, “API anahtarı eksik”, “erişim hatası” veya
> “erişilemez” olarak gösterilir. İstatistik veya piyasa verisi olmayan maçta tahmin üretilmez, uyarı verilir.

## Hızlı kurulum

```bash
# 1) PostgreSQL (Docker ile) — ya da kendi PostgreSQL 14+ sunucunuz
docker compose up -d db

# 2) Bağımlılıklar ve ortam değişkenleri
npm install
cp .env.example .env        # DATABASE_URL ve ADMIN_TOKEN zorunlu, diğer anahtarlar opsiyonel

# 3) Veritabanı tabloları ve tetikleyiciler
npm run db:migrate

# 4) İlk veri çekimi (resmî liste + 15 maç analizi)
npm run refresh

# 5) Uygulama ve zamanlayıcı (iki ayrı terminal / süreç)
npm run build && npm start   # http://localhost:3000
npm run worker               # zamanlanmış güncellemeler
```

Node.js 20+ gerekir. Uygulama sunucusunun aşağıdaki sitelere internet erişimi olmalıdır.

## Modüller

| Modül | Dosya | Açıklama |
|---|---|---|
| Ana panel | `src/app/page.tsx` | Güncel program, 15 maç, analiz/kaynak sayısı, en güçlü tahminler, riskli maçlar, kuponlar, geçmiş başarı, değişiklik bildirimleri |
| Maç detayı | `src/app/mac/[id]` | Olasılıklar, motor karşılaştırma grafiği, gerekçe, form (son 5/10, iç saha/deplasman, rakip gücüne göre), xG, şut, korner, ilk yarı, 2,5 üst/KG, dinlenme, istikrar, ikili rekabet, sakat/cezalı, ilk 11, haberler, uzman tahminleri, kaynak tablosu, değiştirilemez kayıtlar |
| Sürpriz & risk | `src/app/surpriz` | Favori ama kaybedebilir, beraberlik, sürpriz galibiyet, uzman–AI çelişkisi, yüksek belirsizlik, veri yetersiz |
| Kupon oluşturucu | `src/app/kupon` | Tekli/çifte/üçlü seçimi, kilitleme, ekonomik/dengeli/geniş, 100/250/500/1.000 TL, elle kolon hesabı, kaydet/düzenle |
| Geçmiş | `src/app/gecmis` | Haftalık/sezonluk başarı, tekli/çifte/üçlü, 15/15, AI vs uzman, zincir doğrulama, öğrenilen ağırlıklar |
| Kaynaklar | `src/app/kaynaklar` | Kaynak kataloğu, erişim türü, anahtar durumu, son 7 gün çekim sonuçları |
| Kurulum | `src/app/kurulum` | .env durumu (değerler gösterilmez), yenileme, kolon fiyatı, bütçe, elle uzman tahmini, takım adı eşleştirme |

### Veri kaynakları

| Kaynak | Erişim | Kullanım |
|---|---|---|
| sportoto.gov.tr | Ücretsiz | Resmî 15 maçlık program, kapanış, sonuçlar |
| ClubElo | Ücretsiz | Elo güç puanı, maç olasılıkları (kulüpler) |
| Football-Data.co.uk | Ücretsiz | 16 Avrupa ligi (Süper Lig dahil) sonuç, şut, korner, ilk yarı, ikili rekabet, bahis oranları |
| ESPN | Ücretsiz (belgelenmemiş) | Fikstür, takım maç geçmişi, milli maçlar, skor |
| Understat | Ücretsiz | xG/xGA (5 büyük lig + RFPL) |
| BBC Sport, Sky Sports | Ücretsiz RSS | Sakatlık/kadro haberleri |
| Tahmin blogları | Ücretsiz RSS/Atom | Uzman tahminleri (yazar/bağlantı ile) |
| API-Football | Ücretsiz anahtar | Sakat/cezalı, resmî 11, sonuç |
| football-data.org | Ücretsiz anahtar | Büyük turnuvalar, ikili rekabet, sonuç |
| The Odds API | Ücretsiz anahtar | Bahis şirketi oranları |
| Anthropic Claude | Ücretli (opsiyonel) | Uzman yazılarından alıntı doğrulamalı tahmin çıkarma |
| SofaScore, Flashscore, FotMob, Transfermarkt, Mackolik, Soccerway, WorldFootball.net, Opta, WhoScored | **Erişilemez** | Açık resmî API yok, kullanım şartları otomatik çekmeye izin vermiyor |

Gerçekçi beklenti: büyük lig maçlarında tüm anahtarlarla maç başına 8–11 kaynak; milli maç ve alt liglerde daha az.
Her maçta gerçek kaynak sayısı gösterilir.

### Tahmin motorları (`src/lib/model`)

- **İstatistik motoru:** ClubElo Elo farkı + ClubElo maç olasılıkları + Dixon-Coles düzeltmeli Poisson gol modeli
  (iç saha/dış saha gol ve varsa xG; az örnek lig ortalamasına büzülür). Kaynağın “düzenli ilk 11” dediği kesin eksikler
  sınırlı bir düzeltme uygular.
- **Piyasa motoru:** Bahis şirketi oranlarından marjı ayıklanmış olasılıkların ortalaması.
- **Uzman motoru:** Bağımsız görüşler sayılır; aynı yazar/köken (`originKey`) tek görüştür. En az 2 bağımsız görüş gerekir.
- **AI karar motoru:** Motorların ağırlıklı logaritmik havuzlaması. Yüzdeler en büyük kalan yöntemiyle her zaman toplam 100.
  **Güven** (kaynak sayısı, motor uyumu, örneklem) ile **risk** (olasılık dağılımının belirsizliği) ayrı hesaplanır;
  ikisi de kazanma olasılığı değildir. **Veri yeterliliği** Yüksek/Orta/Düşük.
- **Öğrenme:** Biten maçlarda her motorun log-kaybı ölçülür, ağırlıklar exp(−4·kayıp) ile güncellenir ve az örnekte
  varsayılana büzülür (n/(n+30)).

### Kupon matematiği (`src/lib/coupon`)

- Kolon = 2^(çifte) × 3^(üçlü), bedel = kolon × kolon fiyatı, kupon başına en fazla 2.500 kolon.
- Optimizasyon, bütçe ve kolon sınırı içinde 15 maçın tamamını tutturma olasılığını (Π kapsama) en yükseğe çıkaran
  tercihleri **dinamik programlama ile kesin** bulur (testte kaba kuvvetle doğrulanır). Kilitli tercihler korunur.
- Ekonomik ≤ bütçenin %10'u, dengeli ≤ %40, geniş = bütçenin tamamı. Bütçe asla aşılmaz.
- Kolon fiyatı resmî sitede metin olarak yayımlanmadığı için otomatik doğrulanamaz. Varsayılan 10 TL “doğrulanmamış”
  etiketiyle gelir (kaynak: Bilyoner yardım sayfası, 24.03.2025); Kurulum ekranından onaylanabilir/değiştirilebilir.

### Değiştirilemez tahmin kaydı

`PredictionSnapshot` tablosunda PostgreSQL tetikleyicileri **UPDATE, DELETE ve TRUNCATE**'i reddeder; maç başladıktan sonra
ve sunucu saatinden 2 dakikadan fazla sapan (geriye dönük) zaman damgalı kayıt eklenemez. Ayrıca kayıtlar SHA-256 ile
zincirlenir; Geçmiş sayfası zinciri baştan doğrular.

### Zamanlanmış güncellemeler (`npm run worker`)

| Sıklık | Görev |
|---|---|
| 30 dk | Resmî liste; yeni program açıklandıysa 15 maçı analiz et (aşama: fikstür) |
| 10 dk | Maçlardan 24 saat, 3 saat ve 1 saat önce yeniden hesapla (her pencere bir kez) |
| 20 dk | Sakatlık/kadro haberleri; yeni haber varsa maçı yeniden hesapla |
| Saatlik | Biten maçların sonuçları, başarı ölçümü, model ağırlıklarını yeniden öğrenme |

Her yeniden hesaplamada önceki kayıtla karşılaştırılır; ana tahmin değişirse veya bir olasılık 5 puandan fazla
oynarsa “Tahmin değişiklik bildirimi” oluşturulur.

## Testler

```bash
npm test                                   # birim testleri (DB tetikleyici testi yalnızca TEST_DATABASE_URL ile, ayrı veritabanında çalışır)
createdb spor_toto_e2e && DATABASE_URL=postgresql://…/spor_toto_e2e npm run db:migrate
E2E_DATABASE_URL=postgresql://…/spor_toto_e2e npm run test:e2e   # uçtan uca hat (sahte ağ yanıtlarıyla)
```

Kapsam: kolon/maliyet hesabı, optimizasyonun kaba kuvvetle doğrulanması, bütçe/2.500 kolon sınırı, olasılıkların toplamı,
Poisson/Elo/oran dönüşümleri, uzman kopya tespiti, risk etiketleri, öğrenme, haftalık değerlendirme, hash zinciri,
veritabanı tetikleyicileri, resmî liste/CSV/RSS/Atom/Understat ayrıştırıcıları ve uçtan uca hat.

## Bilinen sınırlar

- Muhtemel ilk 11 ve teknik direktör değişikliği için bağlı kaynaklarda yapılandırılmış veri yok; gösterilmez.
  Resmî 11 (API-Football) maçtan ~20–40 dk önce gelir.
- Topla oynama yüzdesi bağlı ücretsiz kaynaklarda yok; “veri yok” görünür.
- ESPN uç noktası belgelenmemiştir, değişebilir. Resmî liste sayfasının yapısı değişirse ayrıştırıcı hata verir (uydurmaz).
- Türkçe takım adları sözlük + bulanık eşleştirme ile uluslararası adlara çevrilir; eşleşmeyenler Kurulum'dan eklenir.
- Uygulama bilgi amaçlıdır, kazanç garantisi vermez. 18 yaş altı şans oyunlarına katılamaz.
