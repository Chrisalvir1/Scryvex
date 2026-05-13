// Package mqtt publica entidades de cámara via MQTT Discovery de Home Assistant
// Topics: homeassistant/camera/{id}/config, cambrige/{id}/motion, etc.
package mqtt

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"strings"
	"sync"
	"time"
)

// BrokerConfig configura la conexión MQTT
type BrokerConfig struct {
	Host            string
	Port            int
	User            string
	Password        string
	DiscoveryPrefix string // default: "homeassistant"
	ClientID        string
}

// CameraInfo datos de una cámara para publicar en HA
type CameraInfo struct {
	ID        string
	Name      string
	StreamURL string // URL del stream WebRTC/HLS servido por go2rtc
	Type      string // rtsp | onvif | tuya-cloud | matter-thread
}

// Publisher maneja publicaciones MQTT con reconexión automática
type Publisher struct {
	cfg      BrokerConfig
	conn     net.Conn
	mu       sync.Mutex
	msgQueue []mqttMsg
	cameras  map[string]CameraInfo
	running  bool
}

type mqttMsg struct {
	topic   string
	payload string
	retain  bool
	qos     byte
}

// NewPublisher crea un publisher MQTT con reconexión automática
func NewPublisher(cfg BrokerConfig) *Publisher {
	if cfg.Port == 0 {
		cfg.Port = 1883
	}
	if cfg.DiscoveryPrefix == "" {
		cfg.DiscoveryPrefix = "homeassistant"
	}
	if cfg.ClientID == "" {
		cfg.ClientID = "cambrige-bridge"
	}
	return &Publisher{
		cfg:     cfg,
		cameras: make(map[string]CameraInfo),
	}
}

// Start arranca el publisher con reconexión automática en goroutine
func (p *Publisher) Start() {
	p.running = true
	go p.loop()
}

func (p *Publisher) loop() {
	for p.running {
		if err := p.connect(); err != nil {
			log.Printf("[mqtt] no se pudo conectar a %s:%d — %v (reintentando en 15s)", p.cfg.Host, p.cfg.Port, err)
			time.Sleep(15 * time.Second)
			continue
		}
		log.Printf("[mqtt] conectado a %s:%d", p.cfg.Host, p.cfg.Port)

		// Re-publicar todos los discoveries al reconectar
		p.mu.Lock()
		for _, cam := range p.cameras {
			p.publishDiscovery(cam)
		}
		p.mu.Unlock()

		// Drainear cola de mensajes pendientes
		p.drainQueue()

		// Keep alive cada 30s
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			if err := p.sendPing(); err != nil {
				log.Printf("[mqtt] conexión perdida: %v — reconectando...", err)
				break
			}
		}
	}
}

// RegisterCamera registra una cámara y publica su discovery en HA
func (p *Publisher) RegisterCamera(cam CameraInfo) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.cameras[cam.ID] = cam
	p.publishDiscovery(cam)
}

// PublishMotion publica estado de movimiento ON/OFF
func (p *Publisher) PublishMotion(cameraID string, motion bool) {
	state := "OFF"
	if motion {
		state = "ON"
	}
	p.publish(fmt.Sprintf("cambrige/%s/motion", cameraID), state, false, 0)
}

// PublishDetection publica payload de detección IA completo
func (p *Publisher) PublishDetection(cameraID string, detections []map[string]interface{}) {
	data, _ := json.Marshal(map[string]interface{}{
		"camera_id":  cameraID,
		"detections": detections,
		"timestamp":  time.Now().Unix(),
	})
	p.publish(fmt.Sprintf("cambrige/%s/detection", cameraID), string(data), false, 0)
}

// PublishAvailability publica online/offline para una cámara
func (p *Publisher) PublishAvailability(cameraID string, online bool) {
	state := "offline"
	if online {
		state = "online"
	}
	p.publish(fmt.Sprintf("cambrige/%s/availability", cameraID), state, true, 1)
}

// PublishSnapshot publica URL del snapshot más reciente
func (p *Publisher) PublishSnapshot(cameraID, snapshotURL string) {
	p.publish(fmt.Sprintf("cambrige/%s/snapshot", cameraID), snapshotURL, false, 0)
}

// ── Discovery HA ──────────────────────────────────────────────────────────────
func (p *Publisher) publishDiscovery(cam CameraInfo) {
	pfx := p.cfg.DiscoveryPrefix
	camID := sanitizeID(cam.ID)

	// Device info compartido
	device := map[string]interface{}{
		"identifiers":   []string{"cambrige_" + camID},
		"name":          cam.Name,
		"model":         cam.Type,
		"manufacturer":  "CamBridge",
		"sw_version":    "0.1.0",
	}

	// 1. Camera entity (imagen MJPEG del snapshot)
	cameraConfig := map[string]interface{}{
		"name":                   cam.Name,
		"unique_id":              "cambrige_camera_" + camID,
		"topic":                  fmt.Sprintf("cambrige/%s/snapshot", cam.ID),
		"availability_topic":     fmt.Sprintf("cambrige/%s/availability", cam.ID),
		"payload_available":      "online",
		"payload_not_available":  "offline",
		"device":                 device,
	}
	if cam.StreamURL != "" {
		cameraConfig["stream_source"] = cam.StreamURL
		cameraConfig["content_type"]  = "video/mp4"
	}
	p.publishJSON(fmt.Sprintf("%s/camera/%s/config", pfx, camID), cameraConfig, true)

	// 2. Binary sensor — movimiento
	motionConfig := map[string]interface{}{
		"name":                  cam.Name + " Motion",
		"unique_id":             "cambrige_motion_" + camID,
		"device_class":          "motion",
		"state_topic":           fmt.Sprintf("cambrige/%s/motion", cam.ID),
		"payload_on":            "ON",
		"payload_off":           "OFF",
		"availability_topic":    fmt.Sprintf("cambrige/%s/availability", cam.ID),
		"payload_available":     "online",
		"payload_not_available": "offline",
		"off_delay":             30,
		"device":                device,
	}
	p.publishJSON(fmt.Sprintf("%s/binary_sensor/%s_motion/config", pfx, camID), motionConfig, true)

	// 3. Sensor — última detección IA
	detectionConfig := map[string]interface{}{
		"name":            cam.Name + " Detección",
		"unique_id":       "cambrige_detection_" + camID,
		"state_topic":     fmt.Sprintf("cambrige/%s/motion", cam.ID),
		"json_attributes_topic": fmt.Sprintf("cambrige/%s/detection", cam.ID),
		"availability_topic": fmt.Sprintf("cambrige/%s/availability", cam.ID),
		"payload_available":  "online",
		"payload_not_available": "offline",
		"icon":            "mdi:eye",
		"device":          device,
	}
	p.publishJSON(fmt.Sprintf("%s/sensor/%s_detection/config", pfx, camID), detectionConfig, true)

	// 4. Sensor — URL Matter QR
	qrConfig := map[string]interface{}{
		"name":        cam.Name + " Matter QR",
		"unique_id":   "cambrige_qr_" + camID,
		"state_topic": fmt.Sprintf("cambrige/%s/matter_qr", cam.ID),
		"icon":        "mdi:qrcode",
		"device":      device,
	}
	p.publishJSON(fmt.Sprintf("%s/sensor/%s_matter_qr/config", pfx, camID), qrConfig, true)

	// Publicar disponibilidad inicial
	p.publish(fmt.Sprintf("cambrige/%s/availability", cam.ID), "online", true, 1)
	log.Printf("[mqtt] Discovery publicado para: %s", cam.Name)
}

// ── Primitivas MQTT (implementación mínima sin lib externa) ──────────────────

func (p *Publisher) connect() error {
	addr := fmt.Sprintf("%s:%d", p.cfg.Host, p.cfg.Port)
	conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
	if err != nil {
		return err
	}

	// CONNECT packet
	clientID := []byte(p.cfg.ClientID)
	user     := []byte(p.cfg.User)
	pass     := []byte(p.cfg.Password)

	// Variable header + payload length
	varHeader := []byte{
		0x00, 0x04, 'M', 'Q', 'T', 'T', // Protocol name
		0x04,                             // Protocol level (3.1.1)
		0x02,                             // Connect flags: Clean session
		0x00, 0x3C,                       // Keep alive: 60s
	}
	if p.cfg.User != "" {
		varHeader[7] |= 0xC0 // user + password flags
	}

	payload := encodeString(clientID)
	if p.cfg.User != "" {
		payload = append(payload, encodeString(user)...)
		payload = append(payload, encodeString(pass)...)
	}

	packet := buildPacket(0x10, append(varHeader, payload...))
	if _, err := conn.Write(packet); err != nil {
		return err
	}

	// Leer CONNACK
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	buf := make([]byte, 4)
	if _, err := conn.Read(buf); err != nil {
		return fmt.Errorf("no CONNACK: %v", err)
	}
	if buf[0] != 0x20 || buf[3] != 0x00 {
		return fmt.Errorf("CONNACK error: %d", buf[3])
	}
	conn.SetReadDeadline(time.Time{})

	p.mu.Lock()
	p.conn = conn
	p.mu.Unlock()
	return nil
}

func (p *Publisher) sendPing() error {
	p.mu.Lock()
	conn := p.conn
	p.mu.Unlock()
	if conn == nil {
		return fmt.Errorf("no connection")
	}
	_, err := conn.Write([]byte{0xC0, 0x00}) // PINGREQ
	return err
}

func (p *Publisher) publish(topic, payload string, retain bool, qos byte) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.conn == nil {
		p.msgQueue = append(p.msgQueue, mqttMsg{topic, payload, retain, qos})
		return
	}

	t := []byte(topic)
	v := []byte(payload)

	varHeader := encodeString(t)
	if qos > 0 {
		varHeader = append(varHeader, 0x00, 0x01) // packet ID
	}

	fixedHeader := byte(0x30) // PUBLISH
	if retain {
		fixedHeader |= 0x01
	}
	if qos == 1 {
		fixedHeader |= 0x02
	}

	packet := buildPacket(fixedHeader, append(varHeader, v...))
	p.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if _, err := p.conn.Write(packet); err != nil {
		log.Printf("[mqtt] error publish %s: %v", topic, err)
		p.conn = nil
		p.msgQueue = append(p.msgQueue, mqttMsg{topic, payload, retain, qos})
	}
}

func (p *Publisher) publishJSON(topic string, v interface{}, retain bool) {
	data, _ := json.Marshal(v)
	p.publish(topic, string(data), retain, 0)
}

func (p *Publisher) drainQueue() {
	p.mu.Lock()
	queue := p.msgQueue
	p.msgQueue = nil
	p.mu.Unlock()
	for _, m := range queue {
		p.publish(m.topic, m.payload, m.retain, m.qos)
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func encodeString(s []byte) []byte {
	l := len(s)
	return append([]byte{byte(l >> 8), byte(l & 0xFF)}, s...)
}

func buildPacket(fixedHeader byte, data []byte) []byte {
	l := len(data)
	var lenBytes []byte
	for {
		encoded := byte(l % 128)
		l /= 128
		if l > 0 {
			encoded |= 128
		}
		lenBytes = append(lenBytes, encoded)
		if l == 0 {
			break
		}
	}
	return append(append([]byte{fixedHeader}, lenBytes...), data...)
}

func sanitizeID(id string) string {
	replacer := strings.NewReplacer(" ", "_", "-", "_", ".", "_", "/", "_")
	return strings.ToLower(replacer.Replace(id))
}
