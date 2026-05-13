// Scryvex v0.1.0 — Servidor principal con integración VicoHome
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
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
	version   = "0.1.0"
	buildDate = "dev"
)

func main() {
	configPath := flag.String("config", "./configs/scryvex.yaml", "Ruta al archivo de configuración")
	dataDir    := flag.String("data",   "/data",                   "Directorio de datos")
	port       := flag.String("port",   getEnv("PORT", "8080"),    "Puerto HTTP")
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

	// ── API Scryvex ─────────────────────────────────────────────────────
	mux.HandleFunc("GET  /api/status",     handleStatus(version, *configPath))
	mux.HandleFunc("GET  /api/cameras",    handleGetCameras())
	mux.HandleFunc("POST /api/cameras",    handleAddCamera())
	mux.HandleFunc("POST /api/discover",   handleDiscover())

	// ── VicoHome proxy routes ─────────────────────────────────────────────
	// Los snapshots descargados se sirven estáticamente
	snapDir := http.Dir(*dataDir + "/snapshots/vicohome")
	mux.Handle("/snapshots/vicohome/", http.StripPrefix("/snapshots/vicohome/",
		http.FileServer(snapDir)))

	// ── Proxy → Matter Bridge (Node :7878) ──────────────────────────────
	matterURL, _ := url.Parse("http://localhost:7878")
	mux.Handle("/matter/", httputil.NewSingleHostReverseProxy(matterURL))

	// ── Proxy → go2rtc UI (:1984) ────────────────────────────────────────
	go2rtcURL, _ := url.Parse("http://localhost:1984")
	mux.Handle("/go2rtc/", http.StripPrefix("/go2rtc",
		httputil.NewSingleHostReverseProxy(go2rtcURL)))

	// ── UI Web ─────────────────────────────────────────────────────────────
	mux.HandleFunc("/", handleUI(version))

	handler := corsMiddleware(loggingMiddleware(mux))

	srv := &http.Server{
		Addr:         ":" + *port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("✅ Scryvex escuchando en http://localhost:%s", *port)
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

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

func handleStatus(ver, cfgPath string) http.HandlerFunc {
	start := time.Now()
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":   "ok",
			"version":  ver,
			"service":  "scryvex",
			"uptime":   time.Since(start).Round(time.Second).String(),
			"config":   cfgPath,
			"endpoints": map[string]string{
				"ui":           "http://localhost:8080/",
				"matter_api":   "http://localhost:7878/matter/status",
				"go2rtc":       "http://localhost:1984/",
				"rtsp":         "rtsp://localhost:8554/",
			},
		})
	}
}

func handleGetCameras() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// TODO: leer de db
		json.NewEncoder(w).Encode([]interface{}{})
	}
}

func handleAddCamera() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		body, _ := io.ReadAll(r.Body)
		var cam map[string]interface{}
		json.Unmarshal(body, &cam)
		// TODO: guardar en db, registrar en go2rtc, registrar en matter-bridge
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":      true,
			"message": "Cámara recibida — procesando",
			"camera":  cam,
		})
	}
}

func handleDiscover() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "discovering",
			"message": "Buscando cámaras ONVIF en la red local...",
			"cameras": []interface{}{},
		})
	}
}

func handleUI(ver string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scryvex %s</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0 }
  body { font-family:'Segoe UI',system-ui,sans-serif; background:#0d1117; color:#c9d1d9; min-height:100vh; }
  .header { background:#161b22; border-bottom:1px solid #30363d; padding:1rem 2rem; display:flex; align-items:center; gap:1rem; }
  .logo { font-size:1.25rem; font-weight:700; color:#4f98a3; }
  .version { font-size:.75rem; color:#6e7681; background:#21262d; padding:.25rem .5rem; border-radius:.25rem; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:1rem; padding:2rem; }
  .card { background:#161b22; border:1px solid #30363d; border-radius:.5rem; padding:1.25rem; }
  .card h3 { font-size:.875rem; color:#8b949e; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.75rem; }
  .endpoint { display:flex; justify-content:space-between; align-items:center; padding:.375rem 0; border-bottom:1px solid #21262d; font-size:.875rem; }
  .endpoint:last-child { border-bottom:none; }
  .endpoint a { color:#4f98a3; text-decoration:none; }
  .endpoint a:hover { color:#79c0ff; }
  .badge { background:#1f4e36; color:#3fb950; font-size:.7rem; padding:.15rem .5rem; border-radius:1rem; }
  .badge.warn { background:#3d2b00; color:#d29922; }
  .status-dot { width:8px; height:8px; border-radius:50%; background:#3fb950; display:inline-block; margin-right:.5rem; }
  .note { background:#161b22; border:1px solid #30363d; border-left:3px solid #4f98a3; padding:1rem 1.5rem; margin:0 2rem 2rem; border-radius:.25rem; font-size:.875rem; color:#8b949e; line-height:1.6; }
  .note strong { color:#c9d1d9; }
  pre { background:#0d1117; border:1px solid #30363d; padding:1rem; border-radius:.375rem; font-size:.8rem; overflow-x:auto; color:#8b949e; margin-top:.75rem; }
  code { color:#79c0ff; }
</style>
</head>
<body>
<div class="header">
  <span class="logo">🎥 Scryvex</span>
  <span class="version">v%s</span>
  <span style="margin-left:auto; font-size:.875rem; color:#3fb950">
    <span class="status-dot"></span>Corriendo
  </span>
</div>

<div class="grid">
  <div class="card">
    <h3>API Endpoints</h3>
    <div class="endpoint"><span>Status</span><a href="/api/status" target="_blank">/api/status</a></div>
    <div class="endpoint"><span>Cámaras</span><a href="/api/cameras" target="_blank">/api/cameras</a></div>
    <div class="endpoint"><span>Descubrir ONVIF</span><code>POST /api/discover</code></div>
  </div>
  <div class="card">
    <h3>Matter Bridge</h3>
    <div class="endpoint"><span>Estado</span><a href="/matter/matter/status" target="_blank">/matter/status</a></div>
    <div class="endpoint"><span>QR Codes</span><a href="/matter/matter/cameras" target="_blank">/matter/cameras</a></div>
    <div class="endpoint"><span>Registrar cámara</span><code>POST /matter/cameras/:id/register</code></div>
  </div>
  <div class="card">
    <h3>go2rtc</h3>
    <div class="endpoint"><span>UI / Streams</span><a href="/go2rtc/" target="_blank">/go2rtc/</a></div>
    <div class="endpoint"><span>RTSP re-stream</span><code>rtsp://localhost:8554/</code></div>
    <div class="endpoint"><span>WebRTC</span><code>ws://localhost:8555/</code></div>
  </div>
  <div class="card">
    <h3>VicoHome Snapshots</h3>
    <div class="endpoint"><span>Último snapshot</span><code>/snapshots/vicohome/{id}_latest.jpg</code></div>
    <div class="endpoint"><span>Cámaras</span><a href="/matter/vicohome/cameras" target="_blank">/vicohome/cameras</a></div>
    <div class="endpoint"><span>Estado</span><span class="badge warn">Cloud-only</span></div>
  </div>
</div>

<div class="note">
  <strong>🚨 VicoHome — Lo que necesitas saber:</strong> Las cámaras VicoHome no exponen RTSP, ONVIF ni ningún stream local. 
  Solo están disponibles eventos (motion, person, vehicle) + snapshot del evento vía cloud API. 
  Scryvex hace polling cada 30s, descarga el snapshot y lo publica en MQTT para Home Assistant.<br><br>
  <strong>Para configurar VicoHome:</strong> edita <code>configs/scryvex.yaml</code> → sección <code>vicohome</code> → ingresa tu email y password de la app.
  <pre>vicohome:
  enabled:  true
  email:    "tu@email.com"
  password: "tu_password"
  region:   "us"           # us = Américas, eu = Europa</pre>
</div>

<script>
fetch('/api/status').then(r=>r.json()).then(d=>{
  console.log('Scryvex status:', d);
}).catch(e=>console.warn('API no disponible:', e));
</script>
</body>
</html>`, ver, ver)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Middlewares
// ─────────────────────────────────────────────────────────────────────────────

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin",  "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			log.Printf("%s %s", r.Method, r.URL.Path)
		}
		next.ServeHTTP(w, r)
	})
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
