// Scryvex v0.1.1 — Servidor principal con UI Liquid Glass embebida
package main

import (
	"context"
	"encoding/json"
	"flag"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"
)

var (
	version   = "0.1.1"
	buildDate = "dev"
)

func main() {
	configPath := flag.String("config", "./configs/scryvex.yaml", "Ruta al archivo de configuración")
	dataDir    := flag.String("data",   "/data",                   "Directorio de datos")
	port       := flag.String("port",   getEnv("PORT", "1994"),    "Puerto HTTP")
	uiDir      := flag.String("ui",     "./build/ui",              "Directorio de la UI")
	flag.Parse()

	log.SetFlags(log.Ldate | log.Ltime | log.Lshortfile)
	log.Printf("Scryvex v%s (build %s)", version, buildDate)

	// Crear directorios
	for _, d := range []string{
		*dataDir + "/matter/certs",
		*dataDir + "/matter/fabrics",
		*dataDir + "/recordings",
		*dataDir + "/snapshots/vicohome",
	} {
		os.MkdirAll(d, 0755)
	}

	mux := http.NewServeMux()

	// ── API Scryvex
	mux.HandleFunc("GET /api/status",    handleStatus(version, *configPath))
	mux.HandleFunc("GET /api/cameras",   handleGetCameras())
	mux.HandleFunc("POST /api/cameras",  handleAddCamera())

	// ── Proxy → Scanner Agent (:9876)
	mux.HandleFunc("/api/discover", func(w http.ResponseWriter, r *http.Request) {
		proxy := httputil.NewSingleHostReverseProxy(&url.URL{
			Scheme: "http",
			Host:   "localhost:9876",
		})
		r.URL.Path = "/scan"
		proxy.ServeHTTP(w, r)
	})

	// ── VicoHome snapshots estáticos
	snapDir := http.Dir(*dataDir + "/snapshots/vicohome")
	mux.Handle("/snapshots/vicohome/", http.StripPrefix("/snapshots/vicohome/",
		http.FileServer(snapDir)))

	// ── Proxy → Matter Bridge (Node :7878)
	matterURL, _ := url.Parse("http://localhost:7878")
	mux.Handle("/matter/", httputil.NewSingleHostReverseProxy(matterURL))

	// ── Proxy → go2rtc UI (:1984)
	go2rtcURL, _ := url.Parse("http://localhost:1984")
	mux.Handle("/go2rtc/", http.StripPrefix("/go2rtc",
		httputil.NewSingleHostReverseProxy(go2rtcURL)))

	// ── UI Web: servir build/ui/ desde disco (Liquid Glass)
	log.Printf("🎨 Sirviendo UI desde: %s", *uiDir)
	mux.Handle("/", http.FileServer(http.Dir(*uiDir)))

	handler := corsMiddleware(loggingMiddleware(mux))

	srv := &http.Server{
		Addr:         ":" + *port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("✅ Scryvex v%s escuchando en http://localhost:%s", version, *port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Error HTTP: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
	log.Println("Scryvex detenido")
}

func handleStatus(ver, cfgPath string) http.HandlerFunc {
	start := time.Now()
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "ok",
			"version": ver,
			"service": "scryvex",
			"uptime":  time.Since(start).Round(time.Second).String(),
			"config":  cfgPath,
			"endpoints": map[string]string{
				"ui":         "http://localhost:1994/",
				"matter_api": "http://localhost:7878/matter/status",
				"go2rtc":     "http://localhost:1984/",
				"rtsp":       "rtsp://localhost:8554/",
			},
		})
	}
}

func handleGetCameras() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]interface{}{})
	}
}

func handleAddCamera() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		body, _ := io.ReadAll(r.Body)
		var cam map[string]interface{}
		json.Unmarshal(body, &cam)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":      true,
			"message": "Cámara recibida — procesando",
			"camera":  cam,
		})
	}
}

// handleDiscover eliminado (ahora usa proxy)

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
