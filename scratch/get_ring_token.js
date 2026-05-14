const { RingApi } = require('ring-client-api');
const { RingRestClient } = require('ring-client-api/lib/api/rest-client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SESSION_FILE = '/Users/chrisalvir/Desktop/Scryvex/data/ring_session.json';

async function get_token() {
    const email = process.argv[2];
    const password = process.argv[3];
    const code = process.argv[4];

    console.log('DEBUG: Iniciando script para', email);

    if (!email || !password) {
        console.error('ERROR: Falta email o contraseña');
        process.exit(1);
    }

    process.removeAllListeners('warning');

    const timeout = setTimeout(() => {
        console.error('ERROR_TIMEOUT: Ring no responde o el código 2FA ha caducado.');
        process.exit(1);
    }, 45000);

    let sessionData = {};
    if (fs.existsSync(SESSION_FILE)) {
        try { sessionData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch (e) {}
    }

    if (!sessionData.hardware_id) {
        sessionData.hardware_id = crypto.randomBytes(16).toString('hex');
        fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionData));
    }

    console.log('DEBUG: Hardware ID:', sessionData.hardware_id);

    let restClient;
    try {
        const options = { 
            email, 
            password, 
            hardware_id: sessionData.hardware_id,
            controlCenterDisplayName: "Scryvex Bridge" 
        };

        restClient = new RingRestClient(options);
        
        let auth;
        try {
            console.log('DEBUG: Intentando getCurrentAuth()...');
            auth = await restClient.getCurrentAuth();
            console.log('DEBUG: Auth obtenido vía getCurrentAuth');
        } catch (e) {
            console.log('DEBUG: getCurrentAuth falló, revisando 2FA...');
            if (restClient.using2fa) {
                if (!code) {
                    console.error('ERROR_2FA_REQ: Se ha enviado un SMS/Email. Introduce el código 2FA.');
                    process.exit(1);
                } else {
                    console.log('DEBUG: Enviando código 2FA:', code);
                    auth = await restClient.getAuth(code);
                    console.log('DEBUG: Auth obtenido vía getAuth(code)');
                }
            } else {
                throw e;
            }
        }

        const token = auth.refresh_token;
        console.log('DEBUG: Token generado correctamente');

        if (!token) {
            console.error('ERROR_AUTH: No se pudo obtener el token.');
            process.exit(1);
        }

        sessionData.token = token;
        fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionData));

        console.log('SUCCESS_TOKEN:' + token);
        
        // Opcional: Obtener cámaras
        try {
            console.log('DEBUG: Obteniendo cámaras...');
            const ringApi = new RingApi({
                refreshToken: token,
                controlCenterDisplayName: "Scryvex Bridge"
            });
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
            console.log('REAL_CAMERAS:' + JSON.stringify(allCameras));
        } catch (e) {
            console.log('DEBUG: Error obteniendo cámaras (pero el token es válido):', e.message);
        }

        clearTimeout(timeout);
        process.exit(0);
    } catch (e) {
        clearTimeout(timeout);
        console.log('DEBUG: Error capturado:', e.message);
        const msg = (e.message || '').toLowerCase();
        if (msg.includes('2fa') || msg.includes('code') || msg.includes('verification') || (restClient && restClient.using2fa)) {
            console.error('ERROR_2FA: El código 2FA es inválido o ha expirado.');
        } else if (msg.includes('password') || msg.includes('auth') || msg.includes('401')) {
            console.error('ERROR_AUTH: Email o contraseña incorrectos.');
        } else {
            console.error('ERROR: ' + e.message);
        }
        process.exit(1);
    }
}

get_token();
