# Eklenti sadeleştirme ve hata giderme planı

## Doğrulanmış bulgular

1. **Kritik — `vault-sync`:** Masaüstünde zamanlayıcı, boşta kalma ve kapanış sırasında otomatik Git push yapılıyor. Mobilde açılışta GitHub'dan dosya indirilip yerel dosyalar yazılıyor veya siliniyor. Bu davranışlar Obsidian Sync ile yarışabilir ve AGENTS.md sınırlarına aykırıdır. Git komutları ayrıca ayarları kabuk komutuna gömüyor.
2. **Yüksek — `cleverlines`:** Görev panosu notunda `dash-tasks` bloğu yoksa `ensureAggregatorNoteContent` tüm notu blokla değiştiriyor. `isAggregatorFile` sadece dosya adına baktığı için aynı adlı başka klasördeki notları da pano sanabiliyor.
   Ayrıca `tasks` kod bloğu işlemcisi tüm kasada kaydedildiği için başka eklentilerin `tasks` bloklarını da yakalayabiliyor.
3. **Yüksek — `deploy.sh`:** Derlemeden sonra bu projeye ait olmayan dört eklenti klasörünü koşulsuz siliyor.
4. **Orta — `clevermenu`:** Video sağ tıklarını küresel olarak yakalıyor ve webview içine PiP kodu enjekte ediyor. Bu, eklentinin tanımlı iki editör işlevi dışına taşıyor ve yerel menü davranışını bozabiliyor.
5. **Orta — `cleverlines`:** Tamamlanan görevler için `body` sınıfı ve geniş `!important` CSS kuralları temanın yerleşik görünümünü eziyor.

## Uygulama sırası

1. `vault-sync` eklentisini masaüstünde yalnızca kullanıcı komutu veya düğmesiyle çalışan manuel GitHub yedeğine indir. Mobil kodunu, otomatik tetikleyicileri ve kullanılmayan ayarları kaldır. Git'i kabuksuz argümanlarla çalıştır; eski token bilgisini ayar kaydından temizle.
2. Pano notunu mevcut metni koruyarak güncelle; pano yolu eşlemesini tam yol üzerinden yap. Eski `tasks` bloğunu yalnızca pano notunda `dash-tasks` bloğuna taşı ve genel `tasks` işlemcisini kaldır. Bu davranışlar için saf TypeScript testleri ekle.
3. Dağıtım betiğini yalnızca üç kendi eklentisini derleyip kopyalayacak şekilde sadeleştir; başka eklentileri silme.
4. `clevermenu` içindeki PiP enjeksiyonunu ve küresel video sağ tık dinleyicisini kaldır.
5. Temanın tamamlanmış görev görünümünü kullan; global `body` sınıfını ve CSS ezmelerini kaldır.
6. `npm --prefix cleverlines test`, üç eklentinin derlemesi ve güvenli dağıtım akışıyla doğrula.

## Sınır

Obsidian içindeki canlı etkileşimler bu çalışma ortamında otomatik uçtan uca test edilemiyor; derleme ve saf iş mantığı testleri doğrulanacak.

## Sonuç

- [x] Manuel masaüstü Git yedeği; mobil ve otomatik Git işlemleri kaldırıldı. Git komutları kabuksuz çalışıyor ve başarısız push sonrasında kalan commit sonraki denemede gönderiliyor.
- [x] Pano notu korunuyor, tam yol eşlemesi kullanılıyor ve eski `tasks` bloğu yalnızca pano notunda `dash-tasks` olarak taşınıyor.
- [x] `deploy.sh` sadece üç proje eklentisini kopyalıyor; başka eklenti klasörlerine dokunmuyor.
- [x] `clevermenu` içindeki küresel PiP işlemleri ve `cleverlines` içindeki tamamlanmış görevlere yönelik global tema ezmeleri kaldırıldı.
- [x] `cleverlines`: 37 test geçti. `vault-sync`: geçici yerel Git depolarıyla 3 test geçti. Üç eklenti derlendi, `deploy.sh` çalıştı ve dağıtılan dosyalar kaynak derlemelerle karşılaştırıldı.

## UI sadeleştirme ve erişilebilirlik aşaması

- [x] Pano kontrolleri gerçek düğmelere ve Obsidian'ın yerleşik Lucide ikonlarına taşındı; klavye odağı ve erişilebilir adlar eklendi.
- [x] Görev başlığındaki ham etiketler gizlendi; düzenleme sırasında etiketlerin ve özgün büyük/küçük harflerinin korunması sağlandı.
- [x] `#?` ve `#?[metin]` görevleri panoda doğru ayrıştırılıp soru grubuna alındı.
- [x] İstatistik düğmeleri yalnızca ilgili grubu açıyor, grubu en üste taşıyor ve odağı grup başlığına getiriyor.
- [x] Checkbox sonrasında bağlam emojileri, ardından chipler gelecek şekilde tek görsel sıra kuruldu; özel `#acil`, `#2dk`, `#kilitli` emojileri kaldırıldı.
- [x] `lockFutureTasks` ayarı editör, okuma görünümü ve görev panosunda gerçekten uygulanıyor; ağaç kilidi bağımsız çalışmaya devam ediyor.
- [x] Mobil pano yerleşimi, boş durumları, arama ve yenileme geri bildirimi sadeleştirildi.
- [x] Görev kartlarına sürükleme tutamacı eklendi; aynı nottaki eş öncelikli görev blokları alt görevleri koparmadan taşınıyor.
- [x] Tekrar görevi açıklamaları sayaç davranışıyla eşleştirildi: gün devrinde tik kalkar, sayaç korunur.
