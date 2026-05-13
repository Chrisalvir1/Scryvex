APP     = scryvex
VERSION = $(shell git describe --tags --always --dirty 2>/dev/null || echo "0.1.0")
LDFLAGS = -s -w -X main.version=$(VERSION) -X main.buildDate=$(shell date -u +%Y%m%d)
OUTDIR  = dist

.PHONY: all clean macos-arm macos-intel linux-amd64 linux-arm64 windows rpi

all: macos-arm macos-intel linux-amd64 linux-arm64 windows rpi

macos-arm:
	GOOS=darwin  GOARCH=arm64  go build -ldflags="$(LDFLAGS)" -o $(OUTDIR)/$(APP)-macos-arm64    ./cmd/server

macos-intel:
	GOOS=darwin  GOARCH=amd64  go build -ldflags="$(LDFLAGS)" -o $(OUTDIR)/$(APP)-macos-x86_64   ./cmd/server

linux-amd64:
	GOOS=linux   GOARCH=amd64  go build -ldflags="$(LDFLAGS)" -o $(OUTDIR)/$(APP)-linux-amd64    ./cmd/server

linux-arm64:
	GOOS=linux   GOARCH=arm64  go build -ldflags="$(LDFLAGS)" -o $(OUTDIR)/$(APP)-linux-arm64    ./cmd/server

rpi:
	GOOS=linux   GOARCH=arm    GOARM=7 go build -ldflags="$(LDFLAGS)" -o $(OUTDIR)/$(APP)-linux-armv7  ./cmd/server

windows:
	GOOS=windows GOARCH=amd64  go build -ldflags="$(LDFLAGS)" -o $(OUTDIR)/$(APP)-windows-amd64.exe ./cmd/server

macos-universal: macos-arm macos-intel
	lipo -create -output $(OUTDIR)/$(APP)-macos-universal \
		$(OUTDIR)/$(APP)-macos-arm64 \
		$(OUTDIR)/$(APP)-macos-x86_64

clean:
	rm -rf $(OUTDIR)

run:
	go run ./cmd/server --config ./configs/scryvex.yaml --data ./data

dist-dir:
	mkdir -p $(OUTDIR)
