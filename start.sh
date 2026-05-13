#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# CamBridge — Script de inicio
# Arranca el Scanner Agent nativo y Docker al mismo tiempo.
# Uso: ./start.sh
# ─────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$SCRIPT_DIR/scanner-agent"

# Detectar arquitectura
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  BINARY="$AGENT_DIR/cambrige-scanner-arm64"
else
  BINARY="$AGENT_DIR/cambrige-scanner-amd64"
fi

# Parar agente previo si estaba corriendo
pkill -f "cambrige-scanner" 2>/dev/null || true
sleep 1

echo "🔍 Iniciando Scanner Agent (nativo macOS) en el puerto 9876..."
chmod +x "$BINARY"
"$BINARY" &
AGENT_PID=$!
echo "   PID del agente: $AGENT_PID"

# Esperar a que arranque
sleep 2
if curl -sf http://localhost:9876/health > /dev/null; then
  echo "✅ Scanner Agent activo"
else
  echo "⚠️  Scanner Agent no respondió — el escáner interno de Docker se usará como fallback"
fi

echo ""
echo "🐳 Iniciando CamBridge Docker..."
cd "$SCRIPT_DIR"
docker-compose up -d

echo ""
echo "✅ CamBridge listo en: http://localhost:8080"
echo ""
echo "Para parar todo: ./stop.sh"
