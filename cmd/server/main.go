// Scryvex v0.1.1 — Servidor principal con UI Liquid Glass embebida
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/Chrisalvir1/Scryvex/internal/devicebus"
	"github.com/Chrisalvir1/Scryvex/internal/discovery"
)

var (
	version       = "1.0.0"
	buildDate     = "dev"
	globalDataDir string
)

const (
	go2rtcAPIURL   = "http://localhost:1984"
	matterAPIURL   = "http://localhost:7878"
	scannerAPIURL  = "http://localhost:9876"
	matterUDPPort  = "5580"
	defaultPlugins = "./plugins"
)

type pluginManifest struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Version     string   `json:"version"`
	Description string   `json:"description"`
	Entry       string   `json:"entry"`
	AutoStart   bool     `json:"autoStart"`
	Implemented bool     `json:"implemented"`
	Interfaces  []string `json:"interfaces"`
	Brand       string   `json:"brand"`
}

type pluginListItem struct {
	pluginManifest
	Status    string `json:"status"`
	Running   bool   `json:"running"`
	PID       int    `json:"pid,omitempty"`
	LastError string `json:"lastError,omitempty"`
	StartedAt string `json:"startedAt,omitempty"`
	StoppedAt string `json:"stoppedAt,omitempty"`
}

func main() {
	configPath := flag.String("config", "./configs/scryvex.yaml", "Ruta al archivo de configuración")
	dataDir := flag.String("data", "./data", "Directorio de datos")
	port := flag.String("port", getEnv("PORT", "1994"), "Puerto HTTP")
	uiDir := flag.String("ui", "./build/ui", "Directorio de la UI")
	flag.Parse()

	globalDataDir = *dataDir

	log.SetFlags(log.Ldate | log.Ltime | log.Lshortfile)
	log.Printf("Scryvex v%s (build %s)", version, buildDate)

	// Crear directorios
	for _, d := range []string{
		*dataDir + "/matter/certs",
		*dataDir + "/matter/fabrics",
		*dataDir + "/recordings",
		*dataDir + "/snapshots/vicohome",
		*dataDir + "/plugins",
		*dataDir + "/logs",
	} {
		os.MkdirAll(d, 0755)
	}

	mux := http.NewServeMux()

	// ── Core de Scryvex 1.0 (DeviceBus & Plugins)
	bus := devicebus.NewManager()
	pluginManager := devicebus.NewPluginManager(bus)

	// Iniciar solo plugins locales implementados y marcados como autostart.
	go func() {
		for _, p := range loadPluginManifests(defaultPlugins) {
			if !p.Implemented || !p.AutoStart {
				continue
			}
			script := pluginScriptPath(defaultPlugins, p)
			if err := pluginManager.StartPlugin(p.ID, script); err != nil {
				log.Printf("⚠️ [PluginManager] No se pudo iniciar %s: %v", p.ID, err)
			}
		}
	}()

	// ── API Scryvex
	mux.HandleFunc("GET /api/status", handleStatus(version, *configPath, *dataDir))
	mux.HandleFunc("GET /api/cameras", handleGetCameras(bus))
	mux.HandleFunc("POST /api/cameras", handleAddCamera())
	mux.HandleFunc("DELETE /api/cameras/", handleDeleteCamera())
	mux.HandleFunc("/api/plugins", handlePlugins(pluginManager, defaultPlugins, *dataDir))
	mux.HandleFunc("/api/plugins/", handlePlugins(pluginManager, defaultPlugins, *dataDir))
	mux.HandleFunc("/api/vicohome/login", handleVicohomeLogin())
	mux.HandleFunc("POST /api/ring/auth", handleRingAuth())

	// ── Proxy → Matter Bridge (:7878)
	matterURL, _ := url.Parse(matterAPIURL)
	mux.Handle("/api/matter/", http.StripPrefix("/api/matter", httputil.NewSingleHostReverseProxy(matterURL)))

	// ── Iniciar Matter Bridge solo si no está disponible ya
	go ensureMatterBridge(*dataDir, "http://localhost:"+*port)

	// ── Scanner Agent con fallback interno para Docker/RPi
	mux.HandleFunc("/api/discover", handleDiscover())

	// ── VicoHome snapshots estáticos
	snapDir := http.Dir(*dataDir + "/snapshots/vicohome")
	mux.Handle("/snapshots/vicohome/", http.StripPrefix("/snapshots/vicohome/",
		http.FileServer(snapDir)))

	// ── Proxy → go2rtc UI (:1984)
	go2rtcURL, _ := url.Parse(go2rtcAPIURL)
	mux.Handle("/go2rtc/", http.StripPrefix("/go2rtc",
		httputil.NewSingleHostReverseProxy(go2rtcURL)))

	// ── UI Web: servir build/ui/ desde disco (Liquid Glass)
	log.Printf("🎨 Sirviendo UI desde: %s", *uiDir)
	fs := http.FileServer(http.Dir(*uiDir))
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, post-check=0, pre-check=0")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")
		fs.ServeHTTP(w, r)
	}))

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
		go syncPersistedCamerasToGo2RTC()
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

func handleStatus(ver, cfgPath, dataDir string) http.HandlerFunc {
	start := time.Now()
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "ok",
			"version": ver,
			"service": "scryvex",
			"uptime":  time.Since(start).Round(time.Second).String(),
			"config":  cfgPath,
			"services": map[string]interface{}{
				"go2rtc":  serviceStatus(go2rtcAPIURL + "/api/streams"),
				"matter":  serviceStatus(matterAPIURL + "/matter/status"),
				"scanner": serviceStatus(scannerAPIURL + "/health"),
				"logs":    logDirectoryStatus(dataDir),
			},
			"endpoints": map[string]string{
				"ui":         "http://localhost:1994/",
				"matter_api": "http://localhost:7878/matter/status",
				"go2rtc":     "http://localhost:1984/",
				"rtsp":       "rtsp://localhost:8554/",
				"webrtc":     "http://localhost:8555/",
			},
		})
	}
}

func getCamerasPath() string {
	return globalDataDir + "/cameras.json"
}

func handleGetCameras(bus *devicebus.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var cameras []map[string]interface{}
		b, err := os.ReadFile(getCamerasPath())
		if err == nil {
			json.Unmarshal(b, &cameras)
		}
		for i := range cameras {
			normalizeCamera(cameras[i])
		}

		// Unir dispositivos del bus (Scryvex 1.0)
		for _, dev := range bus.GetDevices() {
			cameras = append(cameras, map[string]interface{}{
				"id":         dev.ID,
				"name":       dev.Name,
				"brand":      dev.Brand,
				"type":       "plugin",
				"pluginId":   dev.PluginID,
				"interfaces": dev.Interfaces,
				"state":      dev.State,
			})
		}

		json.NewEncoder(w).Encode(cameras)
	}
}

func handleAddCamera() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		body, _ := io.ReadAll(r.Body)
		var newCam map[string]interface{}
		if err := json.Unmarshal(body, &newCam); err != nil {
			http.Error(w, "Invalid camera JSON", http.StatusBadRequest)
			return
		}
		normalizeCamera(newCam)
		streamStatus, lastErr := syncCameraToGo2RTC(newCam)
		newCam["streamStatus"] = streamStatus
		if lastErr != "" {
			newCam["lastError"] = lastErr
		} else {
			delete(newCam, "lastError")
		}

		// Read existing
		var cameras []map[string]interface{}
		b, err := os.ReadFile(getCamerasPath())
		if err == nil {
			json.Unmarshal(b, &cameras)
		}

		// Update or Add
		updated := false
		for i, c := range cameras {
			if c["id"] == newCam["id"] {
				cameras[i] = newCam
				updated = true
				break
			}
		}
		if !updated {
			cameras = append(cameras, newCam)
		}

		// Save
		out, _ := json.MarshalIndent(cameras, "", "  ")
		os.MkdirAll(globalDataDir, 0755)
		os.WriteFile(getCamerasPath(), out, 0644)

		log.Printf("💾 Cámara guardada: %v", newCam["name"])
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":      true,
			"message": "Cámara guardada con éxito",
			"camera":  newCam,
		})
	}
}

func handleDeleteCamera() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// Extract ID from path: /api/cameras/{id}
		id := strings.TrimPrefix(r.URL.Path, "/api/cameras/")

		var cameras []map[string]interface{}
		b, err := os.ReadFile(getCamerasPath())
		if err == nil {
			json.Unmarshal(b, &cameras)
		}

		filtered := cameras[:0]
		for _, c := range cameras {
			if c["id"] != id {
				filtered = append(filtered, c)
			} else {
				removeGo2RTCStream(stringValue(c["streamId"]))
			}
		}

		out, _ := json.MarshalIndent(filtered, "", "  ")
		os.WriteFile(getCamerasPath(), out, 0644)

		log.Printf("🗑️ Cámara eliminada: %s", id)
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
	}
}

func handleVicohomeLogin() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var creds struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}

		log.Printf("☁️ Conectando a Vicohome Cloud para: %s", creds.Email)

		// 1. Autenticación con Vicohome Cloud API (Endpoint US)
		loginURL := "https://api-us.vicohome.io/account/login"
		loginBody, _ := json.Marshal(map[string]interface{}{
			"email":     creds.Email,
			"password":  creds.Password,
			"loginType": 0,
			"appId":     "com.linktop.vicohome",
		})

		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Post(loginURL, "application/json", bytes.NewBuffer(loginBody))
		if err != nil {
			log.Printf("❌ Error de conexión con Vicohome: %v", err)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"ok":    false,
				"error": "No se pudo conectar con los servidores de Vicohome",
			})
			return
		}
		defer resp.Body.Close()

		var loginResult struct {
			Result int `json:"result"`
			Data   struct {
				Token string `json:"token"`
				User  struct {
					UserId string `json:"userId"`
				} `json:"user"`
			} `json:"data"`
			Msg string `json:"msg"`
		}

		if err := json.NewDecoder(resp.Body).Decode(&loginResult); err != nil || loginResult.Result != 0 {
			log.Printf("❌ Login fallido: %s (Código: %d)", loginResult.Msg, loginResult.Result)

			errMsg := loginResult.Msg
			if loginResult.Result == -1001 {
				errMsg = "La cuenta de Vicohome no existe o el correo es incorrecto."
			} else if loginResult.Result == -1002 || loginResult.Msg == "PASSWORD_ERROR" {
				errMsg = "La contraseña es incorrecta."
			}

			json.NewEncoder(w).Encode(map[string]interface{}{
				"ok":    false,
				"error": errMsg,
			})
			return
		}

		// 2. Obtener lista de dispositivos reales
		deviceURL := "https://api-us.vicohome.io/device/list"
		req, _ := http.NewRequest("GET", deviceURL, nil)
		req.Header.Set("Authorization", "Bearer "+loginResult.Data.Token)

		deviceResp, err := client.Do(req)
		var discovered []map[string]interface{}
		if err == nil {
			var devData struct {
				Result int                      `json:"result"`
				Data   []map[string]interface{} `json:"data"`
			}
			if err := json.NewDecoder(deviceResp.Body).Decode(&devData); err == nil && devData.Result == 0 {
				for _, d := range devData.Data {
					name, _ := d["deviceName"].(string)
					sn, _ := d["serialNumber"].(string)

					// Mapear campos de Vicohome a Scryvex
					cam := map[string]interface{}{
						"id":             "vico-" + sn,
						"name":           name,
						"brand":          "Vicohome",
						"model":          "BLC53P",
						"type":           "cloud",
						"status":         d["status"],
						"battery":        d["battery"],
						"signal":         d["wifiSignal"],
						"stream_url":     "", // Requiere negociación WebRTC
						"vicohome_sn":    sn,
						"vicohome_token": loginResult.Data.Token,
					}
					discovered = append(discovered, cam)
				}
			} else {
				log.Printf("⚠️ Error obteniendo cámaras, result=%d", devData.Result)
			}
		}

		log.Printf("✅ Login exitoso. Cámaras encontradas: %d", len(discovered))
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":      true,
			"cameras": discovered,
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

func handleRingAuth() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log.Println("🔔 Reenviando solicitud al Agente Ring Persistente...")

		// Proxy a localhost:1997/auth
		proxyReq, err := http.NewRequest("POST", "http://localhost:1997/auth", r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		proxyReq.Header.Set("Content-Type", "application/json")

		client := &http.Client{Timeout: 90 * time.Second}
		resp, err := client.Do(proxyReq)
		if err != nil {
			log.Printf("❌ Error contactando con el Agente Ring: %v", err)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"ok":    false,
				"error": "El Agente Ring no está respondiendo. Reinicia Scryvex.",
			})
			return
		}
		defer resp.Body.Close()

		w.Header().Set("Content-Type", "application/json")
		io.Copy(w, resp.Body)
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func ensureMatterBridge(dataDir, apiURL string) {
	if serviceUp(matterAPIURL + "/matter/status") {
		log.Println("✅ Matter Bridge ya está disponible")
		return
	}
	if _, err := os.Stat("./matter-bridge/bridge.js"); err != nil {
		log.Printf("⚠️ Matter Bridge no encontrado: %v", err)
		return
	}
	log.Println("🚀 Iniciando Matter Bridge...")
	cmd := exec.Command("node", "./matter-bridge/bridge.js",
		"--port", matterUDPPort,
		"--data-dir", filepath.Join(dataDir, "matter"),
		"--api-url", apiURL,
	)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		log.Printf("❌ Error iniciando Matter Bridge: %v", err)
	}
}

func handleDiscover() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if serviceUp(scannerAPIURL + "/health") {
			req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, scannerAPIURL+"/scan", nil)
			resp, err := (&http.Client{Timeout: 45 * time.Second}).Do(req)
			if err == nil {
				defer resp.Body.Close()
				w.WriteHeader(resp.StatusCode)
				_, _ = io.Copy(w, resp.Body)
				return
			}
			log.Printf("⚠️ Scanner Agent falló, usando fallback interno: %v", err)
		}

		scanner := discovery.NewScanner()
		devices := scanner.ScanAll()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "success",
			"source":  "internal",
			"cameras": devices,
		})
	}
}

func handlePlugins(pm *devicebus.PluginManager, pluginsDir, dataDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/plugins"), "/")

		if path == "" {
			switch r.Method {
			case http.MethodGet:
				json.NewEncoder(w).Encode(map[string]interface{}{
					"plugins": pluginList(pm, pluginsDir),
				})
			case http.MethodPost:
				var req struct {
					ID          string `json:"id"`
					Name        string `json:"name"`
					Description string `json:"description"`
				}
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					http.Error(w, "Invalid plugin JSON", http.StatusBadRequest)
					return
				}
				manifest, err := createLocalPlugin(pluginsDir, req.ID, req.Name, req.Description)
				if err != nil {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				w.WriteHeader(http.StatusCreated)
				json.NewEncoder(w).Encode(manifest)
			default:
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
			return
		}

		parts := strings.Split(path, "/")
		pluginID := parts[0]
		manifest, ok := loadPluginManifest(pluginsDir, pluginID)
		if !ok {
			http.Error(w, "Plugin not found", http.StatusNotFound)
			return
		}
		action := ""
		if len(parts) > 1 {
			action = parts[1]
		}

		switch action {
		case "config":
			handlePluginConfig(w, r, dataDir, pluginID)
		case "start":
			if r.Method != http.MethodPost {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			if !manifest.Implemented {
				http.Error(w, "Plugin is a template and has no implementation yet", http.StatusBadRequest)
				return
			}
			err := pm.StartPlugin(pluginID, pluginScriptPath(pluginsDir, manifest))
			respondPluginAction(w, err)
		case "stop":
			if r.Method != http.MethodPost {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			err := pm.StopPlugin(pluginID)
			respondPluginAction(w, err)
		case "restart":
			if r.Method != http.MethodPost {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			if !manifest.Implemented {
				http.Error(w, "Plugin is a template and has no implementation yet", http.StatusBadRequest)
				return
			}
			err := pm.RestartPlugin(pluginID, pluginScriptPath(pluginsDir, manifest))
			respondPluginAction(w, err)
		case "message":
			if r.Method != http.MethodPost {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			var msg devicebus.IPCMessage
			if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
				http.Error(w, "Invalid IPC Format", http.StatusBadRequest)
				return
			}
			err := pm.SendIPC(pluginID, msg)
			respondPluginAction(w, err)
		default:
			if r.Method != http.MethodGet {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			item := pluginItem(pm, manifest)
			json.NewEncoder(w).Encode(item)
		}
	}
}

func handlePluginConfig(w http.ResponseWriter, r *http.Request, dataDir, pluginID string) {
	configDir := filepath.Join(dataDir, "plugins", pluginID)
	configPath := filepath.Join(configDir, "config.json")
	switch r.Method {
	case http.MethodGet:
		b, err := os.ReadFile(configPath)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{})
			return
		}
		w.Write(b)
	case http.MethodPost, http.MethodPut:
		var raw map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
			http.Error(w, "Invalid config JSON", http.StatusBadRequest)
			return
		}
		os.MkdirAll(configDir, 0700)
		b, _ := json.MarshalIndent(raw, "", "  ")
		if err := os.WriteFile(configPath, b, 0600); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func respondPluginAction(w http.ResponseWriter, err error) {
	if err != nil && !os.IsNotExist(err) {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if os.IsNotExist(err) {
		http.Error(w, "Plugin is not running", http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

func pluginList(pm *devicebus.PluginManager, pluginsDir string) []pluginListItem {
	manifests := loadPluginManifests(pluginsDir)
	items := make([]pluginListItem, 0, len(manifests))
	for _, m := range manifests {
		items = append(items, pluginItem(pm, m))
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	return items
}

func pluginItem(pm *devicebus.PluginManager, manifest pluginManifest) pluginListItem {
	st := pm.Status(manifest.ID)
	status := "stopped"
	if !manifest.Implemented {
		status = "template"
	} else if st.Running {
		status = "running"
	} else if st.LastError != "" {
		status = "error"
	}
	item := pluginListItem{
		pluginManifest: manifest,
		Status:         status,
		Running:        st.Running,
		PID:            st.PID,
		LastError:      st.LastError,
	}
	if !st.StartedAt.IsZero() {
		item.StartedAt = st.StartedAt.Format(time.RFC3339)
	}
	if !st.StoppedAt.IsZero() {
		item.StoppedAt = st.StoppedAt.Format(time.RFC3339)
	}
	return item
}

func loadPluginManifests(pluginsDir string) []pluginManifest {
	entries, err := os.ReadDir(pluginsDir)
	if err != nil {
		return nil
	}
	out := []pluginManifest{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if m, ok := loadPluginManifest(pluginsDir, e.Name()); ok {
			out = append(out, m)
		}
	}
	return out
}

func loadPluginManifest(pluginsDir, id string) (pluginManifest, bool) {
	if !isSafeID(id) {
		return pluginManifest{}, false
	}
	dir := filepath.Join(pluginsDir, id)
	if _, err := os.Stat(dir); err != nil {
		return pluginManifest{}, false
	}
	m := pluginManifest{
		ID:          id,
		Name:        strings.Title(strings.ReplaceAll(id, "-", " ")),
		Version:     "0.1.0",
		Description: "Plugin local",
		Entry:       "index.js",
		AutoStart:   false,
		Implemented: false,
	}
	b, err := os.ReadFile(filepath.Join(dir, "plugin.json"))
	if err == nil {
		_ = json.Unmarshal(b, &m)
	}
	if m.ID == "" {
		m.ID = id
	}
	if m.Entry == "" {
		m.Entry = "index.js"
	}
	return m, true
}

func pluginScriptPath(pluginsDir string, manifest pluginManifest) string {
	return filepath.Join(pluginsDir, manifest.ID, manifest.Entry)
}

func createLocalPlugin(pluginsDir, id, name, description string) (pluginManifest, error) {
	id = sanitizeID(id)
	if id == "" {
		return pluginManifest{}, fmt.Errorf("plugin id requerido")
	}
	if name == "" {
		name = strings.Title(strings.ReplaceAll(id, "-", " "))
	}
	dir := filepath.Join(pluginsDir, id)
	if _, err := os.Stat(dir); err == nil {
		return pluginManifest{}, fmt.Errorf("plugin ya existe")
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return pluginManifest{}, err
	}
	manifest := pluginManifest{
		ID:          id,
		Name:        name,
		Version:     "0.1.0",
		Description: description,
		Entry:       "index.js",
		AutoStart:   false,
		Implemented: false,
		Interfaces:  []string{"VideoCamera"},
	}
	b, _ := json.MarshalIndent(manifest, "", "  ")
	if err := os.WriteFile(filepath.Join(dir, "plugin.json"), b, 0644); err != nil {
		return pluginManifest{}, err
	}
	stub := fmt.Sprintf(`const readline = require('readline');

function log(msg) { console.log('[Plugin:%s] ' + msg); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
rl.on('line', (line) => {
  if (!line) return;
  try {
    const msg = JSON.parse(line);
    log('Received IPC: ' + msg.type);
  } catch (e) {
    log('IPC parse error: ' + e.message);
  }
});

log('Plugin local creado. Marca implemented=true en plugin.json cuando agregues integración real.');
`, id)
	if err := os.WriteFile(filepath.Join(dir, "index.js"), []byte(stub), 0644); err != nil {
		return pluginManifest{}, err
	}
	return manifest, nil
}

func serviceStatus(endpoint string) map[string]interface{} {
	start := time.Now()
	err := probeHTTP(endpoint, 2*time.Second)
	status := map[string]interface{}{
		"ok":      err == nil,
		"latency": time.Since(start).Round(time.Millisecond).String(),
		"url":     endpoint,
	}
	if err != nil {
		status["error"] = err.Error()
	}
	return status
}

func serviceUp(endpoint string) bool {
	return probeHTTP(endpoint, 1200*time.Millisecond) == nil
}

func probeHTTP(endpoint string, timeout time.Duration) error {
	client := &http.Client{Timeout: timeout}
	resp, err := client.Get(endpoint)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 500 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return nil
}

func logDirectoryStatus(dataDir string) map[string]interface{} {
	candidates := []string{"./logs", filepath.Join(dataDir, "logs")}
	out := map[string]interface{}{}
	for _, dir := range candidates {
		err := os.MkdirAll(dir, 0755)
		if err == nil {
			test := filepath.Join(dir, ".write-test")
			err = os.WriteFile(test, []byte("ok"), 0644)
			if err == nil {
				_ = os.Remove(test)
			}
		}
		out[dir] = map[string]interface{}{
			"ok":    err == nil,
			"error": errorString(err),
		}
	}
	return out
}

func syncPersistedCamerasToGo2RTC() {
	time.Sleep(1500 * time.Millisecond)
	b, err := os.ReadFile(getCamerasPath())
	if err != nil {
		return
	}
	var cameras []map[string]interface{}
	if err := json.Unmarshal(b, &cameras); err != nil {
		return
	}
	for _, cam := range cameras {
		normalizeCamera(cam)
		status, errText := syncCameraToGo2RTC(cam)
		if status != "ready" {
			log.Printf("⚠️ go2rtc no registró %s: %s", stringValue(cam["name"]), errText)
		}
	}
}

func normalizeCamera(cam map[string]interface{}) {
	if stringValue(cam["id"]) == "" {
		cam["id"] = "cam-" + fmt.Sprint(time.Now().UnixNano())
	}
	if stringValue(cam["streamId"]) == "" {
		cam["streamId"] = sanitizeID(stringValue(cam["id"]))
	}
	if stringValue(cam["streamId"]) == "" {
		cam["streamId"] = "cam-" + fmt.Sprint(time.Now().UnixNano())
	}
	if stringValue(cam["streamStatus"]) == "" {
		cam["streamStatus"] = "unknown"
	}
}

func syncCameraToGo2RTC(cam map[string]interface{}) (string, string) {
	source := cameraSource(cam)
	if source == "" {
		return "missing_source", "No hay URL de stream"
	}
	streamID := stringValue(cam["streamId"])
	if streamID == "" {
		streamID = sanitizeID(stringValue(cam["id"]))
		cam["streamId"] = streamID
	}
	if !serviceUp(go2rtcAPIURL + "/api/streams") {
		return "offline", "go2rtc no está disponible en :1984"
	}
	if err := registerGo2RTCStream(streamID, source); err != nil {
		return "error", err.Error()
	}
	return "ready", ""
}

func registerGo2RTCStream(streamID, source string) error {
	escapedID := url.QueryEscape(streamID)
	escapedSource := url.QueryEscape(source)
	body, _ := json.Marshal(map[string]string{"name": streamID, "src": source})
	attempts := []struct {
		method string
		url    string
		body   []byte
	}{
		{http.MethodPut, go2rtcAPIURL + "/api/streams?dst=" + escapedID + "&src=" + escapedSource, nil},
		{http.MethodPost, go2rtcAPIURL + "/api/streams?dst=" + escapedID + "&src=" + escapedSource, nil},
		{http.MethodPut, go2rtcAPIURL + "/api/streams?name=" + escapedID + "&src=" + escapedSource, nil},
		{http.MethodPost, go2rtcAPIURL + "/api/streams", body},
	}
	var lastErr error
	client := &http.Client{Timeout: 4 * time.Second}
	for _, a := range attempts {
		var reader io.Reader
		if a.body != nil {
			reader = bytes.NewReader(a.body)
		}
		req, _ := http.NewRequest(a.method, a.url, reader)
		if a.body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			log.Printf("✅ go2rtc stream listo: %s -> %s", streamID, redactURL(source))
			return nil
		}
		lastErr = fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no se pudo registrar stream")
	}
	return lastErr
}

func removeGo2RTCStream(streamID string) {
	if streamID == "" {
		return
	}
	req, _ := http.NewRequest(http.MethodDelete, go2rtcAPIURL+"/api/streams?dst="+url.QueryEscape(streamID), nil)
	_, _ = (&http.Client{Timeout: 2 * time.Second}).Do(req)
}

func cameraSource(cam map[string]interface{}) string {
	source := firstString(cam["url"], cam["stream_url"], cam["streamUrl"])
	protocol := strings.ToLower(firstString(cam["protocol"], cam["type"]))
	ip := stringValue(cam["ip"])
	if protocol == "onvif" && ip != "" && !strings.HasPrefix(strings.ToLower(source), "rtsp://") {
		return "rtsp://" + ip + ":554/stream1"
	}
	if source == "" && ip != "" {
		return "rtsp://" + ip + ":554/stream1"
	}
	return source
}

func firstString(vals ...interface{}) string {
	for _, v := range vals {
		if s := stringValue(v); s != "" {
			return s
		}
	}
	return ""
}

func stringValue(v interface{}) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case fmt.Stringer:
		return strings.TrimSpace(t.String())
	default:
		return ""
	}
}

func sanitizeID(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	lastDash := false
	for _, r := range s {
		ok := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-'
		if ok {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(b.String(), "-_")
}

func isSafeID(s string) bool {
	return s != "" && sanitizeID(s) == s && !strings.Contains(s, "..") && !strings.ContainsAny(s, `/\`)
}

func redactURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.User == nil {
		return raw
	}
	username := u.User.Username()
	if username == "" {
		username = "user"
	}
	u.User = url.UserPassword(username, "xxxxx")
	return u.String()
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func localIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return "localhost"
	}
	defer conn.Close()
	if addr, ok := conn.LocalAddr().(*net.UDPAddr); ok {
		return addr.IP.String()
	}
	return "localhost"
}
