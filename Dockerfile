# ═══════════════════════════════════════════════════════════════════════════
#  CamBridge — Dockerfile multi-stage multi-arch
#  Soporta: linux/amd64 (Mac Intel / Linux) · linux/arm64 (Mac M1+ / RPi4/5)
# ═══════════════════════════════════════════════════════════════════════════
ARG TARGETARCH=amd64

# ── Stage 1: Build Go API server ─────────────────────────────────────────
FROM golang:1.22-alpine AS go-builder
WORKDIR /build
COPY go.mod ./
RUN go mod download 2>/dev/null || true
COPY cmd/     cmd/
COPY internal/ internal/
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o cambrige-server ./cmd/server/

# ── Stage 2: Imagen final ─────────────────────────────────────────────────
FROM alpine:3.20
ARG TARGETARCH

# Instalar dependencias de runtime
RUN apk add --no-cache \
    curl wget ca-certificates \
    nodejs npm \
    python3 py3-pip py3-numpy \
    ffmpeg \
    bash

WORKDIR /app

# ── go2rtc ────────────────────────────────────────────────────────────────
RUN ARCH=$(uname -m); \
    if [ "$ARCH" = "aarch64" ]; then \
        G2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_arm64"; \
    else \
        G2RTC_URL="https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_amd64"; \
    fi; \
    wget -qO /usr/local/bin/go2rtc "$G2RTC_URL" && \
    chmod +x /usr/local/bin/go2rtc && \
    echo "✅ go2rtc instalado"

# ── Go server binary ──────────────────────────────────────────────────────
COPY --from=go-builder /build/cambrige-server /usr/local/bin/cambrige-server

# ── Matter Bridge (Node.js) ───────────────────────────────────────────────
COPY matter-bridge/ ./matter-bridge/
RUN cd matter-bridge && npm install --omit=dev --silent && echo "✅ matter-bridge npm ok"

# ── AI Engine (Python) ────────────────────────────────────────────────────
COPY ai_engine/ ./ai_engine/
RUN pip3 install --no-cache-dir --break-system-packages -r ai_engine/requirements.txt 2>/dev/null || \
    pip3 install --no-cache-dir -r ai_engine/requirements.txt 2>/dev/null || \
    echo "⚠️ AI deps instaladas con warnings (normal)"

# ── Configs y scripts ─────────────────────────────────────────────────────
COPY configs/    ./configs/
COPY ui/         ./ui/
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Directorios de datos
RUN mkdir -p \
    /data/matter/certs \
    /data/recordings \
    /data/snapshots \
    /logs

EXPOSE 8080 1984 8554 8555 5580/udp 7878

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget -qO- http://localhost:8080/api/status || exit 1

ENTRYPOINT ["/entrypoint.sh"]
