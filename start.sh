#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# Scryvex — Inicio 100% nativo (sin Docker)
# Arranca: go2rtc → matter-bridge → scryvex-server → scanner-agent
# ─────────────────────────────────────────────────────────────────
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
DATA_DIR="$SCRIPT_DIR/data"
CONFIG="$SCRIPT_DIR/configs/scryvex.yaml"
GO2RTC_CONFIG="$SCRIPT_DIR/configs/go2rtc.yaml"
PORT=${PORT:-1994}

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
info() { echo -e "${BLUE}▶  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }

mkdir -p "$LOG_DIR" "$DATA_DIR/matter/certs" "$DATA_DIR/matter/fabrics" "$DATA_DIR/recordings"
if ! touch "$LOG_DIR/.write-test" 2>/dev/null; then
  LOG_DIR="$DATA_DIR/logs"
  mkdir -p "$LOG_DIR"
  warn "logs/ no es escribible; usando $LOG_DIR"
else
  rm -f "$LOG_DIR/.write-test"
fi

echo -e "${BLUE}"
echo "  ╔═════════════════════════════════════════╗"
echo "  ║  🎥  Scryvex v1.0.0                       ║"
echo "  ║  Modo: 100% nativo macOS              ║"
echo "  ╚═════════════════════════════════════════╝"
echo -e "${NC}"

# Matar procesos previos limpiamente
pkill -f "go2rtc"          2>/dev/null || true
pkill -f "bridge.js"       2>/dev/null || true
pkill -f "scryvex-server"  2>/dev/null || true
pkill -f "scryvex-scanner" 2>/dev/null || true
sleep 1

# ── 1. go2rtc ──────────────────────────────────────────────────────────────
GO2RTC_BIN="$SCRIPT_DIR/bin/go2rtc"
if [ ! -s "$GO2RTC_BIN" ] || grep -q "Not Found" "$GO2RTC_BIN" 2>/dev/null; then
  warn "go2rtc no encontrado o inválido en bin/ — ejecuta ./install.sh para descargarlo"
else
  chmod +x "$GO2RTC_BIN" 2>/dev/null || true
  info "Iniciando go2rtc..."
  "$GO2RTC_BIN" -config "$GO2RTC_CONFIG" >> "$LOG_DIR/go2rtc.log" 2>&1 &
  sleep 1
  if pgrep -f "go2rtc" > /dev/null; then
    ok "go2rtc corriendo :1984 (API) :8554 (RTSP) :8555 (WebRTC)"
  else
    warn "go2rtc no arrancó — revisa $LOG_DIR/go2rtc.log"
  fi
fi

# ── 2. Matter Bridge (Node.js) ─────────────────────────────────────────────
if command -v node &>/dev/null; then
  if [ -f "$SCRIPT_DIR/matter-bridge/bridge.js" ]; then
    if [ ! -d "$SCRIPT_DIR/matter-bridge/node_modules" ]; then
      info "Instalando dependencias matter-bridge..."
      cd "$SCRIPT_DIR/matter-bridge" && npm install --omit=dev --silent
      cd "$SCRIPT_DIR"
    fi
    info "Iniciando matter-bridge..."
    node "$SCRIPT_DIR/matter-bridge/bridge.js" \
      --port 5580 \
      --data-dir "$DATA_DIR/matter" \
      --api-url "http://localhost:$PORT" \
      >> "$LOG_DIR/matter-bridge.log" 2>&1 &
    sleep 2
    if pgrep -f "bridge.js" > /dev/null; then
      ok "matter-bridge corriendo :7878"
    else
      warn "matter-bridge no arrancó — revisa $LOG_DIR/matter-bridge.log"
    fi
  fi
else
  warn "Node.js no instalado — matter-bridge desactivado"
fi

# ── 3. Scanner Agent ───────────────────────────────────────────────────────
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  SCANNER_BIN="$SCRIPT_DIR/scanner-agent/scryvex-scanner-arm64"
else
  SCANNER_BIN="$SCRIPT_DIR/scanner-agent/scryvex-scanner-amd64"
fi
if [ -f "$SCANNER_BIN" ]; then
  info "Iniciando Scanner Agent..."
  chmod +x "$SCANNER_BIN"
  "$SCANNER_BIN" >> "$LOG_DIR/scanner.log" 2>&1 &
  sleep 1
  if pgrep -f "scryvex-scanner" > /dev/null; then
    ok "Scanner Agent corriendo :9876"
  else
    warn "Scanner Agent no arrancó"
  fi
fi

# ── 4. Scryvex Server (Go) ─────────────────────────────────────────────────
info "Iniciando Scryvex Server..."
"$SCRIPT_DIR/build/scryvex-server" \
  --config "$CONFIG" \
  --data   "$DATA_DIR" \
  --port   "$PORT" \
  --ui     "$SCRIPT_DIR/build/ui" \
  >> "$LOG_DIR/scryvex.log" 2>&1 &
sleep 2
if pgrep -f "scryvex-server" > /dev/null; then
  ok "Scryvex Server corriendo :$PORT"
else
  echo -e "${RED}❌ Scryvex Server no arrancó — revisa $LOG_DIR/scryvex.log${NC}"
  tail -20 "$LOG_DIR/scryvex.log"
  exit 1
fi

echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  🎥 Scryvex listo en http://localhost:$PORT${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo "  Logs:     $LOG_DIR/"
echo "  Parar:    ./stop.sh"
