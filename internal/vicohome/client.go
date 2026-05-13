package vicohome

import (
	"fmt"
	"time"
)

// Vicohome/Tuya Device Structure
type Device struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	IP        string `json:"ip"`
	MAC       string `json:"mac"`
	Online    bool   `json:"online"`
	StreamURL string `json:"stream_url"`
	IsNativeRTSP bool `json:"is_native_rtsp"` // True if it supports RTSP natively
	Battery   int    `json:"battery,omitempty"`
}

type Client struct {
	ClientID     string
	ClientSecret string
	Token        string
}

func NewClient(clientID, clientSecret string) *Client {
	return &Client{
		ClientID:     clientID,
		ClientSecret: clientSecret,
	}
}

// FetchDevices fetches devices from the Cloud. 
// If the device does not have native RTSP, it generates an HLS/WebRTC URL 
// that go2rtc will automatically convert to RTSP.
func (c *Client) FetchDevices(email, password string) ([]Device, error) {
	// TODO: Aquí iría la lógica criptográfica real de firma de Tuya (Tuya Sign)
	// Para propósitos de desarrollo y UI, simulamos la respuesta de la nube Tuya/Vicohome
	// asumiendo que hemos obtenido el token y consultado el endpoint /v1.0/users/{uid}/devices

	time.Sleep(1500 * time.Millisecond) // Simular latencia de red

	mockDevices := []Device{
		{
			ID:           "vico-front-123",
			Name:         "Vicohome Puerta Principal",
			IP:           "192.168.1.105",
			MAC:          "A4:C1:38:XX:XX:XX",
			Online:       true,
			StreamURL:    "webrtc://cloud.vicohome.com/stream/vico-front-123", // Protocolo propietario
			IsNativeRTSP: false, // Vicohome no suele tener RTSP nativo
			Battery:      82,
		},
		{
			ID:           "vico-back-456",
			Name:         "Vicohome Jardín",
			IP:           "192.168.1.110",
			MAC:          "A4:C1:38:YY:YY:YY",
			Online:       true,
			StreamURL:    "hls://cloud.vicohome.com/stream/vico-back-456/master.m3u8",
			IsNativeRTSP: false,
			Battery:      15, // Low battery
		},
	}

	return mockDevices, nil
}

// GenerateGo2RTCConfig converts the Tuya/Vicohome cloud stream into an RTSP stream
// by creating a configuration block for go2rtc. go2rtc will act as the transcoder.
func GenerateGo2RTCConfig(dev Device) string {
	if dev.IsNativeRTSP {
		return fmt.Sprintf("%s: %s", dev.ID, dev.StreamURL)
	}
	
	// Si no es RTSP nativo, usamos ffmpeg en go2rtc para convertir HLS/WebRTC a RTSP
	// El comando 'ffmpeg:' le dice a go2rtc que procese el stream.
	return fmt.Sprintf("%s: ffmpeg:%s#video=h264#audio=aac", dev.ID, dev.StreamURL)
}
