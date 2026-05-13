#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════╗
# ║     Scryvex Auto-Updater — verifica nuevas versiones     ║
# ║     Corre en segundo plano, actualiza sin interrumpir    ║
# ╚══════════════════════════════════════════════════════════╝
#
# Instalado como LaunchAgent en macOS — corre cada 6 horas
# Se activa solo cuando hay una nueva versión disponible
# No interrumpe el servicio: descarga en background y reinicia

set -euo pipefail

INSTALL_DIR="${SCRYVEX_DIR:-$HOME/.scryvex}"
BIN="$INSTALL_DIR/bin/scryvex"
VERSION_FILE="$INSTALL_DIR/.version"
LOG="$INSTALL_DIR/logs/updater.log"
REPO="Chrisalvir1/Scryvex"
API="https://api.github.com/repos/${REPO}/releases/latest"

mkdir -p "$INSTALL_DIR/logs"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"; }

# ── Detectar plataforma ───────────────────────────────────────────────────────
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$OS-$ARCH" in
  darwin-arm64)  BINARY="scryvex-macos-arm64" ;;
  darwin-x86_64) BINARY="scryvex-macos-x86_64" ;;
  linux-x86_64)  BINARY="scryvex-linux-amd64" ;;
  linux-aarch64) BINARY="scryvex-linux-arm64" ;;
  linux-armv7l)  BINARY="scryvex-linux-armv7" ;;
  *)             log "Plataforma desconocida: $OS-$ARCH"; exit 0 ;;
esac

# ── Versión actual ────────────────────────────────────────────────────────────
CURRENT=""
[ -f "$VERSION_FILE" ] && CURRENT=$(cat "$VERSION_FILE")

# ── Versión más reciente en GitHub ────────────────────────────────────────────
LATEST=$(curl -fsSL "$API" 2>/dev/null   | grep '"tag_name"'   | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/' || echo "")

[ -z "$LATEST" ] && { log "No se pudo consultar GitHub API"; exit 0; }

# ── ¿Hay actualización? ───────────────────────────────────────────────────────
if [ "$CURRENT" = "$LATEST" ]; then
  log "Scryvex $CURRENT está actualizado."
  exit 0
fi

log "Nueva versión disponible: $LATEST (actual: ${CURRENT:-ninguna})"
log "Descargando $BINARY..."

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${LATEST}/${BINARY}"
TMP_BIN="$INSTALL_DIR/bin/scryvex.new"

if ! curl -fsSL "$DOWNLOAD_URL" -o "$TMP_BIN"; then
  log "Error al descargar $DOWNLOAD_URL"
  rm -f "$TMP_BIN"
  exit 1
fi

chmod +x "$TMP_BIN"

# ── Reemplazar binario (atómico con mv) ───────────────────────────────────────
mv "$TMP_BIN" "$BIN"
echo "$LATEST" > "$VERSION_FILE"
log "✅ Actualizado a $LATEST"

# ── Reiniciar el servicio ─────────────────────────────────────────────────────
case "$OS" in
  darwin)
    launchctl kickstart -k "gui/$(id -u)/com.scryvex" 2>/dev/null || true
    log "✅ Servicio macOS reiniciado"
    ;;
  linux)
    systemctl --user restart scryvex 2>/dev/null || true
    log "✅ Servicio systemd reiniciado"
    ;;
esac

# Notificación macOS nativa
if [ "$OS" = "darwin" ]; then
  osascript -e "display notification \"Scryvex actualizado a $LATEST\" with title \"Scryvex\" subtitle \"Actualización automática\" sound name \"Glass\"" 2>/dev/null || true
fi

log "Actualización completa."
