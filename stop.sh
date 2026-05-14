#!/bin/bash
# Scryvex — Stop: mata todos los procesos nativos
echo "⏹️  Parando Scryvex..."
pkill -f "scryvex-server"   2>/dev/null && echo "   ✅ scryvex-server detenido"   || true
pkill -f "go2rtc"           2>/dev/null && echo "   ✅ go2rtc detenido"           || true
pkill -f "bridge.js"        2>/dev/null && echo "   ✅ matter-bridge detenido"    || true
pkill -f "scryvex-scanner" 2>/dev/null && echo "   ✅ scanner-agent detenido"   || true
echo "✅ Scryvex detenido"
