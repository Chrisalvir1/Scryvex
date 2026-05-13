#!/usr/bin/env bash
set -euo pipefail
GRN='\033[0;32m'; BLU='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

echo -e "${BOLD}Actualizando Scryvex...${NC}"
# Re-ejecutar el instalador preservando la configuración existente
curl -fsSL https://raw.githubusercontent.com/Chrisalvir1/Scryvex/main/scripts/install.sh | \
  bash -s -- --no-service --no-browser
echo -e "${GRN}✓ Actualización completada.${NC}"
echo -e "  Reinicia el servicio: ${BLU}launchctl kickstart -k gui/\$(id -u)/com.scryvex${NC} (macOS)"
echo -e "                        ${BLU}systemctl --user restart scryvex${NC} (Linux)"
