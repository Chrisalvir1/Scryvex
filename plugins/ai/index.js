const ort = require('onnxruntime-node');
const sharp = require('sharp');
const path = require('path');
const http = require('http');

// --- Configuración Scryvex 1.0 AI ---
const MODEL_PATH = path.join(__dirname, '../../data/models/yolo11n.onnx');
const DETECT_CLASSES = {
    0: 'Persona',
    2: 'Vehículo', 3: 'Vehículo', 5: 'Vehículo', 7: 'Vehículo', // Coche, Moto, Bus, Camión
    15: 'Animal', 16: 'Animal', // Gato, Perro
    24: 'Entrega/Paquete', 26: 'Entrega/Paquete', 28: 'Entrega/Paquete' // Mochila, Bolso, Maleta
};

function sendIPC(type, payload) {
    console.log(JSON.stringify({ type, payload }));
}

function log(msg) {
    console.log(`[AI:YOLO11] ${msg}`);
}

let session = null;

async function init() {
    try {
        log("Iniciando motor YOLO11...");
        session = await ort.InferenceSession.create(MODEL_PATH, {
            executionProviders: ['cpu'], // En Mac se puede usar 'coreml' si está compilado, por ahora CPU es muy rápido para 11n
        });
        log("✅ YOLO11 cargado y listo.");

        sendIPC("registerDevice", {
            id: "scryvex-ai-v1",
            name: "Scryvex AI Engine",
            brand: "Scryvex",
            interfaces: ["MotionSensor"],
            state: { engine: "YOLO11", status: "online" }
        });

        // Simular suscripción al stream principal de go2rtc
        startInferenceLoop();
    } catch (e) {
        log(`❌ Error: ${e.message}`);
        log("Asegúrate de haber descargado yolo11n.onnx en data/models/");
    }
}

async function startInferenceLoop() {
    // En producción, esto se conectaría al MJPEG de go2rtc (http://localhost:1984/api/stream.mjpeg?src=...)
    // Por ahora, dejamos la lógica de inferencia preparada para procesar frames
    log("Esperando flujo de video para análisis...");
}

async function analyzeFrame(buffer) {
    if (!session) return;

    try {
        // 1. Preprocesar para YOLO (640x640, RGB, Normalizado)
        const { data, info } = await sharp(buffer)
            .resize(640, 640, { fit: 'fill' })
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const input = new Float32Array(3 * 640 * 640);
        for (let i = 0; i < data.length; i += 3) {
            input[i / 3] = data[i] / 255.0;
            input[i / 3 + 640 * 640] = data[i + 1] / 255.0;
            input[i / 3 + 2 * 640 * 640] = data[i + 2] / 255.0;
        }

        const tensor = new ort.Tensor('float32', input, [1, 3, 640, 640]);
        const output = await session.run({ images: tensor });
        
        // 2. Procesar Boxes y Scores (Simplificado para Scryvex 1.0)
        // Buscamos la clase con mayor confianza que esté en nuestro mapa
        const detections = processYOLOOutput(output); 
        
        if (detections.length > 0) {
            const best = detections[0];
            log(`Detección: ${best.label} (${(best.score * 100).toFixed(1)}%)`);
            
            sendIPC("updateState", {
                id: "scryvex-ai-v1",
                motion: true,
                detectionType: best.label,
                score: best.score
            });
        }
    } catch (e) {
        log(`Error en inferencia: ${e.message}`);
    }
}

function processYOLOOutput(output) {
    // Lógica interna para decodificar tensores de YOLOv11
    // Devuelve un array de { label, score, box }
    // Implementación resumida para la demostración técnica:
    return []; 
}

init();
