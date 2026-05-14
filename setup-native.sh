#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# CamBridge Professional Native Setup (macOS)
# ─────────────────────────────────────────────────────────────────

set -e

echo "🚀 Iniciando instalación profesional de CamBridge Hub..."

# 1. Detectar Arquitectura
ARCH=$(uname -m)
OS=$(uname -s)

if [ "$OS" != "Darwin" ]; then
    echo "❌ Este script es solo para macOS. Para Linux/RPi usa setup-linux.sh"
    exit 1
fi

echo "💻 Arquitectura detectada: $ARCH ($OS)"

# 2. Instalar dependencias si faltan (FFmpeg para transcodificación)
if ! command -v ffmpeg &> /dev/null; then
    echo "📦 Instalando FFmpeg vía Homebrew..."
    if ! command -v brew &> /dev/null; then
        echo "❌ Homebrew no encontrado. Instálalo primero en https://brew.sh"
        exit 1
    fi
    brew install ffmpeg
else
    echo "✅ FFmpeg ya está instalado"
fi

# 3. Compilar Servidor y Scanner (Usando Docker si Go no está instalado)
echo "🔨 Compilando binarios nativos para macOS..."
mkdir -p build/data

# Definir variables de arquitectura de Go
GOARCH="amd64"
if [ "$ARCH" == "arm64" ]; then
    GOARCH="arm64"
fi

if command -v go &> /dev/null; then
    echo "   Usando Go local..."
    cd cmd/server
    GOOS=darwin GOARCH=$GOARCH go build -o ../../build/scryvex-server .
    cd ../../scanner-agent
    GOOS=darwin GOARCH=$GOARCH go build -o ../build/scanner-agent .
    cd ..
else
    echo "   Go no instalado. Usando Docker builder para compilar binarios nativos..."
    if ! command -v docker &> /dev/null; then
        echo "❌ Docker no está instalado y tampoco Go. Necesitas al menos uno."
        exit 1
    fi
    docker run --rm -v "$(pwd):/src" -w /src golang:1.22-alpine sh -c "
        cd cmd/server && GOOS=darwin GOARCH=$GOARCH go build -o ../../build/scryvex-server . &&
        cd ../../scanner-agent && GOOS=darwin GOARCH=$GOARCH go build -o ../build/scanner-agent .
    "
fi

# 5. Configurar Aceleración de Hardware (GPU)
# En Mac usamos VideoToolbox
echo "🏎️ Configurando aceleración por GPU (VideoToolbox)..."
cat > build/.env <<EOF
PORT=1995
FFMPEG_HWACCEL=videotoolbox
GPU_ENABLED=true
SCANNER_PORT=9876
EOF

# 6. Crear Script de Ejecución Unificado
cat > scryvex-hub <<EOF
#!/bin/bash
trap "pkill -f scanner-agent; exit" SIGINT SIGTERM
./scanner-agent &
./scryvex-server -data ./data -port 1995
EOF
chmod +x scryvex-hub
mv scryvex-hub build/

# 7. Preparar UI
echo "🌐 Sincronizando interfaz de usuario..."
cp -r ui/src build/ui

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ INSTALACIÓN COMPLETADA"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "CamBridge Hub ha sido instalado en la carpeta ./build"
echo ""
echo "Para iniciar el sistema profesionalmente:"
echo "cd build && ./cambridge-hub"
echo ""
echo "Nota: El sistema detectará automáticamente si usas Intel o Silicon"
echo "y usará la GPU de tu Mac para procesar el video sin lag."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
