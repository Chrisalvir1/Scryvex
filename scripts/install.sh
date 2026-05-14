#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════╗
# ║           Scryvex — Instalador Universal v0.1            ║
# ║   macOS (Apple Silicon + Intel) · Linux · Raspberry Pi  ║
# ╚══════════════════════════════════════════════════════════╝
# Uso:
#   curl -fsSL https://raw.githubusercontent.com/Chrisalvir1/Scryvex/main/scripts/install.sh | bash
#
# O con opciones:
#   curl -fsSL .../install.sh | bash -s -- --dir ~/.scryvex --no-service

set -euo pipefail

# ── Colores ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'
BLU='\033[0;34m'; CYN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# ── Configuración ─────────────────────────────────────────────────────────────
REPO="Chrisalvir1/Scryvex"
GITHUB_API="https://api.github.com/repos/${REPO}/releases/latest"
GITHUB_RAW="https://raw.githubusercontent.com/${REPO}/main"
INSTALL_DIR="${SCRYVEX_DIR:-$HOME/.scryvex}"
BIN_DIR="$INSTALL_DIR/bin"
DATA_DIR="$INSTALL_DIR/data"
CONFIG_DIR="$INSTALL_DIR/configs"
LOG_DIR="$INSTALL_DIR/logs"
INSTALL_SERVICE=true
OPEN_BROWSER=true

# ── Args ──────────────────────────────────────────────────────────────────────
for arg in "$@"; do
  case $arg in
    --dir=*)    INSTALL_DIR="${arg#*=}" ;;
    --no-service) INSTALL_SERVICE=false ;;
    --no-browser) OPEN_BROWSER=false ;;
    --version=*) FORCE_VERSION="${arg#*=}" ;;
  esac
done

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYN}${BOLD}"
echo "  ███████╗ ██████╗██████╗ ██╗   ██╗██╗   ██╗███████╗██╗  ██╗"
echo "  ██╔════╝██╔════╝██╔══██╗╚██╗ ██╔╝██║   ██║██╔════╝╚██╗██╔╝"
echo "  ███████╗██║     ██████╔╝ ╚████╔╝ ██║   ██║█████╗   ╚███╔╝ "
echo "  ╚════██║██║     ██╔══██╗  ╚██╔╝  ╚██╗ ██╔╝██╔══╝   ██╔██╗ "
echo "  ███████║╚██████╗██║  ██║   ██║    ╚████╔╝ ███████╗██╔╝ ██╗"
echo "  ╚══════╝ ╚═════╝╚═╝  ╚═╝   ╚═╝     ╚═══╝  ╚══════╝╚═╝  ╚═╝"
echo -e "${NC}"
echo -e "${BOLD}  Instalador de Scryvex v1.0.0 — Estabilidad Total${NC}"
echo -e "  ${BLU}https://github.com/${REPO}${NC}"
echo ""

# ── Detectar plataforma ───────────────────────────────────────────────────────
detect_platform() {
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)

  case "$OS" in
    darwin)
      case "$ARCH" in
        arm64)  PLATFORM="macos-arm64"   ; PLATFORM_NAME="macOS Apple Silicon" ;;
        x86_64) PLATFORM="macos-x86_64"  ; PLATFORM_NAME="macOS Intel" ;;
        *)      die "Arquitectura macOS no soportada: $ARCH" ;;
      esac
      ;;
    linux)
      case "$ARCH" in
        x86_64)  PLATFORM="linux-amd64"  ; PLATFORM_NAME="Linux x86_64" ;;
        aarch64) PLATFORM="linux-arm64"  ; PLATFORM_NAME="Linux ARM64" ;;
        armv7l)  PLATFORM="linux-armv7"  ; PLATFORM_NAME="Raspberry Pi / Linux ARMv7" ;;
        *)       die "Arquitectura Linux no soportada: $ARCH" ;;
      esac
      ;;
    msys*|cygwin*|mingw*)
      PLATFORM="windows-amd64.exe"
      PLATFORM_NAME="Windows x86_64"
      ;;
    *)
      die "Sistema operativo no soportado: $OS"
      ;;
  esac

  echo -e "  ${GRN}✓${NC} Plataforma detectada: ${BOLD}${PLATFORM_NAME}${NC}"
}

# ── Helpers ───────────────────────────────────────────────────────────────────
die() { echo -e "${RED}✗ Error: $1${NC}" >&2; exit 1; }
info() { echo -e "  ${BLU}→${NC} $1"; }
ok() { echo -e "  ${GRN}✓${NC} $1"; }
warn() { echo -e "  ${YEL}⚠${NC}  $1"; }

check_deps() {
  for cmd in curl; do
    command -v "$cmd" >/dev/null 2>&1 || die "Necesito '$cmd' instalado para continuar."
  done
}

# ── Obtener versión latest ────────────────────────────────────────────────────
get_version() {
  # Forzar versión 1.0.0 para ignorar releases antiguos de GitHub
  VERSION="v1.0.0"
  ok "Versión: ${BOLD}${VERSION}${NC}"
}

# ── Descargar binario ─────────────────────────────────────────────────────────
download_binary() {
  BINARY_NAME="scryvex-${PLATFORM}"
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${BINARY_NAME}"

  mkdir -p "$BIN_DIR" "$DATA_DIR" "$CONFIG_DIR" "$LOG_DIR"

  info "Descargando Scryvex para ${PLATFORM_NAME}..."
  if curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$BIN_DIR/scryvex.tmp" 2>/dev/null; then
    mv "$BIN_DIR/scryvex.tmp" "$BIN_DIR/scryvex"
    chmod +x "$BIN_DIR/scryvex"
    ok "Binario instalado en ${BIN_DIR}/scryvex"
    
    info "Descargando interfaz gráfica..."
    mkdir -p "$INSTALL_DIR/build/ui"
    curl -fsSL "${GITHUB_RAW}/ui/src/index.html" -o "$INSTALL_DIR/build/ui/index.html" 2>/dev/null || true
    curl -fsSL "${GITHUB_RAW}/ui/src/style.css"  -o "$INSTALL_DIR/build/ui/style.css" 2>/dev/null || true
    curl -fsSL "${GITHUB_RAW}/ui/src/app.js"     -o "$INSTALL_DIR/build/ui/app.js" 2>/dev/null || true
    ok "Interfaz gráfica lista"
  else
    rm -f "$BIN_DIR/scryvex.tmp"
    info "Binario precompilado no disponible — compilando desde fuente..."
    build_from_source
  fi
}

# ── Compilar desde fuente (fallback) ─────────────────────────────────────────
build_from_source() {
  command -v go >/dev/null 2>&1 || die "Go no está instalado. Instálalo desde https://go.dev/dl/ e intenta de nuevo."
  info "Compilando con Go $(go version | awk '{print $3}')... (esto toma ~30 segundos)"

  TMP=$(mktemp -d)
  trap "rm -rf $TMP" EXIT

  # Intentar clonar, si falla descargar tar
  if ! git clone --depth=1 --quiet "https://github.com/${REPO}.git" "$TMP/scryvex" 2>/dev/null; then
    curl -fsSL "https://github.com/${REPO}/archive/main.tar.gz" | tar -xz -C "$TMP"
    mv "$TMP"/Scryvex-main "$TMP/scryvex" 2>/dev/null || mv "$TMP"/scryvex-main "$TMP/scryvex"
  fi

  cd "$TMP/scryvex"
  go build \
    -ldflags="-s -w -X main.version=${VERSION} -X main.buildDate=$(date -u +%Y%m%d)" \
    -o "$BIN_DIR/scryvex" \
    ./cmd/server

  chmod +x "$BIN_DIR/scryvex"
  
  mkdir -p "$INSTALL_DIR/build/ui"
  cp -r "$TMP/scryvex/ui/src/"* "$INSTALL_DIR/build/ui/" 2>/dev/null || true
  
  ok "Compilado exitosamente desde fuente"
  cd - > /dev/null
}

# ── go2rtc (motor de streams) ─────────────────────────────────────────────────
install_go2rtc() {
  G2RTC_DIR="$BIN_DIR"
  G2RTC_BIN="$G2RTC_DIR/go2rtc"

  if [ -f "$G2RTC_BIN" ]; then
    ok "go2rtc ya instalado"
    return
  fi

  info "Descargando go2rtc (motor de streams)..."

  G2RTC_IS_ZIP=false
  case "$PLATFORM" in
    macos-arm64)   G2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_mac_arm64.zip"   ; G2RTC_IS_ZIP=true ;;
    macos-x86_64)  G2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_mac_amd64.zip"   ; G2RTC_IS_ZIP=true ;;
    linux-amd64)   G2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_amd64" ;;
    linux-arm64)   G2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_arm64" ;;
    linux-armv7)   G2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_arm" ;;
    windows*)      G2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_win64.zip"       ; G2RTC_IS_ZIP=true ;;
  esac

  if [ "$G2RTC_IS_ZIP" = true ]; then
    TMP_ZIP="$(mktemp /tmp/go2rtc_XXXXXX.zip)"
    curl -fsSL --progress-bar -L "$G2RTC_URL" -o "$TMP_ZIP"
    unzip -o -j "$TMP_ZIP" 'go2rtc' -d "$G2RTC_DIR" 2>/dev/null || \
      unzip -o -j "$TMP_ZIP" '*/go2rtc' -d "$G2RTC_DIR"
    rm -f "$TMP_ZIP"
  else
    curl -fsSL --progress-bar -L "$G2RTC_URL" -o "$G2RTC_BIN"
  fi
  chmod +x "$G2RTC_BIN"
  ok "go2rtc instalado"
}

# ── Matter Bridge (Node.js embebido) ─────────────────────────────────────────
install_matter_bridge() {
  BRIDGE_DIR="$INSTALL_DIR/matter-bridge"
  mkdir -p "$BRIDGE_DIR"

  info "Instalando Matter Bridge..."
  curl -fsSL "${GITHUB_RAW}/matter-bridge/bridge.js"     -o "$BRIDGE_DIR/bridge.js"
  curl -fsSL "${GITHUB_RAW}/matter-bridge/package.json"  -o "$BRIDGE_DIR/package.json"

  if command -v node >/dev/null 2>&1; then
    NODE_VER=$(node --version | tr -d 'v' | cut -d. -f1)
    if [ "$NODE_VER" -ge 18 ]; then
      ok "Node.js $(node --version) disponible"
      return
    fi
  fi

  warn "Node.js 18+ no encontrado. Intentando instalar..."
  install_nodejs
}

install_nodejs() {
  case "$OS" in
    darwin)
      if command -v brew >/dev/null 2>&1; then
        brew install node >/dev/null 2>&1 && ok "Node.js instalado via Homebrew"
      else
        warn "Instala Node.js 18+ manualmente desde https://nodejs.org"
      fi
      ;;
    linux)
      if command -v apt-get >/dev/null 2>&1; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
        apt-get install -y nodejs >/dev/null 2>&1 && ok "Node.js instalado"
      elif command -v dnf >/dev/null 2>&1; then
        dnf install -y nodejs >/dev/null 2>&1 && ok "Node.js instalado"
      else
        warn "Instala Node.js 18+ manualmente desde https://nodejs.org"
      fi
      ;;
  esac
}

# ── Config por defecto ────────────────────────────────────────────────────────
install_config() {
  if [ -f "$CONFIG_DIR/scryvex.yaml" ]; then
    ok "Configuración existente conservada"
    return
  fi

  info "Descargando configuración por defecto..."
  curl -fsSL "${GITHUB_RAW}/configs/scryvex.yaml" -o "$CONFIG_DIR/scryvex.yaml" 2>/dev/null || \
  cat > "$CONFIG_DIR/scryvex.yaml" << 'YAML'
# Scryvex — Configuración
server:
  port: 1994
  data_dir: ~/.scryvex/data
  log_level: info

matter:
  enabled: true
  port: 5580

vicohome:
  enabled: false
  email: ""
  password: ""
  region: "us"
  poll_interval: 30s

homeassistant:
  enabled: false
  mqtt_broker: ""
  mqtt_port: 1883
YAML
  ok "Configuración creada en $CONFIG_DIR/scryvex.yaml"
}

# ── Script de inicio ──────────────────────────────────────────────────────────
create_launcher() {
  cat > "$BIN_DIR/scryvex-start" << LAUNCHER
#!/usr/bin/env bash
# Lanzador de Scryvex — arranca todos los procesos
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR}"
BIN="\${INSTALL_DIR}/bin"
DATA="\${INSTALL_DIR}/data"
LOGS="\${INSTALL_DIR}/logs"
CFG="\${INSTALL_DIR}/configs/scryvex.yaml"
PIDS="\${INSTALL_DIR}/.pids"

mkdir -p "\$DATA/matter/certs" "\$DATA/snapshots" "\$DATA/recordings" "\$LOGS"
rm -f "\$PIDS"

cleanup() {
  echo "Deteniendo Scryvex..."
  [ -f "\$PIDS" ] && while read pid; do kill "\$pid" 2>/dev/null || true; done < "\$PIDS"
  rm -f "\$PIDS"
}
trap cleanup EXIT INT TERM

echo "🎥  Iniciando Scryvex..."

# 1. go2rtc
if [ -f "\$BIN/go2rtc" ]; then
  "\$BIN/go2rtc" -config "\${INSTALL_DIR}/configs/go2rtc.yaml" >> "\$LOGS/go2rtc.log" 2>&1 &
  echo \$! >> "\$PIDS"
  echo "  ✓ go2rtc       → :1984"
fi

# 2. Matter Bridge
if command -v node >/dev/null 2>&1 && [ -f "\${INSTALL_DIR}/matter-bridge/bridge.js" ]; then
  node "\${INSTALL_DIR}/matter-bridge/bridge.js" \
    --port 7878 \
    --dataDir "\$DATA/matter" \
    >> "\$LOGS/matter-bridge.log" 2>&1 &
  echo \$! >> "\$PIDS"
  echo "  ✓ Matter Bridge → :7878"
fi

# 3. Scryvex main
sleep 1
"\$BIN/scryvex" \
  --config "\$CFG" \
  --data   "\$DATA" \
  --port   1994 \
  2>&1 | tee -a "\$LOGS/scryvex.log" &
echo \$! >> "\$PIDS"

echo ""
echo "  ✅ Scryvex corriendo en http://localhost:1994"
echo "  📋 Logs en: \$LOGS/"
echo "  🛑 Ctrl+C para detener"
echo ""

wait
LAUNCHER
  chmod +x "$BIN_DIR/scryvex-start"
  ok "Lanzador creado"
}

# ── Servicio del sistema (autostart) ─────────────────────────────────────────
install_system_service() {
  $INSTALL_SERVICE || return

  case "$OS" in
    darwin)
      PLIST="$HOME/Library/LaunchAgents/com.scryvex.plist"
      cat > "$PLIST" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>com.scryvex</string>
  <key>ProgramArguments</key>
  <array>
    <string>${BIN_DIR}/scryvex-start</string>
  </array>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <true/>
  <key>StandardOutPath</key>   <string>${LOG_DIR}/scryvex.log</string>
  <key>StandardErrorPath</key> <string>${LOG_DIR}/scryvex-error.log</string>
  <key>WorkingDirectory</key>  <string>${INSTALL_DIR}</string>
</dict>
</plist>
PLIST
      launchctl load "$PLIST" 2>/dev/null || true
      ok "Servicio macOS LaunchAgent instalado (arranca con el login)"
      ;;

    linux)
      if command -v systemctl >/dev/null 2>&1; then
        SERVICE_FILE=""
        if [ "$EUID" -eq 0 ]; then
          SERVICE_FILE="/etc/systemd/system/scryvex.service"
          USER_DIRECTIVE="User=$(logname 2>/dev/null || echo $USER)"
        else
          mkdir -p "$HOME/.config/systemd/user"
          SERVICE_FILE="$HOME/.config/systemd/user/scryvex.service"
          USER_DIRECTIVE=""
        fi

        cat > "$SERVICE_FILE" << SYSTEMD
[Unit]
Description=Scryvex — Camera Bridge
After=network-online.target
Wants=network-online.target

[Service]
${USER_DIRECTIVE}
ExecStart=${BIN_DIR}/scryvex-start
Restart=on-failure
RestartSec=5
StandardOutput=append:${LOG_DIR}/scryvex.log
StandardError=append:${LOG_DIR}/scryvex-error.log
WorkingDirectory=${INSTALL_DIR}

[Install]
WantedBy=default.target
SYSTEMD

        if [ "$EUID" -eq 0 ]; then
          systemctl daemon-reload
          systemctl enable --now scryvex
          ok "Servicio systemd instalado (inicio automático con el sistema)"
        else
          systemctl --user daemon-reload
          systemctl --user enable --now scryvex
          ok "Servicio systemd de usuario instalado"
        fi
      fi
      ;;
  esac
}

# ── Auto-updater ──────────────────────────────────────────────────────────────
install_auto_updater() {
  curl -fsSL "${GITHUB_RAW}/scripts/auto_update.sh" -o "$BIN_DIR/scryvex-update" 2>/dev/null || true
  chmod +x "$BIN_DIR/scryvex-update" 2>/dev/null || true

  case "$OS" in
    darwin)
      cat > "$HOME/Library/LaunchAgents/com.scryvex.updater.plist" << UPLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>com.scryvex.updater</string>
  <key>ProgramArguments</key>
  <array><string>${BIN_DIR}/scryvex-update</string></array>
  <key>StartInterval</key>     <integer>21600</integer>
  <key>RunAtLoad</key>         <true/>
  <key>StandardOutPath</key>   <string>${LOG_DIR}/updater.log</string>
  <key>StandardErrorPath</key> <string>${LOG_DIR}/updater-error.log</string>
</dict>
</plist>
UPLIST
      launchctl load "$HOME/Library/LaunchAgents/com.scryvex.updater.plist" 2>/dev/null || true
      ok "Auto-updater instalado (verifica nuevas versiones cada 6 horas)"
      ;;
    linux)
      mkdir -p "$HOME/.config/systemd/user"
      cat > "$HOME/.config/systemd/user/scryvex-updater.service" << SYSDSVC
[Unit]
Description=Scryvex Auto-Updater
[Service]
Type=oneshot
ExecStart=${BIN_DIR}/scryvex-update
StandardOutput=append:${LOG_DIR}/updater.log
SYSDSVC
      cat > "$HOME/.config/systemd/user/scryvex-updater.timer" << SYSDTMR
[Unit]
Description=Scryvex Auto-Updater Timer
[Timer]
OnBootSec=5min
OnUnitActiveSec=6h
Persistent=true
[Install]
WantedBy=timers.target
SYSDTMR
      systemctl --user daemon-reload 2>/dev/null || true
      systemctl --user enable --now scryvex-updater.timer 2>/dev/null || true
      ok "Auto-updater instalado (systemd timer cada 6 horas)"
      ;;
  esac
}

# ── Agregar al PATH ───────────────────────────────────────────────────────────
add_to_path() {
  SHELL_RC=""
  case "${SHELL:-bash}" in
    */zsh)  SHELL_RC="$HOME/.zshrc" ;;
    */bash) SHELL_RC="$HOME/.bashrc" ;;
    */fish) SHELL_RC="$HOME/.config/fish/config.fish" ;;
  esac

  PATH_LINE="export PATH=\"\$PATH:${BIN_DIR}\""
  [ -n "$SHELL_RC" ] && ! grep -q "$BIN_DIR" "$SHELL_RC" 2>/dev/null && {
    echo "" >> "$SHELL_RC"
    echo "# Scryvex" >> "$SHELL_RC"
    echo "$PATH_LINE" >> "$SHELL_RC"
    ok "PATH actualizado en $SHELL_RC"
  }
}

# ── go2rtc config ─────────────────────────────────────────────────────────────
install_go2rtc_config() {
  cat > "$CONFIG_DIR/go2rtc.yaml" << 'YAML'
api:
  listen: :1984
  origin: "*"
rtsp:
  listen: :8554
webrtc:
  listen: :8555/tcp
streams: {}
log:
  level: warn
YAML
}

# ── Resumen final ─────────────────────────────────────────────────────────────
print_summary() {
  echo ""
  echo -e "${GRN}${BOLD}╔══════════════════════════════════════════╗"
  echo -e "║   ✅  Scryvex instalado correctamente   ║"
  echo -e "╚══════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${BOLD}Instalado en:${NC}  $INSTALL_DIR"
  echo -e "  ${BOLD}Versión:${NC}       $VERSION"
  echo -e "  ${BOLD}Plataforma:${NC}    $PLATFORM_NAME"
  echo ""
  echo -e "  ${BOLD}Para iniciar:${NC}"
  echo -e "  ${CYN}  $BIN_DIR/scryvex-start${NC}   # iniciar todos los servicios"
  echo -e "  ${CYN}  scryvex --help${NC}           # ver opciones"
  echo ""
  echo -e "  ${BOLD}Configuración:${NC}"
  echo -e "  ${CYN}  $CONFIG_DIR/scryvex.yaml${NC}"
  echo ""
  echo -e "  ${BOLD}UI Web:${NC} ${BLU}http://localhost:1994${NC}"
  echo ""
  if $INSTALL_SERVICE; then
    echo -e "  ${GRN}✓${NC} Scryvex se iniciará automáticamente con tu sistema"
    echo -e "  ${GRN}✓${NC} Se actualizará automáticamente en segundo plano (cada 6h)"
    echo ""
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  echo -e "  Instalando en: ${BOLD}${INSTALL_DIR}${NC}"
  echo ""

  check_deps
  detect_platform
  get_version
  echo ""

  info "Instalando componentes..."
  download_binary
  install_go2rtc
  install_matter_bridge
  install_config
  install_go2rtc_config
  create_launcher
  add_to_path
  install_auto_updater
  install_system_service

  echo ""
  print_summary

  echo -e "  ${YEL}Iniciando Scryvex...${NC}"
  exec "$BIN_DIR/scryvex-start"
}

main "$@"
