# Obsidian Plugins

Obsidian için geliştirilen üç bağımsız eklentinin kaynak kodları:

- **cleverlines:** Görevler, etiketler, sayaçlar ve görev paneli.
- **clevermenu:** Editör sağ tık menüsü, vurgulama ve blok referansları.
- **vault-sync:** Masaüstünde isteğe bağlı, manuel GitHub yedeklemesi. Cihazlar arası senkronizasyon Obsidian Sync'e aittir.

## Geliştirme

Her eklentinin bağımlılıklarını kendi klasöründe kurun ve derleyin:

```bash
npm --prefix cleverlines ci
npm --prefix clevermenu ci
npm --prefix vault-sync ci
npm --prefix cleverlines run compile
npm --prefix clevermenu run compile
npm --prefix vault-sync run compile
```

Testler:

```bash
npm --prefix cleverlines test
npm --prefix vault-sync test
```

## Yerel dağıtım

`./deploy.sh` üç eklentiyi derler ve `main.js`, `manifest.json`, `styles.css`
dosyalarını `/home/mehmedbaykan/Homepage/VAULT/.obsidian/plugins` altına kopyalar.
Başka bir bilgisayarda kullanmadan önce scriptteki `PLUGINS_DIR` yolunu düzenleyin.

Bağımlılıklar, derlenmiş `main.js` dosyaları ve yerel ayarlar Git'e dahil edilmez.
Geliştirme kuralları için [AGENTS.md](AGENTS.md) dosyasına bakın.
