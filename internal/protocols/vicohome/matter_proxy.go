// matter_proxy.go — Expone cámaras VicoHome como dispositivos Matter
//
// VicoHome no tiene stream local, así que lo que se expone en Matter es:
//   - Un "camera" device type Matter con snapshot (imagen estática actualizada)
//   - Un motion sensor Matter (True cuando hay evento reciente)
//   - La imagen del último evento se sirve localmente desde /data/snapshots/
//
// Con esto, HomeKit / Google Home / Alexa pueden:
//   - Ver el QR y agregar la "cámara" (muestra último snapshot)
//   - Automatizar cuando detecta movimiento
//   - Ver notificaciones con snapshot en la app
//
// NOTA: Live stream real (video en tiempo real) requeriría que VicoHome
// exponga WebRTC o RTSP, lo cual aún no hacen (Mayo 2026).

package vicohome

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
)

// MatterProxy sirve snapshots localmente para que el Matter Bridge
// pueda incluirlos en el device type de cámara Matter.
type MatterProxy struct {
	snapshotDir string
	mux         *http.ServeMux
	cameras     map[string]*Camera
}

func NewMatterProxy(snapshotDir string) *MatterProxy {
	p := &MatterProxy{
		snapshotDir: snapshotDir,
		mux:         http.NewServeMux(),
		cameras:     make(map[string]*Camera),
	}

	// Endpoint para que el matter-bridge (Node.js) descargue snapshots
	p.mux.HandleFunc("/vicohome/snapshot/", p.handleSnapshot)
	p.mux.HandleFunc("/vicohome/cameras",   p.handleCameraList)

	return p
}

// RegisterCamera expone una cámara VicoHome al proxy
func (p *MatterProxy) RegisterCamera(cam *Camera) {
	p.cameras[cam.ID] = cam
	log.Printf("[vicohome] 🔌 Cámara registrada en proxy Matter: %s (%s)", cam.Name, cam.ID)
}

// ServeHTTP implementa http.Handler para montar en el mux principal
func (p *MatterProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	p.mux.ServeHTTP(w, r)
}

func (p *MatterProxy) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	// /vicohome/snapshot/{camera_id}
	id := r.URL.Path[len("/vicohome/snapshot/"):]
	if id == "" {
		http.Error(w, "camera id required", 400)
		return
	}

	snapPath := fmt.Sprintf("%s/%s_latest.jpg", p.snapshotDir, sanitizeID(id))
	data, err := os.ReadFile(snapPath)
	if err != nil {
		// Devolver imagen placeholder si no hay snapshot
		w.Header().Set("Content-Type", "image/svg+xml")
		w.WriteHeader(200)
		fmt.Fprintf(w, `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
<rect width="640" height="360" fill="#1a1a2e"/>
<text x="320" y="170" text-anchor="middle" fill="#4f98a3" font-size="18" font-family="sans-serif">VicoHome</text>
<text x="320" y="200" text-anchor="middle" fill="#797876" font-size="14" font-family="sans-serif">%s</text>
<text x="320" y="230" text-anchor="middle" fill="#5a5957" font-size="12" font-family="sans-serif">Esperando primer evento...</text>
</svg>`, id)
		return
	}

	w.Header().Set("Content-Type",  "image/jpeg")
	w.Header().Set("Cache-Control", "no-cache, no-store")
	w.Header().Set("Last-Modified", time.Now().UTC().Format(http.TimeFormat))
	w.Write(data)
}

func (p *MatterProxy) handleCameraList(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	type cameraInfo struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Online      bool   `json:"online"`
		Battery     int    `json:"battery"`
		LastEvent   string `json:"last_event"`
		SnapshotURL string `json:"snapshot_url"`
		HasSnapshot bool   `json:"has_snapshot"`
	}

	list := make([]cameraInfo, 0, len(p.cameras))
	for _, cam := range p.cameras {
		snapPath := fmt.Sprintf("%s/%s_latest.jpg", p.snapshotDir, sanitizeID(cam.ID))
		_, hasSnap := os.Stat(snapPath)
		list = append(list, cameraInfo{
			ID:          cam.ID,
			Name:        cam.Name,
			Online:      cam.Online,
			Battery:     cam.Battery,
			LastEvent:   cam.LastEvent,
			SnapshotURL: fmt.Sprintf("/vicohome/snapshot/%s", cam.ID),
			HasSnapshot: hasSnap == nil,
		})
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"cameras":  list,
		"count":    len(list),
		"provider": "vicohome",
		"note":     "Live stream no disponible — VicoHome solo expone eventos + snapshots via cloud API",
	})
}
