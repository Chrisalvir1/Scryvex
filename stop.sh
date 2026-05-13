#!/bin/bash
# CamBridge — Stop script
echo "⏹ Parando CamBridge..."
docker-compose -f "$(dirname "${BASH_SOURCE[0]}")/docker-compose.yml" down
pkill -f "cambrige-scanner" 2>/dev/null || true
echo "✅ Detenido"
