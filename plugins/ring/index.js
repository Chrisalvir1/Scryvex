const { RingApi } = require('ring-client-api');
const { RingRestClient: InternalRestClient } = require('ring-client-api/lib/api/rest-client');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '../../data/ring_session.json');

const readline = require('readline');

// --- IPC Utilities ---
function sendIPC(type, payload) {
    console.log(JSON.stringify({ type, payload }));
}

function log(msg) {
    console.log(`[RingPlugin] ${msg}`);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on('line', (line) => {
    if (!line) return;
    try {
        const msg = JSON.parse(line);
        log(`Received IPC: ${msg.type}`);
        // TODO: Handle auth message
    } catch(e) {}
});

async function start() {
    log("Iniciando plugin de Ring...");

    let sessions = {};
    if (fs.existsSync(SESSION_FILE)) {
        try { sessions = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch (e) {}
    }

    // Por ahora, asumimos que la cuenta principal ya fue logueada por el frontend
    // En una implementación completa de Scryvex 1.0, el plugin exportaría métodos RPC.
    // Buscamos la primera cuenta con token:
    let account = Object.values(sessions).find(s => s.token);
    
    if (!account || !account.token) {
        log("No hay sesión activa. Esperando configuración de usuario.");
        return;
    }

    log("Autenticando con token guardado...");
    const ringApi = new RingApi({ refreshToken: account.token });

    try {
        const locations = await ringApi.getLocations();
        
        for (const location of locations) {
            const cameras = await location.getCameras();
            
            for (const c of cameras) {
                // Emitir registro de dispositivo al DeviceBus de Go
                sendIPC("registerDevice", {
                    id: c.id.toString(),
                    name: c.name,
                    brand: "Ring",
                    interfaces: ["VideoCamera", "MotionSensor", "Battery", "TwoWayAudio"],
                    state: {
                        batteryLevel: c.batteryLevel || 100,
                        isOnline: !c.isOffline,
                        address: c.data.address
                    }
                });
                log(`Registrada cámara: ${c.name}`);
            }
        }
    } catch (err) {
        log(`Error fatal: ${err.message}`);
    }

    // Mantener el proceso vivo para eventos (ej. movimiento)
    setInterval(() => {}, 1000 * 60 * 60);
}

start();
