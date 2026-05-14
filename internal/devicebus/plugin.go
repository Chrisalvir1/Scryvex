package devicebus

import (
	"bufio"
	"encoding/json"
	"io"
	"log"
	"os"
	"os/exec"
)

// Define la estructura de un mensaje IPC (Inter-Process Communication)
type IPCMessage struct {
	Type    string          `json:"type"` // "register", "event", "request"
	Payload json.RawMessage `json:"payload"`
}

type PluginInstance struct {
	ID    string
	Cmd   *exec.Cmd
	Stdin io.WriteCloser
}

type PluginManager struct {
	bus      *Manager
	nodePath string
	plugins  map[string]*PluginInstance
}

func NewPluginManager(bus *Manager) *PluginManager {
	return &PluginManager{
		bus:      bus,
		nodePath: "node",
		plugins:  make(map[string]*PluginInstance),
	}
}

// Inicia un plugin de Node.js como subproceso
func (pm *PluginManager) StartPlugin(pluginID string, scriptPath string) error {
	log.Printf("🚀 [PluginManager] Iniciando plugin: %s (%s)", pluginID, scriptPath)

	cmd := exec.Command(pm.nodePath, scriptPath)
	
	// Configurar tuberías (pipes) para comunicación
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	
	// Los errores los enviamos al log estándar
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return err
	}

	pm.plugins[pluginID] = &PluginInstance{
		ID:    pluginID,
		Cmd:   cmd,
		Stdin: stdin,
	}

	// Hilo de lectura: escucha los mensajes JSON que emite el plugin (Stdout)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			
			// Si la línea empieza con { asumo que es JSON RPC
			if len(line) > 0 && line[0] == '{' {
				var msg IPCMessage
				if err := json.Unmarshal([]byte(line), &msg); err != nil {
					log.Printf("⚠️ [Plugin: %s] Error parseando IPC: %v", pluginID, err)
					continue
				}
				pm.handleMessage(pluginID, msg)
			} else {
				// Logs normales del plugin
				log.Printf("🔌 [%s] %s", pluginID, line)
			}
		}
		
		err := cmd.Wait()
		log.Printf("⚠️ [PluginManager] Plugin %s detenido. ExitError: %v", pluginID, err)
	}()

	return nil
}

func (pm *PluginManager) handleMessage(pluginID string, msg IPCMessage) {
	switch msg.Type {
	case "registerDevice":
		var dev Device
		if err := json.Unmarshal(msg.Payload, &dev); err == nil {
			dev.PluginID = pluginID
			pm.bus.UpsertDevice(&dev)
		} else {
			log.Printf("⚠️ Error registrando dispositivo desde %s: %v", pluginID, err)
		}
	case "updateState":
		// TODO: Lógica para actualizar batería, sensores, etc.
	default:
		log.Printf("⚠️ [%s] Mensaje IPC desconocido: %s", pluginID, msg.Type)
	}
}

func (pm *PluginManager) SendIPC(pluginID string, msg IPCMessage) error {
	p, ok := pm.plugins[pluginID]
	if !ok {
		return os.ErrNotExist
	}
	b, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	b = append(b, '\n')
	_, err = p.Stdin.Write(b)
	return err
}
