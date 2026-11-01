# Antigravity & Geliştirici Ajanları Anayasası (AGENTS.md)

Bu belge, bu kasada ve eklenti projelerinde (`cleverlines`, `clevermenu`, `vault-sync`) çalışan tüm yapay zeka ajanları ve geliştiriciler için bağlayıcı temel ilkeleri, mimari kuralları ve UI/UX standartlarını içerir. Gelecek tüm oturumlarda ajanlar bu kuralları koşulsuz takip eder.

---

## 1. Altın Kural: Yerleşik Özellik Önceliği (Native First)
> **"İstenen bir özellik Obsidian'ın yerleşik (native) yapısında zaten varsa, üstüne gereksiz kod yazılmaz. Yerleşik Obsidian API'sini ve native özelliklerini kullanmak; kod sağlığı, performans, kararlılık ve kullanıcı deneyimi açısından her zaman önceliklidir."**

- Obsidian'ın yerel sağladığı Markdown işleyicileri, Hotkey/Command altyapısı, Workspace/Leaf yönetimi, MetadataCache ve DOM API'leri varken tekerleği yeniden icat etme.
- Obsidian'ın yerleşik CSS değişkenlerini (`--text-normal`, `--text-muted`, `--background-modifier-border`, vb.) ve standart UI elementlerini (`Setting`, `Notice`, `Modal`, `SuggestModal`, `Menu`) öncelikle kullan.
- Kullanıcının standart Obsidian tema veya görünüm davranışını (örneğin tamamlanan görevlerin üstünün çizilmesi ve soluklaşması gibi native Markdown / CSS stillerini) bozacak agresif `!important` CSS ezmelerinden kaçın.

---

## 2. Mimari ve Eklenti Sorumluluk Ayrımı (Separation of Concerns)
Proje 3 temel ve bağımsız eklentiye ayrılmıştır. Sorumluluk sınırları kesinlikle korunmalıdır:

1. **`cleverlines`**:
   - Satır ve görev (todo) akıllı yönetimi: `#` etiketleri (`#bugün`, `#yarın`, `#tekrar`, `#süreç`, `#acil`, `#2dk`, `#dışarda`, `#evde`, `#<N>dk`, `#?` vb.).
   - Ağaç kilit (Tree-lock) hiyerarşisi ve blok bazlı öncelik sıralaması (`#acil` en üstte, `#2dk` en altta).
   - Tüm Görevler (Task Board / `dash-tasks`) paneli ve çift yönlü satır senkronizasyonu.
   - CodeMirror 6 Live Preview dekorasyonları ve Reading View render işleyicileri.
   - Görev geri sayım sayacı (`#<N>dk`, `#2dksonra`) ve alt durum çubuğu (status bar) entegrasyonu.
   - Kesinlikle bağlam menüsü (sağ tık) veya Git senkronizasyon mantığı barındırmaz.

2. **`clevermenu`**:
   - Sağ tık (context-menu) ve editör kısayolları.
   - Metin vurgulama döngüsü (Hiçbiri -> Yeşil -> Sarı -> Altı Çizili -> Hiçbiri).
   - Sayfa içi blok referansı oluşturucu (`^block-id` -> `[[#^id|seçilen_metin]]`).

3. **`vault-sync`**:
   - **NOT:** Kullanıcı resmi **Obsidian Sync** kullanmaktadır. Cihazlar arası anlık senkronizasyon yerleşik Obsidian Sync'e aittir.
   - `vault-sync` yalnızca masaüstünde istenirse opsiyonel, manuel GitHub yedeklemesi içindir; mobilde veya otomatik çalışarak Obsidian Sync ile yarış durumuna (race condition) girmemelidir.
   - Mobilde salt okunur kilidi, botbar (mobile toolbar) gizleme veya klavye engelleme kodları kesinlikle barındırılmaz; mobilde tam düzenleme serbesttir, sadece mobilden otomatik GitHub push yapılmaz.

---

## 3. Görev ve Etiket Tasarım Standartları (SSOT: `tag-registry.ts`)
Tüm görsel etiketler (`#tag`) `tag-registry.ts` dosyasındaki Single Source of Truth (SSOT) üzerinden yönetilir. Tasarım kuralları şunlardır:

### A. Todo Kutucuğu Renkleri (Checkbox)
- **`#acil`**: Checkbox kırmızıdır (`.is-urgent`), emoji **KULLANILMAZ**.
- **`#2dk`**: Checkbox açık sarıdır (`.is-twomin`), emoji **KULLANILMAZ** (etiket gizlenir, `⚡` gösterilmez).
- **`#acil` + `#2dk` (Combo)**: Checkbox kırmızıdan açık sarıya degrade renktedir (`.is-combo`).
- **`#kilitli`**: Satır doğal olarak soluklaşır (`.dash-drop-locked`), kilit emojisi **KULLANILMAZ**, etiket gizlenir (`dash-drop-hidden-tag`).

### B. Satır İçi Sıralama ve Optik Hizalama
- Görev onay kutusunun hemen sağında görsel sıralama katı bir öncelik kuralına göre dizilir:
  1. Sade emojiler (`🚗`, `🏠` vb.)
  2. Chipler (Deadline, Süreç, Soru, Tekrar, vb.)
- Inline chipler ve emojiler `inline-flex` ve `align-items: center` ile dikeyde piksel piksel optik olarak ortalanmalıdır.

### C. Chipler ve İkon Standartları
- **Chiplerin İçinde Asla Emoji Kullanılmaz**: Chiplerde sadece yerleşik React Lucide SVG ikonları kullanılır.
- **Deadline (`#deadline/YYYY-MM-DD`)**:
  - Lucide bayrak ikonu (`LUCIDE_FLAG_SVG`) + kalan gün sayısı: `3g`, `1g`, `0g`, `-2g`.
  - Her zaman kırmızı chip (`status-deadline-red`).
  - Kalan gün sayısı ≤ 3 olan görevlere otomatik `#acil` etiketi eklenir.
- **Süreç & Kontrol (`#süreç` / `#kontrol`)**:
  - Kontrol edilmediyse: Metin yok, sadece üstü çizik göz ikonu (`LUCIDE_EYE_OFF_SVG`).
  - Kontrol edildiyse: Açık göz ikonu (`LUCIDE_EYE_SVG`) + göreceli zaman (`14:30`, `dün`, `2g`, `3g`).
- **Soru Görevi (`#?`)**:
  - İkonsuz mavi chip (`?` kafi).
  - Parametresiz `#?` -> `? soru` yazısı; parametreli `#?ai` -> `? ai`.
- **Bugün (`#bugün`)**:
  - Güneş emojisi yerine soft açık sarı zeminli `Bugün` chip'i.
- **Tekrar Görevleri (`#tekrar` / `#rutin`)**:
  - Chip içinde ikonsuz sade metin olarak **`1. Tekrar`**, **`2. Tekrar`**, **`3. Tekrar`** şeklinde gösterilir.
  - CodeMirror 6 `createRepeatingTaskTransactionFilter` ile fare, `Ctrl+Enter` veya komutla görev tamamlandığında sayaç garanti olarak 1 artar (`#tekrar/1` -> `#tekrar/2`).
  - Gün devrinde (`checkDailyRollover`) tik kalkarken tekrar sayısı kesinlikle sıfırlanmaz.
- **Kronometre & Sayaç (`#<N>dk`, `#2dksonra`)**:
  - Lucide kronometre ikonu (`LUCIDE_TIMER_SVG`).
  - Obsidian kapatıldığında `localStorage`'da hafızasını korur, açıldığında `paused` bekler (otomatik başlamaz).
  - Ekranın altındaki durum çubuğunda (status bar) sadece simge ve süre (`⏱️ 02:00`) gösterilir; görev başlığı kalabalık yapmaz.

### D. Bullet ve Derin Girintili Görevler (Indent 2x+)
- Bullet (`-`) yazıldığında ekranda `Tab` / `Space` ipucu (ghost hint) gösterilmez. Satır başında `Tab` tuşuna basıldığında hızlıca `- [ ] ` todo oluşturulur.
- Satır 2x veya daha derin içerde olduğunda (`\t\t`, `    `), Markdown motoru satırı kod bloğu saysa bile Fallback Checkbox Widget ile tıklanabilir, canlı todo kutucuğu olarak render edilir ve normal fontta gösterilir.

### E. Dropdown (# Menü) Kategorizasyonu
- `#` ile açılan etiket tamamlama menüsü ayarlardan yönetilebilir:
  - Kategori Görünüm Modu: "Kategorili Menü" veya "Düz Liste".
  - "Günler" ve "Tür" alt menüleri isteğe göre açılıp kapatılabilir.
  - Özel etiketlerin her birinin kategorisi (`Kök`, `Tür`, `Günler`) ayarlar panelinden tek tıkla seçilebilir.

---

## 4. Tüm Görevler Paneli (Task Board) Standartları
- İstatistik haplarına (`⚠️ 7`, `☀️ 2`, `🔒 1` vb.) tıklandığında sadece o grup açılır ve listenin en başına odaklanır.
- Panel araç çubuğundaki tüm butonlar ("Tümünü Aç/Kapat", "Yenile") yazı içermez, sadece saf Lucide SVG ikonlarıdır.
- Görevler sürükle-bırak ile taşındığı için kartlar üzerindeki yukarı/aşağı ok butonları kaldırılmıştır.

---

## 5. Kod Kalitesi, Testler ve Dağıtım
- **Çekirdek İş Mantığı Bağımsızlığı**: `tag-registry.ts`, `dates.ts`, `lock-engine.ts`, `block-mover.ts` dosyaları Obsidian çalışma zamanına (`App`, `Workspace`) bağımlı olmadan saf TypeScript olarak kalmalıdır.
- **Birim Testler (Unit Tests)**: Test dosyalarında `import type` dışında çalışma zamanı `obsidian` sembolü import edilmemelidir. Yapılan her değişiklikten sonra `npm --prefix cleverlines test` çalıştırılmalı ve tüm testlerin eksiksiz geçtiğinden emin olunmalıdır.
- **Dağıtım**: Kasa üzerindeki değişiklikler `./deploy.sh` scripti ile derlenir ve `/home/mehmedbaykan/Homepage/VAULT` kopyasına dağıtılır.
