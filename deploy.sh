#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PLUGINS_DIR="/home/mehmedbaykan/Homepage/VAULT/.obsidian/plugins"
PLUGINS=(cleverlines clevermenu vault-sync)

echo "📦 Eklentiler derleniyor..."
for plugin in "${PLUGINS[@]}"; do
  (cd "$PROJECT_DIR/$plugin" && npm run compile)
done

echo "🚀 Kasaya kopyalanıyor..."
for plugin in "${PLUGINS[@]}"; do
  mkdir -p "$PLUGINS_DIR/$plugin"
  cp -f "$PROJECT_DIR/$plugin/main.js" "$PROJECT_DIR/$plugin/manifest.json" "$PROJECT_DIR/$plugin/styles.css" "$PLUGINS_DIR/$plugin/"
done

echo "✅ Üç eklenti kasaya kuruldu."
