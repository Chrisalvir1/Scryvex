// CamBridge Scanner Agent — corre DIRECTAMENTE en el host macOS (o Linux),
// NO dentro de Docker. Expone un endpoint HTTP que CamBridge puede llamar
// desde el contenedor via host.docker.internal:9876/scan
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type Device struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	IP           string `json:"ip"`
	MAC          string `json:"mac"`
	Protocol     string `json:"protocol"`
	StreamURL    string `json:"stream_url"`
	IsNativeRTSP bool   `json:"is_native_rtsp"`
	Manufacturer string `json:"manufacturer"`
}

var (
	mu    sync.Mutex
	found = map[string]*Device{}
)

func main() {
	port := "9876"
	if p := os.Getenv("SCANNER_PORT"); p != "" {
		port = p
	}

	http.HandleFunc("/scan", handleScan)
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		fmt.Fprint(w, `{"ok":true}`)
	})

	log.Printf("🔍 CamBridge Scanner Agent corriendo en :%s", port)
	log.Printf("   Llamar desde Docker: http://host.docker.internal:%s/scan", port)
	http.ListenAndServe(":"+port, nil)
}

func handleScan(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")

	mu.Lock()
	found = map[string]*Device{}
	mu.Unlock()

	var wg sync.WaitGroup

	// 1. WS-Discovery multicast ONVIF
	wg.Add(1)
	go func() { defer wg.Done(); wsDiscovery() }()

	// 2. TCP port scan en toda la subred local
	wg.Add(1)
	go func() { defer wg.Done(); tcpPortScan() }()

	wg.Wait()

	mu.Lock()
	devices := make([]*Device, 0, len(found))
	for _, d := range found {
		devices = append(devices, d)
	}
	mu.Unlock()

	log.Printf("✅ Scan completo: %d dispositivos encontrados", len(devices))
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "success",
		"cameras": devices,
	})
}

// ── WS-Discovery (ONVIF multicast) ────────────────────────────
func wsDiscovery() {
	probe := `<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
            xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
            xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>uuid:cambrige-agent-001</w:MessageID>
    <w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </e:Body>
</e:Envelope>`

	ifaces, _ := net.Interfaces()
	var ifWg sync.WaitGroup
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
			lip := ipnet.IP.String()
			ifWg.Add(1)
			go func(localIP string) {
				defer ifWg.Done()
				conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.ParseIP(localIP), Port: 0})
				if err != nil {
					return
				}
				defer conn.Close()
				dst := &net.UDPAddr{IP: net.ParseIP("239.255.255.250"), Port: 3702}
				conn.SetDeadline(time.Now().Add(4 * time.Second))
				conn.WriteToUDP([]byte(probe), dst)
				buf := make([]byte, 8192)
				for {
					n, remote, err := conn.ReadFromUDP(buf)
					if err != nil {
						break
					}
					resp := string(buf[:n])
					ip := remote.IP.String()
					name := xmlVal(resp, "dn:Name")
					if name == "" {
						name = "Cámara ONVIF"
					}
					xaddr := xmlVal(resp, "d:XAddrs")
					streamURL := "rtsp://" + ip + ":554/stream1"
					if xaddr != "" {
						streamURL = strings.Split(xaddr, " ")[0]
					}
					dev := &Device{
						ID: "onvif-" + ip, Name: name, IP: ip,
						Protocol: "onvif", StreamURL: streamURL,
						IsNativeRTSP: true, Manufacturer: "ONVIF",
					}
					mu.Lock()
					found[ip] = dev
					mu.Unlock()
					log.Printf("📷 ONVIF: %s @ %s", name, ip)
				}
			}(lip)
		}
	}
	ifWg.Wait()
}

// ── TCP Port Scan ──────────────────────────────────────────────
func tcpPortScan() {
	prefixes := getLocalPrefixes()
	if len(prefixes) == 0 {
		log.Println("⚠️  No se detectó ninguna subred local")
		return
	}

	cameraPorts := []struct{ port int; protocol string }{
		{554, "rtsp"}, {8554, "rtsp"}, {80, "http"},
		{8080, "http"}, {8000, "http"}, {2020, "onvif"},
	}

	var wg sync.WaitGroup
	sem := make(chan struct{}, 200)

	for _, prefix := range prefixes {
		log.Printf("🌐 Escaneando %s0/24 ...", prefix)
		for i := 1; i < 255; i++ {
			ip := fmt.Sprintf("%s%d", prefix, i)
			wg.Add(1)
			sem <- struct{}{}
			go func(ip string) {
				defer wg.Done()
				defer func() { <-sem }()
				for _, p := range cameraPorts {
					conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", ip, p.port), 600*time.Millisecond)
					if err == nil {
						conn.Close()
						mu.Lock()
						if _, exists := found[ip]; !exists {
							found[ip] = &Device{
								ID:       "tcp-" + ip,
								Name:     fmt.Sprintf("Dispositivo (%s:%d)", ip, p.port),
								IP:       ip, Protocol: p.protocol,
								StreamURL:    fmt.Sprintf("rtsp://%s:554/stream1", ip),
								IsNativeRTSP: p.port == 554 || p.port == 8554,
							}
							log.Printf("📷 TCP puerto %d abierto: %s", p.port, ip)
						}
						mu.Unlock()
						break
					}
				}
			}(ip)
		}
	}
	wg.Wait()
}

func getLocalPrefixes() []string {
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
			// Excluir loopback, link-local y docker (172.x, 169.254.x)
			if ip4 == nil || ip4[0] == 127 || ip4[0] == 172 {
				continue
			}
			if ip4[0] == 169 && ip4[1] == 254 {
				continue
			}
			parts := strings.Split(ip4.String(), ".")
			if len(parts) == 4 {
				prefix := fmt.Sprintf("%s.%s.%s.", parts[0], parts[1], parts[2])
				if !seen[prefix] {
					seen[prefix] = true
					prefixes = append(prefixes, prefix)
					log.Printf("🌐 Red detectada: %s0/24", prefix)
				}
			}
		}
	}
	return prefixes
}

func xmlVal(xml, tag string) string {
	open := "<" + tag + ">"
	start := strings.Index(xml, open)
	if start == -1 {
		return ""
	}
	start += len(open)
	end := strings.Index(xml[start:], "</"+tag+">")
	if end == -1 {
		return ""
	}
	return strings.TrimSpace(xml[start : start+end])
}
