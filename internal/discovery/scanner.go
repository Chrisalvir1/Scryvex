package discovery

import (
	"bytes"
	"fmt"
	"log"
	"net"
	"os"
	"strings"
	"sync"
	"time"
)

// Device representa un dispositivo descubierto en la red
type Device struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	IP           string `json:"ip"`
	MAC          string `json:"mac"`
	Protocol     string `json:"protocol"`  // rtsp, onvif, ssdp, mdns
	StreamURL    string `json:"stream_url"`
	IsNativeRTSP bool   `json:"is_native_rtsp"`
	Manufacturer string `json:"manufacturer"`
}

// Scanner agrupa todos los motores de descubrimiento
type Scanner struct {
	mu      sync.Mutex
	found   map[string]*Device // deduplicado por IP
}

func NewScanner() *Scanner {
	return &Scanner{found: make(map[string]*Device)}
}

// ScanAll corre todos los métodos en paralelo y devuelve dispositivos únicos
func (s *Scanner) ScanAll() []*Device {
	s.found = make(map[string]*Device)

	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		log.Println("🔍 [Discovery] Iniciando WS-Discovery (ONVIF)...")
		s.wsDiscovery()
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		log.Println("🔍 [Discovery] Iniciando SSDP/UPnP...")
		s.ssdpDiscover()
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		log.Println("🔍 [Discovery] Iniciando escaneo TCP de puertos conocidos...")
		s.tcpPortScan()
	}()

	wg.Wait()

	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([]*Device, 0, len(s.found))
	for _, d := range s.found {
		result = append(result, d)
	}
	log.Printf("✅ [Discovery] Total dispositivos únicos: %d", len(result))
	return result
}

// ─── WS-Discovery (ONVIF estándar) ────────────────────────────
// Envía un probe UDP multicast a 239.255.255.250:3702
// Las cámaras ONVIF responden con su IP y servicio.
// Funciona a través de routers con multicast habilitado.
func (s *Scanner) wsDiscovery() {
	probe := `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
            xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
            xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>uuid:cambrige-probe-001</w:MessageID>
    <w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </e:Body>
</e:Envelope>`

	// Intentar en todas las interfaces de red locales (Wi-Fi, Ethernet, etc.)
	ifaces, _ := net.Interfaces()
	var ifaceWg sync.WaitGroup

	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		for _, addr := range addrs {
			ipnet, ok := addr.(*net.IPNet)
			if !ok || ipnet.IP.To4() == nil {
				continue
			}
			localIP := ipnet.IP.String()

			ifaceWg.Add(1)
			go func(lip string) {
				defer ifaceWg.Done()
				s.sendWSProbe(lip, probe)
			}(localIP)
		}
	}
	ifaceWg.Wait()
}

func (s *Scanner) sendWSProbe(localIP, probe string) {
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.ParseIP(localIP), Port: 0})
	if err != nil {
		return
	}
	defer conn.Close()

	// Dirección multicast ONVIF/WS-Discovery
	dst := &net.UDPAddr{IP: net.ParseIP("239.255.255.250"), Port: 3702}
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	conn.WriteToUDP([]byte(probe), dst)

	// Esperar respuestas durante 3 segundos
	buf := make([]byte, 4096)
	for {
		n, remoteAddr, err := conn.ReadFromUDP(buf)
		if err != nil {
			break
		}
		response := string(buf[:n])
		ip := remoteAddr.IP.String()

		name := extractXMLValue(response, "dn:Name")
		if name == "" {
			name = "Cámara ONVIF"
		}

		xaddr := extractXMLValue(response, "d:XAddrs")
		streamURL := ""
		if xaddr != "" {
			streamURL = strings.Split(xaddr, " ")[0]
		} else {
			streamURL = "rtsp://" + ip + ":554/stream1"
		}

		dev := &Device{
			ID:           "onvif-" + ip,
			Name:         name,
			IP:           ip,
			Protocol:     "onvif",
			StreamURL:    streamURL,
			IsNativeRTSP: true,
			Manufacturer: "ONVIF",
		}
		s.mu.Lock()
		s.found[ip] = dev
		s.mu.Unlock()
		log.Printf("✅ [WS-Discovery] Cámara ONVIF: %s @ %s", name, ip)
	}
}

// ─── SSDP/UPnP ────────────────────────────────────────────────
// Envía M-SEARCH al grupo multicast 239.255.255.250:1900
// Detecta cámaras con UPnP habilitado (algunas Tapo, Wyze, etc.)
func (s *Scanner) ssdpDiscover() {
	msg := "M-SEARCH * HTTP/1.1\r\n" +
		"HOST: 239.255.255.250:1900\r\n" +
		"MAN: \"ssdp:discover\"\r\n" +
		"MX: 3\r\n" +
		"ST: urn:schemas-upnp-org:device:MediaServer:1\r\n\r\n"

	conn, err := net.ListenUDP("udp4", &net.UDPAddr{Port: 0})
	if err != nil {
		return
	}
	defer conn.Close()

	dst := &net.UDPAddr{IP: net.ParseIP("239.255.255.250"), Port: 1900}
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	conn.WriteToUDP([]byte(msg), dst)

	buf := make([]byte, 2048)
	for {
		n, remoteAddr, err := conn.ReadFromUDP(buf)
		if err != nil {
			break
		}
		response := string(buf[:n])
		ip := remoteAddr.IP.String()

		if strings.Contains(strings.ToLower(response), "camera") ||
			strings.Contains(strings.ToLower(response), "ipcam") ||
			strings.Contains(strings.ToLower(response), "nvr") ||
			strings.Contains(strings.ToLower(response), "dvr") {

			dev := &Device{
				ID:           "ssdp-" + ip,
				Name:         "Cámara UPnP (" + ip + ")",
				IP:           ip,
				Protocol:     "ssdp",
				StreamURL:    "rtsp://" + ip + ":554/stream1",
				IsNativeRTSP: true,
				Manufacturer: "UPnP",
			}
			s.mu.Lock()
			if _, exists := s.found[ip]; !exists {
				s.found[ip] = dev
				log.Printf("✅ [SSDP] Dispositivo: %s", ip)
			}
			s.mu.Unlock()
		}
	}
}

// ─── TCP Port Scan (fallback rápido) ──────────────────────────
// Escanea los puertos estándar de cámaras en toda la subred.
// Detecta IPs de la interfaz local y escanea esa red.
func (s *Scanner) tcpPortScan() {
	prefixes := getLocalPrefixes()
	if len(prefixes) == 0 {
		prefixes = []string{"192.168.1."}
	}

	cameraPorts := []struct {
		port     int
		protocol string
	}{
		{554, "rtsp"},
		{8554, "rtsp"},
		{80, "http"},
		{8080, "http"},
		{2020, "onvif"},
	}

	var wg sync.WaitGroup
	sem := make(chan struct{}, 100) // máx 100 goroutines simultáneas

	for _, prefix := range prefixes {
		for i := 1; i < 255; i++ {
			ip := fmt.Sprintf("%s%d", prefix, i)
			wg.Add(1)
			sem <- struct{}{}
			go func(ip string) {
				defer wg.Done()
				defer func() { <-sem }()
				for _, p := range cameraPorts {
					conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", ip, p.port), 400*time.Millisecond)
					if err == nil {
						conn.Close()

						s.mu.Lock()
						if _, exists := s.found[ip]; !exists {
							s.found[ip] = &Device{
								ID:           "tcp-" + ip,
								Name:         fmt.Sprintf("Cámara (%s)", ip),
								IP:           ip,
								Protocol:     p.protocol,
								StreamURL:    fmt.Sprintf("rtsp://%s:554/stream1", ip),
								IsNativeRTSP: p.port == 554 || p.port == 8554,
							}
							log.Printf("✅ [TCP] Puerto %d abierto en %s", p.port, ip)
						}
						s.mu.Unlock()
						break
					}
				}
			}(ip)
		}
	}
	wg.Wait()
}

// getLocalPrefixes devuelve los prefijos de red locales (/24),
// ignorando las redes internas de Docker (172.x.x.x)
func getLocalPrefixes() []string {
	if subnet := os.Getenv("LAN_SUBNET"); subnet != "" {
		log.Printf("🌐 [Discovery] Usando subred forzada desde LAN_SUBNET: %s", subnet)
		return []string{subnet}
	}

	prefixes := []string{}
	seen := map[string]bool{}
	ifaces, _ := net.Interfaces()
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		for _, addr := range addrs {
			ipnet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ip4 := ipnet.IP.To4()
			if ip4 == nil || ip4[0] == 172 || ip4[0] == 127 {
				continue
			}
			parts := strings.Split(ip4.String(), ".")
			if len(parts) == 4 {
				prefix := fmt.Sprintf("%s.%s.%s.", parts[0], parts[1], parts[2])
				if !seen[prefix] {
					seen[prefix] = true
					prefixes = append(prefixes, prefix)
					log.Printf("🌐 [Discovery] Red local detectada: %s0/24", prefix)
				}
			}
		}
	}
	return prefixes
}

// extractXMLValue extrae el valor de una etiqueta XML simple
func extractXMLValue(xml, tag string) string {
	open := "<" + tag + ">"
	close := "</" + tag + ">"
	start := strings.Index(xml, open)
	if start == -1 {
		open = "<" + tag + " "
		start = strings.Index(xml, open)
		if start == -1 {
			return ""
		}
	}
	start += len(open)
	end := strings.Index(xml[start:], close)
	if end == -1 {
		return ""
	}
	_ = bytes.TrimSpace // keep import used
	return strings.TrimSpace(xml[start : start+end])
}
