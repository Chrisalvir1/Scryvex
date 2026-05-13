// mqtt_bridge.go — Puente VicoHome → Home Assistant via MQTT Discovery
//
// Cuando llega un evento de VicoHome:
//   1. Publica snapshot (imagen) en topic MQTT
//   2. HA muestra la imagen en la entidad camera.*
//   3. binary_sensor.*_motion se activa por 30s
//   4. Automatizaciones de HA pueden reaccionar

package vicohome

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"time"

	mqtt "github.com/cambrige/cambrige/internal/protocols/mqtt"
)

// HADiscoveryConfig genera los mensajes de Home Assistant MQTT Discovery
// para una cámara VicoHome.
type HADiscoveryConfig struct {
	broker   *mqtt.Publisher
	cameraID string
	name     string
}

func NewHABridge(broker *mqtt.Publisher, cameraID, name string) *HADiscoveryConfig {
	return &HADiscoveryConfig{broker, cameraID, name}
}

// Publish publica la config de discovery en HA (llamar una vez al inicio)
func (h *HADiscoveryConfig) Publish() error {
	slug := sanitizeID(h.cameraID)

	// ── Camera entity (snapshot) ─────────────────────────────────────────
	camConfig := map[string]interface{}{
		"name":               h.name,
		"unique_id":          "vicohome_" + slug,
		"topic":              fmt.Sprintf("cambrige/vicohome/%s/snapshot", slug),
		"image_encoding":     "b64",
		"device": map[string]interface{}{
			"identifiers":  []string{"vicohome_" + slug},
			"name":         h.name,
			"manufacturer": "VicoHome",
			"model":        "VicoHome Camera",
			"via_device":   "cambrige_hub",
		},
	}
	configTopic := fmt.Sprintf("homeassistant/camera/vicohome_%s/config", slug)
	payload, _ := json.Marshal(camConfig)
	if err := h.broker.Publish(configTopic, string(payload), true); err != nil {
		return fmt.Errorf("ha discovery camera: %w", err)
	}

	// ── Motion binary_sensor ──────────────────────────────────────────────
	motionConfig := map[string]interface{}{
		"name":          h.name + " Motion",
		"unique_id":     "vicohome_motion_" + slug,
		"device_class":  "motion",
		"state_topic":   fmt.Sprintf("cambrige/vicohome/%s/motion", slug),
		"payload_on":    "ON",
		"payload_off":   "OFF",
		"off_delay":     30, // auto-off después de 30s
		"device": map[string]interface{}{
			"identifiers": []string{"vicohome_" + slug},
		},
	}
	motionTopic := fmt.Sprintf("homeassistant/binary_sensor/vicohome_%s_motion/config", slug)
	payload, _ = json.Marshal(motionConfig)
	if err := h.broker.Publish(motionTopic, string(payload), true); err != nil {
		return fmt.Errorf("ha discovery motion: %w", err)
	}

	// ── Event type sensor ─────────────────────────────────────────────────
	eventConfig := map[string]interface{}{
		"name":        h.name + " Evento",
		"unique_id":   "vicohome_event_" + slug,
		"state_topic": fmt.Sprintf("cambrige/vicohome/%s/event_type", slug),
		"icon":        "mdi:cctv",
		"device": map[string]interface{}{
			"identifiers": []string{"vicohome_" + slug},
		},
	}
	eventTopic := fmt.Sprintf("homeassistant/sensor/vicohome_%s_event/config", slug)
	payload, _ = json.Marshal(eventConfig)
	if err := h.broker.Publish(eventTopic, string(payload), true); err != nil {
		return fmt.Errorf("ha discovery event: %w", err)
	}

	// ── Battery sensor (para cámaras inalámbricas) ────────────────────────
	battConfig := map[string]interface{}{
		"name":          h.name + " Batería",
		"unique_id":     "vicohome_battery_" + slug,
		"device_class":  "battery",
		"state_topic":   fmt.Sprintf("cambrige/vicohome/%s/battery", slug),
		"unit_of_measurement": "%",
		"device": map[string]interface{}{
			"identifiers": []string{"vicohome_" + slug},
		},
	}
	battTopic := fmt.Sprintf("homeassistant/sensor/vicohome_%s_battery/config", slug)
	payload, _ = json.Marshal(battConfig)
	h.broker.Publish(battTopic, string(payload), true)

	log.Printf("[vicohome] 📡 HA Discovery publicado para %s (%s)", h.name, slug)
	return nil
}

// SendEvent publica un evento (motion, snapshot, tipo) en MQTT
func (h *HADiscoveryConfig) SendEvent(eventType string, snapJPG []byte, battery int) {
	slug := sanitizeID(h.cameraID)
	base := fmt.Sprintf("cambrige/vicohome/%s", slug)

	// Snapshot en base64 (HA lo muestra directamente)
	if len(snapJPG) > 0 {
		b64 := base64.StdEncoding.EncodeToString(snapJPG)
		h.broker.Publish(base+"/snapshot", b64, false)
	}

	// Motion ON
	h.broker.Publish(base+"/motion", "ON", false)

	// Tipo de evento
	h.broker.Publish(base+"/event_type", eventType, false)

	// Timestamp del evento
	h.broker.Publish(base+"/last_event", time.Now().Format(time.RFC3339), false)

	// Batería
	if battery >= 0 {
		h.broker.Publish(base+"/battery", fmt.Sprintf("%d", battery), false)
	}

	log.Printf("[vicohome] 📤 Evento publicado: %s → %s", h.cameraID, eventType)
}

func sanitizeID(id string) string {
	out := make([]byte, len(id))
	for i, c := range []byte(id) {
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' {
			out[i] = c
		} else if c >= 'A' && c <= 'Z' {
			out[i] = c + 32 // lowercase
		} else {
			out[i] = '_'
		}
	}
	return string(out)
}
