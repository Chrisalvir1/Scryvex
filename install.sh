#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# Scryvex — Instalador nativo macOS
# Instala dependencias, compila y registra LaunchDaemon
# para que Scryvex arranque automáticamente sin necesidad
# de iniciar sesión en el Mac.
#
# Uso: sudo ./install.sh
# Para desinstalar: sudo ./uninstall.sh
# ─────────────────────────────────────────────────────────────────
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
info() { echo -e "${BLUE}▶  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
die()  { echo -e "${RED}❌ $1${NC}"; exit 1; }

echo -e "${BLUE}"
echo "  ╔═════════════════════════════════════════╗"
echo "  ║  🎥  Scryvex Installer v0.1.1          ║"
echo "  ║  Modo nativo macOS (sin Docker)     ║"
echo "  ╚═════════════════════════════════════════╝"
echo -e "${NC}"

# ── 0. Verificar macOS y permisos sudo ─────────────────────────────
[ "$(uname)" = "Darwin" ] || die "Este instalador es solo para macOS"
[ "$(id -u)" = "0" ]     || die "Ejecuta con sudo: sudo ./install.sh"

ARCH=$(uname -m)
REAL_USER=${SUDO_USER:-$USER}
HOME_DIR=$(eval echo ~"$REAL_USER")
info "Arquitectura: $ARCH | Usuario: $REAL_USER | Home: $HOME_DIR"

# ── 1. Homebrew ──────────────────────────────────────────────────
if ! sudo -u "$REAL_USER" command -v brew &>/dev/null; then
  info "Instalando Homebrew..."
  sudo -u "$REAL_USER" /bin/bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
# Asegurar que brew esté en PATH para los siguientes pasos
if [ -f "/opt/homebrew/bin/brew" ]; then
  export PATH="/opt/homebrew/bin:$PATH"
fi
ok "Homebrew disponible"

# ── 2. Node.js ────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  info "Instalando Node.js v20..."
  sudo -u "$REAL_USER" brew install node@20
  sudo -u "$REAL_USER" brew link node@20 --force --overwrite 2>/dev/null || true
  export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
fi
ok "Node.js $(node --version) disponible"

# ── 3. Go ────────────────────────────────────────────────────────────
if ! command -v go &>/dev/null; then
  info "Instalando Go..."
  sudo -u "$REAL_USER" brew install go
  export PATH="/opt/homebrew/opt/go/bin:$PATH"
fi
ok "Go $(go version | awk '{print $3}') disponible"

# ── 4. go2rtc nativo macOS ──────────────────────────────────────────
mkdir -p "$SCRIPT_DIR/bin"
GO2RTC_BIN="$SCRIPT_DIR/bin/go2rtc"
if [ ! -f "$GO2RTC_BIN" ]; then
  info "Descargando go2rtc..."
  if [ "$ARCH" = "arm64" ]; then
    GO2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_mac_arm64"
  else
    GO2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_mac_amd64"
  fi
  curl -fsSL "$GO2RTC_URL" -o "$GO2RTC_BIN"
  chmod +x "$GO2RTC_BIN"
fi
ok "go2rtc listo en bin/go2rtc"

# ── 5. Compilar scryvex-server ─────────────────────────────────────────
info "Compilando scryvex-server..."
mkdir -p "$SCRIPT_DIR/build"
cd "$SCRIPT_DIR"
sudo -u "$REAL_USER" go build -o build/scryvex-server ./cmd/server/
chmod +x build/scryvex-server
mkdir -p "$SCRIPT_DIR/build/ui"
cp -r "$SCRIPT_DIR/ui/src/"* "$SCRIPT_DIR/build/ui/" 2>/dev/null || true
ok "scryvex-server compilado y UI preparada"

# ── 6. Instalar dependencias matter-bridge ─────────────────────────
if [ -f "$SCRIPT_DIR/matter-bridge/package.json" ]; then
  info "Instalando dependencias matter-bridge..."
  cd "$SCRIPT_DIR/matter-bridge"
  sudo -u "$REAL_USER" npm install --omit=dev --silent
  cd "$SCRIPT_DIR"
  ok "matter-bridge listo"
fi

# ── 7. Crear directorios de datos y logs ──────────────────────────
mkdir -p \
  "$SCRIPT_DIR/logs" \
  "$SCRIPT_DIR/data/matter/certs" \
  "$SCRIPT_DIR/data/matter/fabrics" \
  "$SCRIPT_DIR/data/recordings"
chown -R "$REAL_USER" "$SCRIPT_DIR/logs" "$SCRIPT_DIR/data" "$SCRIPT_DIR/build" "$SCRIPT_DIR/bin"
ok "Directorios creados"

# ── 8. Registrar LaunchDaemon (arranque automático sin login) ────────
PLIST_NAME="com.scryvex.daemon"
PLIST_DEST="/Library/LaunchDaemons/${PLIST_NAME}.plist"
info "Instalando LaunchDaemon en $PLIST_DEST ..."

# Inyectar rutas reales al template
sed \
  -e "s|SCRYVEX_DIR|${SCRIPT_DIR}|g" \
  -e "s|HOME_DIR|${HOME_DIR}|g" \
  -e "s|REAL_USER|${REAL_USER}|g" \
  "$SCRIPT_DIR/packaging/com.scryvex.daemon.plist" > "$PLIST_DEST"

chmod 644 "$PLIST_DEST"
chown root:wheel "$PLIST_DEST"

# Recargar si ya existía una versión anterior
launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load -w "$PLIST_DEST"
ok "LaunchDaemon instalado y activo"

# ── Resumen final ───────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Scryvex instalado correctamente${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo "  UI:              http://localhost:1994"
echo "  Logs:            $SCRIPT_DIR/logs/"
echo ""
echo "  Scryvex ya está corriendo ahora mismo."
echo "  La próxima vez que enciendas el Mac arrancará automáticamente."
echo ""
echo "  Comandos útiles:"
echo "    sudo launchctl start com.scryvex.daemon   # arrancar manualmente"
echo "    sudo launchctl stop  com.scryvex.daemon   # detener manualmente"
echo "    sudo ./uninstall.sh                       # desinstalar todo"
echo ""
