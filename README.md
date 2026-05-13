<div align="center">

<img src="https://raw.githubusercontent.com/Chrisalvir1/Scryvex/main/ui/logo.svg" width="80" alt="Scryvex Logo">

# Scryvex

**Camera Bridge moderno — Matter · HomeKit · Google Home · Alexa · Home Assistant**

[![Release](https://img.shields.io/github/v/release/Chrisalvir1/Scryvex?color=4f98a3&style=flat-square)](https://github.com/Chrisalvir1/Scryvex/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/Chrisalvir1/Scryvex/ci.yml?label=CI&style=flat-square)](https://github.com/Chrisalvir1/Scryvex/actions)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows%20%7C%20RPi-lightgrey?style=flat-square)](#instalación)

Scryvex es una alternativa ligera y moderna a Scrypted. Une todas tus cámaras
(RTSP, ONVIF, Matter, cuentas cloud) en un solo lugar y las expone a HomeKit,
Google Home, Alexa y Home Assistant mediante **un solo QR de Matter**.

</div>

---

## ✨ Características

- 🎥 **Multi-protocolo** — RTSP, ONVIF, Matter/Thread, Zigbee, cuentas cloud (VicoHome, Nooie, Reolink Cloud)
- ⚡ **Ultra ligero** — binario único en Go, ~15 MB RAM en reposo
- 🍎 **Apple Silicon nativo** — arm64 real, sin Rosetta
- 🪟 **Cross-platform** — macOS · Linux · Windows · Raspberry Pi
- 📱 **QR Matter único** — escanea una vez, funciona en HomeKit, Google Home, Alexa y SmartThings
- 🏠 **Home Assistant** — entidades auto-descubiertas via MQTT Discovery
- 🔒 **100% local** — nada sale a internet, cloud solo si tú lo activas
- 🖥️ **UI moderna** — dashboard WebRTC en tiempo real, dark mode

---

## 🚀 Instalación

### Una línea (recomendado)

```bash
curl -fsSL https://raw.githubusercontent.com/Chrisalvir1/Scryvex/main/scripts/install.sh | bash
```

> Detecta tu plataforma automáticamente, descarga el binario correcto y configura el inicio automático.

### Instalación manual

```bash
# 1. Descarga el binario para tu plataforma desde Releases
#    https://github.com/Chrisalvir1/Scryvex/releases/latest

# macOS Apple Silicon
curl -L https://github.com/Chrisalvir1/Scryvex/releases/latest/download/scryvex-macos-arm64 \
  -o /usr/local/bin/scryvex && chmod +x /usr/local/bin/scryvex

# macOS Intel
curl -L https://github.com/Chrisalvir1/Scryvex/releases/latest/download/scryvex-macos-x86_64 \
  -o /usr/local/bin/scryvex && chmod +x /usr/local/bin/scryvex

# Linux x86_64
curl -L https://github.com/Chrisalvir1/Scryvex/releases/latest/download/scryvex-linux-amd64 \
  -o /usr/local/bin/scryvex && chmod +x /usr/local/bin/scryvex

# Raspberry Pi (ARMv7)
curl -L https://github.com/Chrisalvir1/Scryvex/releases/latest/download/scryvex-linux-armv7 \
  -o /usr/local/bin/scryvex && chmod +x /usr/local/bin/scryvex

# 2. Ejecutar
scryvex
```

### Windows

```powershell
# PowerShell — instalar y ejecutar
Invoke-WebRequest https://github.com/Chrisalvir1/Scryvex/releases/latest/download/scryvex-windows-amd64.exe `
  -OutFile scryvex.exe
.\scryvex.exe
```

---

## 🛠️ Compilar desde fuente

```bash
# Requisitos: Go 1.22+
git clone https://github.com/Chrisalvir1/Scryvex.git
cd scryvex

# Compilar para tu plataforma actual
go build -o scryvex ./cmd/server

# Compilar para todas las plataformas
make all

# Ejecutar en desarrollo
make run
```

---

## ⚙️ Configuración

El archivo de configuración se crea automáticamente en `~/.scryvex/configs/scryvex.yaml`.

```yaml
server:
  port: 8080
  log_level: info   # debug, info, warn, error

matter:
  enabled: true
  port: 5580

# Cuentas cloud (opcional)
vicohome:
  enabled: true
  email: "tu@email.com"
  password: "tu_password"
  region: "us"          # us = Américas

# Home Assistant (opcional)
homeassistant:
  enabled: true
  mqtt_broker: "192.168.1.100"
  mqtt_port: 1883
```

---

## 📡 Uso

```
http://localhost:8080       → UI principal
http://localhost:8080/api/  → REST API
rtsp://localhost:8554/      → Re-streams RTSP
```

---

## 📋 Comandos útiles

```bash
scryvex                          # iniciar (busca config en ~/.scryvex)
scryvex --port 9090              # puerto personalizado
scryvex --config /ruta/cfg.yaml  # config alternativa
scryvex --data /ruta/datos       # directorio de datos alternativo

# Actualizar a la última versión
curl -fsSL https://raw.githubusercontent.com/Chrisalvir1/Scryvex/main/scripts/update.sh | bash

# Desinstalar (conserva datos y config)
curl -fsSL https://raw.githubusercontent.com/Chrisalvir1/Scryvex/main/scripts/uninstall.sh | bash
```

---

## 🆚 Scryvex vs Scrypted

| | **Scryvex** | Scrypted |
|---|---|---|
| Instalación | 1 línea, binario único | npm + múltiples deps |
| RAM en reposo | ~15 MB | ~300-500 MB |
| Inicio | < 1s | 5-15s |
| Docker necesario | ❌ No | ⚠️ Recomendado |
| Node.js requerido | Solo para Matter Bridge | Siempre |
| UI | Moderna, WebRTC nativo | Funcional pero densa |
| Apple Silicon nativo | ✅ arm64 real | ✅ |
| Windows | ✅ | ✅ |
| Raspberry Pi | ✅ ARMv7 + ARM64 | ⚠️ Lento |
| Licencia | MIT | Apache 2.0 |

---

## 📄 Licencia

MIT — ver [LICENSE](LICENSE)
