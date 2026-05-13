// Package vicohome integra cámaras VicoHome a través de su API cloud.
//
// REALIDAD TÉCNICA (Mayo 2026):
//   - VicoHome NO expone RTSP, ONVIF ni stream local de ningún tipo.
//   - El video viaja por su propio protocolo P2P propietario + AWS KVS WebRTC.
//   - Lo que SÍ está disponible via API cloud (reverse engineering confirmado):
//       * Login con email/password → access_token
//       * Listado de dispositivos (camera_id, nombre, status online/offline)
//       * Últimos eventos (motion, person, vehicle) con thumbnail JPG
//       * Descarga de clip de video del evento (URL firmada ~5min vigencia)
//       * Estado de batería, señal WiFi, firmware
//   - Proyectos de referencia: github.com/dydx/vico-cli (Go, activo Mayo 2026)
//                              github.com/KIWIDUDE564/vicohome-bridge-addon (HA addon)
//
// Lo que hace este módulo:
//   1. Auth → obtener token
//   2. Polling de eventos cada N segundos
//   3. Descargar thumbnail del último evento
//   4. Publicar por MQTT → HA ve snapshot actualizado
//   5. Exponer entidad camera.* con last_snapshot en HA Discovery

package vicohome

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de la API (basado en reverse engineering confirmado)
// ─────────────────────────────────────────────────────────────────────────────

const (
	// Endpoints API Cloud VicoHome (US por defecto, cambiar a EU si la cuenta es europea)
	APIBaseUS = "https://app-us.vicohome.io"
	APIBaseEU = "https://app-eu.vicohome.io"

	APILogin        = "/app/user/login"
	APIDeviceList   = "/app/device/list"
	APIEventList    = "/app/event/list"
	APITokenRefresh = "/app/user/refresh-token"

	// Intervalo de polling (las cámaras son cloud-only, no hay push)
	DefaultPollInterval = 30 * time.Second
	TokenRefreshBefore  = 10 * time.Minute // refrescar token si expira en menos de esto
)

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

type Config struct {
	Email        string        `yaml:"email"`
	Password     string        `yaml:"password"`
	Region       string        `yaml:"region"`        // "us" o "eu"
	PollInterval time.Duration `yaml:"poll_interval"` // default 30s
	SnapshotDir  string        `yaml:"snapshot_dir"`  // /data/snapshots/vicohome/
	MQTTCallback func(cameraID, event string, snapshot []byte)
}

type authResponse struct {
	Code    int    `json:"code"`
	Message string `json:"msg"`
	Data    struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"` // segundos
		UserID       string `json:"user_id"`
	} `json:"data"`
}

type deviceListResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data []struct {
		DeviceID   string `json:"device_id"`
		DeviceName string `json:"device_name"`
		DeviceType string `json:"device_type"`
		Online     bool   `json:"online"`
		Battery    int    `json:"battery"`    // -1 si no aplica (alimentado por cable)
		Signal     int    `json:"signal"`     // 0-100
		Firmware   string `json:"firmware"`
	} `json:"data"`
}

type eventListResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data struct {
		Events []struct {
			EventID      string `json:"event_id"`
			DeviceID     string `json:"device_id"`
			EventType    string `json:"event_type"`    // "motion" | "person" | "vehicle" | "package"
			ThumbnailURL string `json:"thumbnail_url"` // JPG, URL temporal firmada
			VideoURL     string `json:"video_url"`     // MP4, URL temporal firmada
			Timestamp    int64  `json:"timestamp"`     // Unix ms
		} `json:"events"`
		Total int `json:"total"`
	} `json:"data"`
}

// Camera representa una cámara VicoHome en CamBridge
type Camera struct {
	ID         string
	Name       string
	Online     bool
	Battery    int
	Signal     int
	LastEvent  string
	LastSnap   string    // ruta al último snapshot descargado
	LastUpdate time.Time
}

// Client maneja toda la comunicación con la API VicoHome
type Client struct {
	cfg          Config
	baseURL      string
	httpClient   *http.Client
	accessToken  string
	refreshToken string
	tokenExpiry  time.Time
	cameras      map[string]*Camera
	lastEventIDs map[string]string // cameraID → último eventID procesado
	mu           sync.RWMutex
	stopCh       chan struct{}
}

// ─────────────────────────────────────────────────────────────────────────────
// Constructor
// ─────────────────────────────────────────────────────────────────────────────

func NewClient(cfg Config) *Client {
	base := APIBaseUS
	if cfg.Region == "eu" {
		base = APIBaseEU
	}
	if cfg.PollInterval == 0 {
		cfg.PollInterval = DefaultPollInterval
	}
	if cfg.SnapshotDir == "" {
		cfg.SnapshotDir = "/data/snapshots/vicohome"
	}
	os.MkdirAll(cfg.SnapshotDir, 0755)

	return &Client{
		cfg:          cfg,
		baseURL:      base,
		httpClient:   &http.Client{Timeout: 15 * time.Second},
		cameras:      make(map[string]*Camera),
		lastEventIDs: make(map[string]string),
		stopCh:       make(chan struct{}),
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Autenticación
// ─────────────────────────────────────────────────────────────────────────────

func (c *Client) Login() error {
	payload, _ := json.Marshal(map[string]string{
		"account":  c.cfg.Email,
		"password": c.cfg.Password,
	})

	resp, err := c.post(APILogin, payload, false)
	if err != nil {
		return fmt.Errorf("vicohome login: %w", err)
	}
	defer resp.Body.Close()

	var auth authResponse
	if err := json.NewDecoder(resp.Body).Decode(&auth); err != nil {
		return fmt.Errorf("vicohome login decode: %w", err)
	}
	if auth.Code != 0 {
		return fmt.Errorf("vicohome login error %d: %s", auth.Code, auth.Message)
	}

	c.accessToken  = auth.Data.AccessToken
	c.refreshToken = auth.Data.RefreshToken
	c.tokenExpiry  = time.Now().Add(time.Duration(auth.Data.ExpiresIn) * time.Second)
	log.Printf("[vicohome] ✅ Login exitoso (userID=%s, token expira %s)",
		auth.Data.UserID, c.tokenExpiry.Format("15:04:05"))
	return nil
}

func (c *Client) ensureToken() error {
	if time.Until(c.tokenExpiry) > TokenRefreshBefore {
		return nil // token todavía válido
	}
	log.Printf("[vicohome] 🔄 Refrescando token...")
	// Re-login simple (alternativa: usar refresh_token endpoint si existe)
	return c.Login()
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispositivos
// ─────────────────────────────────────────────────────────────────────────────

func (c *Client) FetchDevices() error {
	if err := c.ensureToken(); err != nil {
		return err
	}
	resp, err := c.post(APIDeviceList, []byte(`{}`), true)
	if err != nil {
		return fmt.Errorf("vicohome devices: %w", err)
	}
	defer resp.Body.Close()

	var dl deviceListResponse
	if err := json.NewDecoder(resp.Body).Decode(&dl); err != nil {
		return err
	}
	if dl.Code != 0 {
		return fmt.Errorf("vicohome devices error %d: %s", dl.Code, dl.Msg)
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	for _, d := range dl.Data {
		if _, ok := c.cameras[d.DeviceID]; !ok {
			c.cameras[d.DeviceID] = &Camera{}
		}
		cam := c.cameras[d.DeviceID]
		cam.ID      = d.DeviceID
		cam.Name    = d.DeviceName
		cam.Online  = d.Online
		cam.Battery = d.Battery
		cam.Signal  = d.Signal
	}
	log.Printf("[vicohome] 📷 %d cámara(s) encontrada(s)", len(dl.Data))
	return nil
}

// GetCameras retorna todas las cámaras conocidas (thread-safe)
func (c *Client) GetCameras() []*Camera {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make([]*Camera, 0, len(c.cameras))
	for _, cam := range c.cameras {
		cp := *cam
		out = append(out, &cp)
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Eventos y snapshots
// ─────────────────────────────────────────────────────────────────────────────

func (c *Client) FetchEvents(deviceID string) error {
	if err := c.ensureToken(); err != nil {
		return err
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"device_id": deviceID,
		"page":      1,
		"page_size": 5, // solo los últimos 5
	})

	resp, err := c.post(APIEventList, payload, true)
	if err != nil {
		return fmt.Errorf("vicohome events [%s]: %w", deviceID, err)
	}
	defer resp.Body.Close()

	var el eventListResponse
	if err := json.NewDecoder(resp.Body).Decode(&el); err != nil {
		return err
	}
	if el.Code != 0 {
		return fmt.Errorf("vicohome events error %d: %s", el.Code, el.Msg)
	}
	if len(el.Data.Events) == 0 {
		return nil
	}

	latest := el.Data.Events[0]

	// Verificar si ya procesamos este evento
	c.mu.RLock()
	lastID := c.lastEventIDs[deviceID]
	c.mu.RUnlock()
	if latest.EventID == lastID {
		return nil // sin eventos nuevos
	}

	log.Printf("[vicohome] 🚨 Nuevo evento [%s]: %s (ID=%s)",
		deviceID, latest.EventType, latest.EventID)

	// Descargar thumbnail
	var snapData []byte
	if latest.ThumbnailURL != "" {
		snapData, _ = c.downloadURL(latest.ThumbnailURL)
		if snapData != nil {
			snapPath := filepath.Join(c.cfg.SnapshotDir, fmt.Sprintf("%s_latest.jpg", deviceID))
			os.WriteFile(snapPath, snapData, 0644)
			c.mu.Lock()
			if cam, ok := c.cameras[deviceID]; ok {
				cam.LastSnap   = snapPath
				cam.LastEvent  = latest.EventType
				cam.LastUpdate = time.UnixMilli(latest.Timestamp)
			}
			c.mu.Unlock()
		}
	}

	// Callback → MQTT
	if c.cfg.MQTTCallback != nil {
		c.cfg.MQTTCallback(deviceID, latest.EventType, snapData)
	}

	c.mu.Lock()
	c.lastEventIDs[deviceID] = latest.EventID
	c.mu.Unlock()

	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Loop de polling
// ─────────────────────────────────────────────────────────────────────────────

func (c *Client) Start() error {
	if err := c.Login(); err != nil {
		return err
	}
	if err := c.FetchDevices(); err != nil {
		return err
	}

	go c.pollLoop()
	log.Printf("[vicohome] ▶️  Polling iniciado (intervalo=%s)", c.cfg.PollInterval)
	return nil
}

func (c *Client) Stop() {
	close(c.stopCh)
}

func (c *Client) pollLoop() {
	ticker := time.NewTicker(c.cfg.PollInterval)
	defer ticker.Stop()

	// Polling inmediato al arrancar
	c.poll()

	for {
		select {
		case <-ticker.C:
			c.poll()
		case <-c.stopCh:
			log.Println("[vicohome] ⏹️  Polling detenido")
			return
		}
	}
}

func (c *Client) poll() {
	// Refrescar lista de dispositivos cada ~5 ciclos
	c.mu.RLock()
	camIDs := make([]string, 0, len(c.cameras))
	for id := range c.cameras {
		camIDs = append(camIDs, id)
	}
	c.mu.RUnlock()

	if len(camIDs) == 0 {
		// Re-intentar obtener dispositivos
		c.FetchDevices()
		return
	}

	for _, id := range camIDs {
		if err := c.FetchEvents(id); err != nil {
			log.Printf("[vicohome] ⚠️  Error eventos [%s]: %v", id, err)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────

func (c *Client) post(path string, body []byte, auth bool) (*http.Response, error) {
	req, err := http.NewRequest("POST", c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent",   "VicoHome/3.0 CamBridge/0.1")
	if auth {
		req.Header.Set("Authorization", "Bearer "+c.accessToken)
	}
	return c.httpClient.Do(req)
}

func (c *Client) downloadURL(url string) ([]byte, error) {
	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("download %s: HTTP %d", url, resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}
