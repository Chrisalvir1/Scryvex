package devicebus

import (
	"log"
	"sync"
)

// Interfaz unificada (al estilo Scrypted)
type Interface string

const (
	VideoCamera  Interface = "VideoCamera"
	MotionSensor Interface = "MotionSensor"
	Battery      Interface = "Battery"
	AudioSensor  Interface = "AudioSensor"
)

// Representa un dispositivo gestionado por un plugin
type Device struct {
	ID         string                 `json:"id"`
	PluginID   string                 `json:"pluginId"`
	Name       string                 `json:"name"`
	Brand      string                 `json:"brand"`
	Interfaces []Interface            `json:"interfaces"`
	State      map[string]interface{} `json:"state"` // Estado dinámico (ej. batería, movimiento)
}

type Manager struct {
	mu      sync.RWMutex
	devices map[string]*Device
}

// Inicializa el DeviceBus central
func NewManager() *Manager {
	return &Manager{
		devices: make(map[string]*Device),
	}
}

// Registra o actualiza un dispositivo en el Bus
func (m *Manager) UpsertDevice(dev *Device) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	if dev.State == nil {
		dev.State = make(map[string]interface{})
	}
	
	m.devices[dev.ID] = dev
	log.Printf("[DeviceBus] 📡 Dispositivo registrado: %s (%s) [Plugin: %s]", dev.Name, dev.ID, dev.PluginID)
}

// Retorna todos los dispositivos (para la UI y Matter)
func (m *Manager) GetDevices() []*Device {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var list []*Device
	for _, d := range m.devices {
		list = append(list, d)
	}
	return list
}
