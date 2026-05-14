#!/bin/bash
# CamBridge — Entrypoint: arranca todos los servicios
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[cambrige] ✅ $1${NC}"; }
info() { echo -e "${BLUE}[cambrige] ▶  $1${NC}"; }
warn() { echo -e "${YELLOW}[cambrige] ⚠️  $1${NC}"; }

echo -e "${BLUE}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║  🎥 CamBridge v0.1.0                     ║"
echo "  ║  Camera Matter Bridge                    ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"

# ── Variables con defaults ────────────────────────────────────────────────
: "${PORT:=8080}"
: "${MATTER_PORT:=5580}"
: "${AI_ENABLED:=true}"

# Config go2rtc
G2RTC_CONFIG="${G2RTC_CONFIG:-/app/configs/go2rtc.yaml}"
if [ ! -f "$G2RTC_CONFIG" ]; then
    warn "go2rtc.yaml no encontrado, usando config mínima"
    mkdir -p "$(dirname "$G2RTC_CONFIG")"
    cat > "$G2RTC_CONFIG" << YAML
api:
  listen: ":1984"
rtsp:
  listen: ":8554"
webrtc:
  listen: ":8555"
YAML
fi

# ── 1. go2rtc ─────────────────────────────────────────────────────────────
if command -v go2rtc &>/dev/null; then
    info "Iniciando go2rtc..."
    go2rtc -config "$G2RTC_CONFIG" >> /logs/go2rtc.log 2>&1 &
    G2RTC_PID=$!
    sleep 2
    if kill -0 $G2RTC_PID 2>/dev/null; then
        ok "go2rtc PID=$G2RTC_PID"
    else
        warn "go2rtc no arrancó (revisar /logs/go2rtc.log)"
    fi
else
    warn "go2rtc no instalado — streams RTSP desactivados"
fi

# ── 2. Matter Bridge (Node.js) ────────────────────────────────────────────
if [ -f /app/matter-bridge/bridge.js ]; then
    info "Iniciando matter-bridge..."
    node /app/matter-bridge/bridge.js \
        --port "$MATTER_PORT" \
        --data-dir /data/matter \
        --api-url "http://localhost:$PORT" \
        >> /logs/matter-bridge.log 2>&1 &
    MATTER_PID=$!
    sleep 3
    if kill -0 $MATTER_PID 2>/dev/null; then
        ok "matter-bridge PID=$MATTER_PID (UDP :$MATTER_PORT)"
    else
        warn "matter-bridge no arrancó — ver /logs/matter-bridge.log"
    fi
else
    warn "matter-bridge/bridge.js no encontrado"
fi

# ── 3. AI Engine (Python) ─────────────────────────────────────────────────
if [ "$AI_ENABLED" = "true" ] && command -v python3 &>/dev/null; then
    if [ -f /app/ai_engine/detector.py ]; then
        info "Iniciando AI Engine..."
        python3 /app/ai_engine/detector.py \
            --config /app/configs/cambrige.yaml \
            --api-url "http://localhost:$PORT" \
            --gpu "${GPU_DEVICE:-auto}" \
            >> /logs/ai-engine.log 2>&1 &
        AI_PID=$!
        sleep 2
        if kill -0 $AI_PID 2>/dev/null; then
            ok "AI Engine PID=$AI_PID"
        else
            warn "AI Engine no arrancó — ver /logs/ai-engine.log"
        fi
    fi
else
    info "AI Engine desactivado (AI_ENABLED=$AI_ENABLED)"
fi

# ── 4. CamBridge Go API (proceso principal — blocking) ───────────────────
info "Iniciando API Server en :$PORT..."
ok "UI disponible en http://localhost:$PORT"
echo ""
exec cambrige-server \
    --config /app/configs/cambrige.yaml \
    --data   /data \
    --port   "$PORT"
