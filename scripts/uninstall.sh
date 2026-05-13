#!/usr/bin/env bash
set -euo pipefail
RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

INSTALL_DIR="${SCRYVEX_DIR:-$HOME/.scryvex}"
OS=$(uname -s | tr '[:upper:]' '[:lower:]')

echo ""
echo -e "${BOLD}Desinstalar Scryvex${NC}"
echo -e "${YEL}Esto eliminará los binarios pero conservará tu configuración y datos.${NC}"
echo ""
read -r -p "¿Continuar? (s/N): " CONFIRM
[[ "$CONFIRM" =~ ^[sS]$ ]] || { echo "Cancelado."; exit 0; }

# Detener servicios
case "$OS" in
  darwin)
    launchctl unload "$HOME/Library/LaunchAgents/com.scryvex.plist" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/com.scryvex.plist"
    ;;
  linux)
    systemctl --user stop    scryvex 2>/dev/null || true
    systemctl --user disable scryvex 2>/dev/null || true
    rm -f "$HOME/.config/systemd/user/scryvex.service"
    ;;
esac

# Eliminar binarios (conservar data y config)
rm -rf "${INSTALL_DIR}/bin"
rm -rf "${INSTALL_DIR}/matter-bridge"

echo -e "${GRN}✓ Scryvex desinstalado.${NC}"
echo -e "  Tus datos en ${BOLD}${INSTALL_DIR}/data${NC} y configuración en ${BOLD}${INSTALL_DIR}/configs${NC} fueron conservados."
echo -e "  Para eliminarlos completamente: ${RED}rm -rf ${INSTALL_DIR}${NC}"
