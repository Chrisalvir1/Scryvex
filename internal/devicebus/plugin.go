package devicebus

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"sync"
	"time"
)

// Define la estructura de un mensaje IPC (Inter-Process Communication)
type IPCMessage struct {
	Type    string          `json:"type"` // "register", "event", "request"
	Payload json.RawMessage `json:"payload"`
}

type PluginInstance struct {
	ID        string
	Script    string
	Cmd       *exec.Cmd
	Stdin     io.WriteCloser
	StartedAt time.Time
	StoppedAt time.Time
	LastError string
	Running   bool
	PID       int
}

type PluginManager struct {
	bus      *Manager
	nodePath string
	plugins  map[string]*PluginInstance
	mu       sync.RWMutex
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

	pm.mu.Lock()
	if existing, ok := pm.plugins[pluginID]; ok && existing.Running {
		pm.mu.Unlock()
		return nil
	}
	pm.mu.Unlock()

	if _, err := os.Stat(scriptPath); err != nil {
		return err
	}
	if _, err := exec.LookPath(pm.nodePath); err != nil {
		return fmt.Errorf("node no disponible: %w", err)
	}

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

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}

	if err := cmd.Start(); err != nil {
		pm.mu.Lock()
		pm.plugins[pluginID] = &PluginInstance{
			ID:        pluginID,
			Script:    scriptPath,
			LastError: err.Error(),
			Running:   false,
		}
		pm.mu.Unlock()
		return err
	}

	inst := &PluginInstance{
		ID:        pluginID,
		Script:    scriptPath,
		Cmd:       cmd,
		Stdin:     stdin,
		StartedAt: time.Now(),
		Running:   true,
		PID:       cmd.Process.Pid,
	}

	pm.mu.Lock()
	pm.plugins[pluginID] = inst
	pm.mu.Unlock()

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
		pm.mu.Lock()
		if p, ok := pm.plugins[pluginID]; ok {
			p.Running = false
			p.StoppedAt = time.Now()
			p.PID = 0
			if err != nil {
				p.LastError = err.Error()
			}
		}
		pm.mu.Unlock()
		log.Printf("⚠️ [PluginManager] Plugin %s detenido. ExitError: %v", pluginID, err)
	}()

	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			log.Printf("🔌 [%s:stderr] %s", pluginID, scanner.Text())
		}
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
	pm.mu.RLock()
	p, ok := pm.plugins[pluginID]
	if !ok || !p.Running || p.Stdin == nil {
		pm.mu.RUnlock()
		return os.ErrNotExist
	}
	stdin := p.Stdin
	pm.mu.RUnlock()

	b, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	b = append(b, '\n')
	_, err = stdin.Write(b)
	return err
}

func (pm *PluginManager) StopPlugin(pluginID string) error {
	pm.mu.RLock()
	p, ok := pm.plugins[pluginID]
	pm.mu.RUnlock()
	if !ok || !p.Running || p.Cmd == nil || p.Cmd.Process == nil {
		return os.ErrNotExist
	}
	if p.Stdin != nil {
		_ = p.Stdin.Close()
	}
	if err := p.Cmd.Process.Signal(os.Interrupt); err != nil {
		_ = p.Cmd.Process.Kill()
	}
	return nil
}

func (pm *PluginManager) RestartPlugin(pluginID string, scriptPath string) error {
	_ = pm.StopPlugin(pluginID)
	time.Sleep(300 * time.Millisecond)
	return pm.StartPlugin(pluginID, scriptPath)
}

func (pm *PluginManager) Status(pluginID string) PluginInstance {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	if p, ok := pm.plugins[pluginID]; ok {
		return *p
	}
	return PluginInstance{ID: pluginID}
}
