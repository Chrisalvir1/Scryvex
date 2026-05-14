const express = require('express');
const { RingApi } = require('ring-client-api');
const { RingRestClient: InternalRestClient } = require('ring-client-api/lib/api/rest-client');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const SESSION_FILE = '/Users/chrisalvir/Desktop/Scryvex/data/ring_session.json';
let sessions = {};
let activeClients = {}; 
let isProcessing = {}; // Bloqueo por email para evitar colisiones de 2FA

if (fs.existsSync(SESSION_FILE)) {
    try { sessions = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch (e) {}
}

app.post('/auth', async (req, res) => {
    const { email, password, code } = req.body;
    
    if (isProcessing[email]) {
        console.log(`[RingAgent] ⚠️ Ya hay una solicitud en curso para ${email}. Ignorando.`);
        return res.status(429).json({ ok: false, error: 'BUSY', message: 'Ya estamos procesando tu solicitud, espera...' });
    }

    isProcessing[email] = true;
    
    try {
        console.log(`[RingAgent] >>> Solicitud para ${email} | Código: ${code || '---'}`);

        let restClient = activeClients[email];
        if (!restClient) {
            console.log(`[RingAgent] Creando cliente persistente para ${email}`);
            const hardware_id = sessions[email]?.hardware_id || crypto.randomUUID();
            console.log(`[RingAgent] Hardware ID: ${hardware_id}`);
            restClient = new InternalRestClient({ 
                email, 
                password, 
                hardware_id,
                controlCenterDisplayName: "Scryvex Home Hub" 
            });
            activeClients[email] = restClient;
            sessions[email] = { hardware_id };
            fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions));
        }

        let auth;
        if (code) {
            console.log(`[RingAgent] Enviando código 2FA a Amazon...`);
            // Timeout de 50s para la validación (Amazon puede ser muy lento)
            const authPromise = restClient.getAuth(code);
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('AMAZON_TIMEOUT')), 50000));
            
            auth = await Promise.race([authPromise, timeoutPromise]);
            console.log(`[RingAgent] Amazon aceptó el código.`);
        } else {
            console.log(`[RingAgent] Verificando estado de sesión...`);
            try {
                auth = await restClient.getCurrentAuth();
                console.log(`[RingAgent] Sesión recuperada.`);
            } catch (e) {
                if (restClient.using2fa) {
                    console.log(`[RingAgent] 2FA Requerido por Amazon.`);
                    isProcessing[email] = false;
                    return res.json({ ok: false, error: 'ERROR_2FA_REQ' });
                }
                throw e;
            }
        }

        const token = auth.refresh_token;
        sessions[email].token = token;
        fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions));

        console.log(`[RingAgent] Obteniendo lista de cámaras...`);
        const ringApi = new RingApi({ refreshToken: token });
        
        const locations = await ringApi.getLocations();
        const allCameras = [];
        for (const location of locations) {
            const cameras = await location.getCameras();
            cameras.forEach(c => {
                allCameras.push({
                    id: c.id,
                    name: c.name,
                    ip: c.data.address || 'Cloud-Only', 
                    battery: c.batteryLevel || 100,
                    model: c.model
                });
            });
        }

        console.log(`[RingAgent] Login completo. Enviando cámaras.`);
        isProcessing[email] = false;
        res.json({ ok: true, token, cameras: allCameras });

    } catch (e) {
        console.error(`[RingAgent] ❌ Error Crítico: ${e.message}`);
        isProcessing[email] = false;
        
        // Si hay error de auth o timeout, reseteamos el cliente para la próxima
        if (e.message.includes('401') || e.message.includes('TIMEOUT') || e.message.includes('auth')) {
            console.log(`[RingAgent] Reseteando cliente debido a error.`);
            delete activeClients[email];
        }
        
        res.status(400).json({ ok: false, error: e.message });
    }
});

const PORT = 1997;
app.listen(PORT, () => {
    console.log(`🚀 Scryvex Ring Agent (v2.1) activo en puerto ${PORT}`);
});
