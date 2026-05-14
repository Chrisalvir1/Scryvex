// Scryvex v0.1.1 — Servidor principal con UI Liquid Glass embebida
package main

import (
	"context"
	"bytes"
	"encoding/json"
	"flag"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/Chrisalvir1/Scryvex/internal/devicebus"
)

var (
	version   = "0.1.1"
	buildDate = "dev"
	globalDataDir string
)

func main() {
	configPath := flag.String("config", "./configs/scryvex.yaml", "Ruta al archivo de configuración")
	dataDir    := flag.String("data",   "./data",                  "Directorio de datos")
	port       := flag.String("port",   getEnv("PORT", "1995"),    "Puerto HTTP")
	uiDir      := flag.String("ui",     "./build/ui",              "Directorio de la UI")
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
	} {
		os.MkdirAll(d, 0755)
	}

	mux := http.NewServeMux()

	// ── Core de Scryvex 1.0 (DeviceBus & Plugins)
	bus := devicebus.NewManager()
	pluginManager := devicebus.NewPluginManager(bus)
	
	// Iniciar plugins de la Fase 1
	go func() {
		pluginsToStart := []string{"ring", "vicohome", "tuya", "ezviz", "wyze", "tapo", "vimtag"}
		for _, p := range pluginsToStart {
			script := "/Users/chrisalvir/Desktop/Scryvex/plugins/" + p + "/index.js"
			if _, err := os.Stat(script); err == nil {
				pluginManager.StartPlugin(p, script)
			}
		}
	}()

	// Endpoint genérico para mandar mensajes (ej. login) a cualquier plugin
	mux.HandleFunc("POST /api/plugins/", func(w http.ResponseWriter, r *http.Request) {
		// URL example: /api/plugins/ring/message
		parts := strings.Split(r.URL.Path, "/")
		if len(parts) < 4 {
			http.Error(w, "Bad Request", 400)
			return
		}
		pluginID := parts[3]
		body, _ := io.ReadAll(r.Body)
		
		var msg devicebus.IPCMessage
		if err := json.Unmarshal(body, &msg); err != nil {
			http.Error(w, "Invalid IPC Format", 400)
			return
		}
		
		err := pluginManager.SendIPC(pluginID, msg)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		w.Write([]byte(`{"status":"sent"}`))
	})

	// ── API Scryvex
	mux.HandleFunc("GET /api/status", handleStatus(version, *configPath))
	mux.HandleFunc("GET /api/cameras", handleGetCameras(bus))
	mux.HandleFunc("POST /api/cameras", handleAddCamera())
	mux.HandleFunc("DELETE /api/cameras/", handleDeleteCamera())
	mux.HandleFunc("/api/vicohome/login", handleVicohomeLogin())
	mux.HandleFunc("POST /api/ring/auth", handleRingAuth())


	// ── Proxy → Matter Bridge (:7878)
	matterURL, _ := url.Parse("http://localhost:7878")
	mux.Handle("/api/matter/", http.StripPrefix("/api/matter", httputil.NewSingleHostReverseProxy(matterURL)))

	// ── Iniciar servicios secundarios legados
	go startMatterBridge()

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

	// ── Proxy → go2rtc UI (:1985)
	go2rtcURL, _ := url.Parse("http://localhost:1985")
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
		json.Unmarshal(body, &newCam)

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
				Result int `json:"result"`
				Data   []map[string]interface{} `json:"data"`
			}
			if err := json.NewDecoder(deviceResp.Body).Decode(&devData); err == nil && devData.Result == 0 {
				for _, d := range devData.Data {
					name, _ := d["deviceName"].(string)
					sn, _ := d["serialNumber"].(string)
					
					// Mapear campos de Vicohome a Scryvex
					cam := map[string]interface{}{
						"id":           "vico-" + sn,
						"name":         name,
						"brand":        "Vicohome",
						"model":        "BLC53P",
						"type":         "cloud",
						"status":       d["status"],
						"battery":      d["battery"],
						"signal":       d["wifiSignal"],
						"stream_url":   "", // Requiere negociación WebRTC
						"vicohome_sn":  sn,
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

func startMatterBridge() {
	log.Println("🚀 Iniciando Matter Bridge...")
	cmd := exec.Command("/Users/chrisalvir/.homebrew/bin/node", "/Users/chrisalvir/Desktop/Scryvex/matter-bridge/bridge.js")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		log.Printf("❌ Error iniciando Matter Bridge: %v", err)
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
