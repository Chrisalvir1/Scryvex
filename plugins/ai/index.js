const ort = require('onnxruntime-node');
const sharp = require('sharp');
const path = require('path');

// --- IPC Utilities ---
function sendIPC(type, payload) {
    console.log(JSON.stringify({ type, payload }));
}

function log(msg) {
    console.log(`[AI:YOLO11] ${msg}`);
}

let session = null;

async function loadModel() {
    try {
        const modelPath = path.join(__dirname, '../../data/models/yolo11n.onnx');
        log(`Cargando modelo YOLO11 desde ${modelPath}...`);
        session = await ort.InferenceSession.create(modelPath);
        log("✅ Modelo YOLO11 cargado correctamente.");
        
        sendIPC("registerDevice", {
            id: "scryvex-ai-engine",
            name: "Scryvex AI Engine (YOLO11)",
            brand: "Scryvex",
            interfaces: ["MotionSensor"],
            state: { engine: "YOLO11", provider: "ONNX Runtime" }
        });
    } catch (e) {
        log(`❌ Error cargando modelo: ${e.message}`);
        log("Nota: Asegúrate de que yolo11n.onnx esté en data/models/");
    }
}

async function processFrame(buffer) {
    if (!session) return;
    
    // 1. Pre-procesar imagen con sharp (640x640 para YOLO)
    const { data, info } = await sharp(buffer)
        .resize(640, 640)
        .raw()
        .toBuffer({ resolveWithObject: true });

    // 2. Ejecutar inferencia (Simplificado)
    // const input = new ort.Tensor('float32', new Float32Array(data), [1, 3, 640, 640]);
    // const results = await session.run({ images: input });
    
    // 3. Emitir evento si hay detección
    // sendIPC("updateState", { id: "scryvex-ai-engine", motionDetected: true });
}

loadModel();

// Mantener vivo
setInterval(() => {}, 1000 * 60);
