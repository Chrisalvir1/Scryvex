#!/bin/bash
# CamBridge — Instalador Raspberry Pi OS (arm64)
# Probado en: Raspberry Pi 4/5 con Raspberry Pi OS Bookworm 64-bit
set -euo pipefail

INSTALL_DIR="/opt/scryvex"
COMPOSE_FILE="docker-compose.rpi.yml"
COMPOSE_URL="https://raw.githubusercontent.com/Chrisalvir1/Scryvex/main/$COMPOSE_FILE"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

ok()   { echo -e "${GREEN}✅ $1${NC}"; }
info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
step() { echo -e "\n${BLUE}▶ $1${NC}"; }

echo -e "${GREEN}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║  Scryvex — Instalador Raspberry Pi       ║"
echo "  ║  Compatible: RPi 4 / RPi 5 (arm64)       ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"

# Verificar RPi
if ! grep -q "Raspberry Pi" /proc/cpuinfo 2>/dev/null; then
    warn "No se detectó Raspberry Pi, el instalador puede no funcionar correctamente"
fi

# Verificar arquitectura
ARCH=$(uname -m)
if [[ "$ARCH" != "aarch64" ]]; then
    warn "Arquitectura $ARCH detectada. Se recomienda Raspberry Pi OS 64-bit para mejor rendimiento"
fi

step "Actualizando sistema..."
sudo apt-get update -qq
sudo apt-get install -y -qq curl git ca-certificates

step "Instalando Docker..."
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "$USER"
    ok "Docker instalado"
else
    ok "Docker ya está instalado ($(docker --version | awk '{print $3}' | tr -d ','))"
fi

step "Instalando Docker Compose plugin..."
if ! docker compose version &>/dev/null; then
    sudo apt-get install -y -qq docker-compose-plugin
fi
ok "Docker Compose disponible"

step "Creando directorios Scryvex..."
sudo mkdir -p "$INSTALL_DIR"/{data/{matter/certs,recordings,snapshots},logs,configs}
sudo chown -R "$USER:$USER" "$INSTALL_DIR"
ok "Directorios: $INSTALL_DIR"

step "Descargando archivos de configuración..."
if [[ -f "./$COMPOSE_FILE" ]]; then
    cp "./$COMPOSE_FILE" "$INSTALL_DIR/docker-compose.yml"
    [[ -f "./.env.example" ]] && cp "./.env.example" "$INSTALL_DIR/.env"
    [[ -d "./configs" ]] && cp -r ./configs/. "$INSTALL_DIR/configs/"
    ok "Archivos copiados desde directorio local"
else
    warn "Archivos locales no encontrados, descargando desde GitHub..."
    curl -fsSL "https://raw.githubusercontent.com/Chrisalvir1/Scryvex/main/docker-compose.rpi.yml" \
        -o "$INSTALL_DIR/docker-compose.yml" 2>/dev/null || \
        cp "$INSTALL_DIR/../scryvex/$COMPOSE_FILE" "$INSTALL_DIR/docker-compose.yml" 2>/dev/null || \
        warn "No se pudo descargar docker-compose.yml, créalo manualmente"
fi

step "Configurando .env..."
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
    cat > "$INSTALL_DIR/.env" << ENVEOF
TZ=America/Costa_Rica
MATTER_VID=65521
MATTER_PID=32768
MATTER_NAME=Scryvex Hub
THREAD_ENABLED=true
AI_ENABLED=true
GPU_DEVICE=cpu
ENVEOF
fi
ok ".env configurado"

step "Iniciando Scryvex..."
cd "$INSTALL_DIR"
docker compose pull 2>/dev/null || info "No se pudo pull de imagen, intentar build local"
docker compose up -d

ok "Scryvex iniciado"

step "Creando alias 'scryvex'..."
ALIAS_LINE="alias scryvex='docker compose -f $INSTALL_DIR/docker-compose.yml'"
if ! grep -q "alias scryvex=" ~/.bashrc 2>/dev/null; then
    echo "$ALIAS_LINE" >> ~/.bashrc
fi

LOCAL_IP=$(hostname -I | awk '{print $1}')
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       ✅ Scryvex instalado en Raspberry Pi         ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BLUE}UI Web:${NC}   http://$LOCAL_IP:1995"
echo -e "  ${BLUE}go2rtc:${NC}   http://$LOCAL_IP:1984"
echo -e "  ${BLUE}Config:${NC}   $INSTALL_DIR/configs/"
echo -e "  ${BLUE}Logs:${NC}     $INSTALL_DIR/logs/"
echo ""
echo -e "  ${YELLOW}Comandos:${NC}"
echo -e "    docker compose -f $INSTALL_DIR/docker-compose.yml logs -f"
echo -e "    docker compose -f $INSTALL_DIR/docker-compose.yml restart"
echo -e "    docker compose -f $INSTALL_DIR/docker-compose.yml down"
echo ""
echo -e "  ${YELLOW}Próximo paso:${NC}"
echo -e "    1. Abre http://$LOCAL_IP:8080 en tu navegador"
echo -e "    2. Agrega tus cámaras"
echo -e "    3. Escanea el QR desde HomeKit, Google Home o Alexa"
echo ""
