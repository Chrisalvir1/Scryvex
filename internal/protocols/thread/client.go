// Package thread detecta cámaras en red Thread y consulta credenciales al TBR
package thread

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"time"
)

// NetworkCredentials contiene las credenciales de la red Thread activa
type NetworkCredentials struct {
	NetworkName  string `json:"networkName"`
	ExtPanID     string `json:"extPanId"`
	MasterKey    string `json:"masterKey"`
	Channel      int    `json:"channel"`
	PanID        string `json:"panId"`
	ActiveDataset string `json:"activeDataset"` // TLV hexadecimal
}

// ThreadCamera es una cámara descubierta en la red Thread
type ThreadCamera struct {
	IPv6Addr   string            `json:"ipv6Addr"`
	MeshLocal  string            `json:"meshLocal"`   // fd:: address
	EUI64      string            `json:"eui64"`
	DeviceType string            `json:"deviceType"`
	StreamURL  string            `json:"streamUrl"`
	Metadata   map[string]string `json:"metadata"`
}

// Client consulta el Thread Border Router y descubre cámaras
type Client struct {
	tbrURL    string        // URL del Thread Border Router REST API
	httpClient *http.Client
}

// NewClient crea un client Thread que apunta al TBR
// tbrURL: ej. "http://192.168.1.2:8080" (Home Assistant con otbr addon)
//             "http://homepod.local:49191" (Apple TBR via mDNS)
func NewClient(tbrURL string) *Client {
	return &Client{
		tbrURL: tbrURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// DetectTBR busca un Thread Border Router en la red local via mDNS
// Busca servicios _meshcop._udp y _otbr._tcp
func DetectTBR() (string, error) {
	// Multicast DNS query para _meshcop._udp.local
	// En producción usar biblioteca mDNS; aquí probamos puertos conocidos
	candidates := []string{
		"homeassistant.local:8123",   // HA con OTBR addon
		"homepod.local:49191",         // Apple HomePod Thread API
		"192.168.1.1:8080",            // Reyee/router con TBR
		"localhost:8080",              // TBR local
	}

	for _, addr := range candidates {
		host := strings.Split(addr, ":")[0]
		port := strings.Split(addr, ":")[1]

		conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
		if err != nil {
			continue
		}
		conn.Close()
		log.Printf("[thread] TBR detectado en %s:%s", host, port)
		return fmt.Sprintf("http://%s:%s", host, port), nil
	}

	return "", fmt.Errorf("no se encontró Thread Border Router en la red")
}

// GetNetworkCredentials obtiene las credenciales de la red Thread activa
// Soporta OTBR REST API (GET /node/dataset/active)
// y Apple Thread Network Credentials API
func (c *Client) GetNetworkCredentials() (*NetworkCredentials, error) {
	// Intentar OTBR REST API (OpenThread Border Router)
	// Spec: https://openthread.io/reference/border-router/rest-api
	urls := []string{
		c.tbrURL + "/node/dataset/active",   // OTBR REST
		c.tbrURL + "/api/thread/dataset",     // Scryvex proxy
		c.tbrURL + "/thread/network",         // Homeassistant addon
	}

	for _, u := range urls {
		resp, err := c.httpClient.Get(u)
		if err != nil || resp.StatusCode != 200 {
			continue
		}
		defer resp.Body.Close()

		var result map[string]interface{}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			continue
		}

		creds := &NetworkCredentials{}

		// Formato OTBR
		if ds, ok := result["ActiveDataset"].(string); ok {
			creds.ActiveDataset = ds
		}
		if name, ok := result["NetworkName"].(string); ok {
			creds.NetworkName = name
		}
		if ch, ok := result["Channel"].(float64); ok {
			creds.Channel = int(ch)
		}
		if extPan, ok := result["ExtPanId"].(string); ok {
			creds.ExtPanID = extPan
		}
		if panID, ok := result["PanId"].(string); ok {
			creds.PanID = panID
		}

		log.Printf("[thread] Credenciales obtenidas: red=%s ch=%d", creds.NetworkName, creds.Channel)
		return creds, nil
	}

	return nil, fmt.Errorf("no se pudieron obtener credenciales Thread del TBR en %s", c.tbrURL)
}

// DiscoverCameras busca cámaras Matter/Thread en la red activa
// Hace un scan de servicios _matterd._tcp en la red Thread (via TBR)
func (c *Client) DiscoverCameras() ([]ThreadCamera, error) {
	var cameras []ThreadCamera

	// 1. Obtener lista de dispositivos Thread del TBR
	resp, err := c.httpClient.Get(c.tbrURL + "/node/neighbors")
	if err != nil {
		return nil, fmt.Errorf("no se pudo consultar TBR: %v", err)
	}
	defer resp.Body.Close()

	var neighbors []map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&neighbors); err != nil {
		// Intentar formato HA
		resp2, err2 := c.httpClient.Get(c.tbrURL + "/api/thread/devices")
		if err2 != nil {
			return nil, fmt.Errorf("formato TBR desconocido: %v", err)
		}
		defer resp2.Body.Close()
		if err := json.NewDecoder(resp2.Body).Decode(&neighbors); err != nil {
			return nil, err
		}
	}

	for _, n := range neighbors {
		// Filtrar por dispositivos que anuncien servicio de cámara
		// En Thread/Matter, las cámaras exponen _matterd._tcp con deviceType 0x0043 (Video Camera)
		deviceType, _ := n["DeviceType"].(string)
		rloc16, _     := n["Rloc16"].(string)

		if !isCameraDeviceType(deviceType) {
			continue
		}

		// Construir dirección IPv6 mesh-local
		// Prefijo fd:: + RLOC16 para acceso local desde el host
		meshLocal := buildMeshLocalAddr(rloc16)

		cam := ThreadCamera{
			IPv6Addr:   meshLocal,
			MeshLocal:  meshLocal,
			EUI64:      fmt.Sprintf("%v", n["Eui64"]),
			DeviceType: deviceType,
			StreamURL:  fmt.Sprintf("rtsp://[%s]:554/stream", meshLocal),
			Metadata:   make(map[string]string),
		}

		// Intentar obtener más info del dispositivo
		if info, err := c.getDeviceInfo(meshLocal); err == nil {
			for k, v := range info {
				if s, ok := v.(string); ok {
					cam.Metadata[k] = s
				}
			}
		}

		cameras = append(cameras, cam)
		log.Printf("[thread] Cámara Thread descubierta: %s (%s)", cam.EUI64, cam.IPv6Addr)
	}

	return cameras, nil
}

// CheckCameraReachable verifica que una cámara Thread sea accesible via IPv6
func CheckCameraReachable(ipv6Addr string, port int) bool {
	addr := fmt.Sprintf("[%s]:%d", ipv6Addr, port)
	conn, err := net.DialTimeout("tcp6", addr, 3*time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func isCameraDeviceType(dt string) bool {
	// Matter Device Types para video:
	// 0x0043 = Video Player
	// 0x0023 = Network Video Recorder
	// Camera, Doorbell, etc.
	cameraTypes := []string{"0x0043", "0x0023", "camera", "doorbell", "video"}
	dt = strings.ToLower(dt)
	for _, t := range cameraTypes {
		if strings.Contains(dt, t) {
			return true
		}
	}
	return false
}

func buildMeshLocalAddr(rloc16 string) string {
	// Prefijo mesh-local típico: fd11:22::/16 (depende de la red)
	// En producción, obtener el prefijo real del TBR
	if rloc16 == "" {
		return "fd11:22::1"
	}
	// Simplificado: fd11:22::<rloc16>
	rloc16 = strings.TrimPrefix(rloc16, "0x")
	return fmt.Sprintf("fd11:22::%s", rloc16)
}

func (c *Client) getDeviceInfo(ipv6Addr string) (map[string]interface{}, error) {
	// Intentar CHIP-over-BLE o Matter commissioning info
	// En práctica, usar chip-tool o matter.js para obtener atributos
	url := fmt.Sprintf("http://[%s]:80/matter/info", ipv6Addr)
	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return result, nil
}
