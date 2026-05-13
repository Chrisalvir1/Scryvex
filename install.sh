#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# Scryvex — Instalador nativo macOS
# Instala dependencias + registra LaunchDaemon (arranque sin login)
# Uso: sudo ./install.sh
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
echo "  ║   🎥 Scryvex Installer v0.1.1        ║"
echo "  ║   Modo nativo macOS (sin Docker)  ║"
echo "  ╚═════════════════════════════════════════╝"
echo -e "${NC}"

# ─────────────────────────────────────────────────────────────────
# 0. Verificar que es macOS
[ "$(uname)" = "Darwin" ] || die "Este instalador es solo para macOS"

ARCH=$(uname -m)
HOME_DIR=$(eval echo ~${SUDO_USER:-$USER})
info "Arquitectura: $ARCH | Usuario: ${SUDO_USER:-$USER} | Home: $HOME_DIR"

# ─────────────────────────────────────────────────────────────────
# 1. Homebrew
if ! command -v brew &>/dev/null; then
  info "Instalando Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
ok "Homebrew disponible"

# ─────────────────────────────────────────────────────────────────
# 2. Node.js (para matter-bridge)
if ! command -v node &>/dev/null; then
  info "Instalando Node.js v20..."
  brew install node@20
  brew link node@20 --force --overwrite
fi
ok "Node.js $(node --version) disponible"

# ─────────────────────────────────────────────────────────────────
# 3. Go (para compilar el servidor)
if ! command -v go &>/dev/null; then
  info "Instalando Go..."
  brew install go
fi
ok "Go $(go version | awk '{print $3}') disponible"

# ─────────────────────────────────────────────────────────────────
# 4. Descargar go2rtc nativo macOS
mkdir -p "$SCRIPT_DIR/bin"
GO2RTC_BIN="$SCRIPT_DIR/bin/go2rtc"
if [ ! -f "$GO2RTC_BIN" ]; then
  info "Descargando go2rtc..."
  if [ "$ARCH" = "arm64" ]; then
    GO2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_mac_arm64"
  else
    GO2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_mac_amd64"
  fi
  curl -L "$GO2RTC_URL" -o "$GO2RTC_BIN"
  chmod +x "$GO2RTC_BIN"
fi
ok "go2rtc listo en bin/go2rtc"

# ─────────────────────────────────────────────────────────────────
# 5. Compilar scryvex-server
info "Compilando scryvex-server..."
cd "$SCRIPT_DIR"
go build -o build/scryvex-server ./cmd/server/
chmod +x build/scryvex-server
ok "scryvex-server compilado"

# ─────────────────────────────────────────────────────────────────
# 6. Instalar dependencias matter-bridge
if [ -f "$SCRIPT_DIR/matter-bridge/package.json" ]; then
  info "Instalando dependencias matter-bridge..."
  cd "$SCRIPT_DIR/matter-bridge"
  npm install --omit=dev --silent
  ok "matter-bridge dependencias instaladas"
fi
cd "$SCRIPT_DIR"

# ─────────────────────────────────────────────────────────────────
# 7. Registrar LaunchDaemon (arranque sin login)
PLIST_NAME="com.scryvex.daemon"
PLIST_DEST="/Library/LaunchDaemons/${PLIST_NAME}.plist"

info "Registrando LaunchDaemon en $PLIST_DEST ..."

# Rellenar rutas reales en el plist
sed \
  -e "s|SCRYVEX_DIR|${SCRIPT_DIR}|g" \
  -e "s|HOME_DIR|${HOME_DIR}|g" \
  "$SCRIPT_DIR/packaging/com.scryvex.daemon.plist" > "$PLIST_DEST"

chmod 644 "$PLIST_DEST"
chown root:wheel "$PLIST_DEST"

# Descargar el daemon anterior si ya estaba cargado
launchctl unload "$PLIST_DEST" 2>/dev/null || true
# Cargar y arrancar ahora mismo
launchctl load -w "$PLIST_DEST"
ok "LaunchDaemon registrado y activo"

# ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Scryvex instalado como daemon del sistema${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo "  Arrancar ahora:   sudo launchctl start com.scryvex.daemon"
echo "  Detener ahora:    sudo launchctl stop  com.scryvex.daemon"
echo "  Ver logs:         tail -f $SCRIPT_DIR/logs/daemon.log"
echo "  UI:               http://localhost:1994"
echo ""
echo "  Al reiniciar el Mac, Scryvex arranca automáticamente"
echo "  SIN necesidad de iniciar sesión."
echo ""
