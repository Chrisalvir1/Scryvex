#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# Scryvex — Desinstalador completo
# Detiene todos los procesos, elimina el LaunchDaemon y
# opcionalmente borra los datos y el directorio del proyecto.
#
# Uso: sudo ./uninstall.sh
#      sudo ./uninstall.sh --keep-data   (mantiene /data y /logs)
# ─────────────────────────────────────────────────────────────────
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEEP_DATA=false
[[ "$*" == *"--keep-data"* ]] && KEEP_DATA=true

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
info() { echo -e "${BLUE}▶  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }

echo -e "${RED}"
echo "  ╔═════════════════════════════════════════╗"
echo "  ║  🗑️  Scryvex Uninstaller              ║"
echo "  ╚═════════════════════════════════════════╝"
echo -e "${NC}"

[ "$(id -u)" = "0" ] || { echo -e "${RED}❌ Ejecuta con sudo: sudo ./uninstall.sh${NC}"; exit 1; }

# ── 1. Detener y deshabilitar el LaunchDaemon ──────────────────────
PLIST="/Library/LaunchDaemons/com.scryvex.daemon.plist"
if [ -f "$PLIST" ]; then
  info "Deteniendo y desregistrando LaunchDaemon..."
  launchctl stop  com.scryvex.daemon 2>/dev/null || true
  launchctl unload -w "$PLIST"       2>/dev/null || true
  rm -f "$PLIST"
  ok "LaunchDaemon eliminado"
else
  warn "LaunchDaemon no estaba instalado (no se encontró el plist)"
fi

# ── 2. Matar todos los procesos en ejecución ────────────────────────
info "Matando procesos Scryvex..."
pkill -f "scryvex-server"   2>/dev/null && echo "   detenido: scryvex-server"   || true
pkill -f "cambridge-server" 2>/dev/null && echo "   detenido: cambridge-server" || true
pkill -f "go2rtc"           2>/dev/null && echo "   detenido: go2rtc"           || true
pkill -f "bridge.js"        2>/dev/null && echo "   detenido: matter-bridge"    || true
pkill -f "cambrige-scanner" 2>/dev/null && echo "   detenido: scanner-agent"   || true
sleep 1
ok "Todos los procesos detenidos"

# ── 3. Eliminar binarios compilados y descargados ───────────────────
info "Eliminando binarios..."
rm -f "$SCRIPT_DIR/build/scryvex-server"
rm -f "$SCRIPT_DIR/build/cambridge-server"
rm -f "$SCRIPT_DIR/bin/go2rtc"
rm -rf "$SCRIPT_DIR/matter-bridge/node_modules"
ok "Binarios eliminados"

# ── 4. Datos y logs (opcional) ───────────────────────────────────
if [ "$KEEP_DATA" = true ]; then
  warn "--keep- se mantienen $SCRIPT_DIR/data y $SCRIPT_DIR/logs"
else
  info "Eliminando datos y logs..."
  rm -rf "$SCRIPT_DIR/data"
  rm -rf "$SCRIPT_DIR/logs"
  ok "Datos y logs eliminados"
fi

# ── 5. Preguntar si también quiere borrar el directorio del proyecto ───
echo ""
echo -e "${YELLOW}⚠️  ¿Quieres eliminar también el directorio del proyecto?${NC}"
echo "   $SCRIPT_DIR"
echo ""
read -r -p "   Escribe 'si' para confirmar, cualquier otra cosa para omitir: " CONFIRM
if [ "$CONFIRM" = "si" ]; then
  info "Eliminando directorio del proyecto..."
  # Salir del directorio antes de borrarlo
  cd /tmp
  rm -rf "$SCRIPT_DIR"
  ok "Directorio eliminado"
else
  warn "Directorio del proyecto conservado en $SCRIPT_DIR"
fi

# ── Resumen ────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Scryvex desinstalado correctamente${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo "  No quedan procesos corriendo ni servicios registrados."
echo "  Homebrew, Node.js y Go no fueron modificados."
echo ""
