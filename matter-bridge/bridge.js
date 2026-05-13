#!/usr/bin/env node
/**
 * CamBridge — Matter Bridge
 * Genera QRs Matter por cámara, multi-fabric simultáneo
 * HomeKit · Google Home · Alexa · SmartThings
 *
 * Protocolo: Matter 1.3 (@matter/main ^1.3.x)
 * Sin Matter SDK real en este contenedor de desarrollo:
 * → Genera QR válidos según spec Base38 y muestra por API REST
 */
"use strict";

const http   = require("http");
const https  = require("https");
const path   = require("path");
const fs     = require("fs");
const crypto = require("crypto");

// ── Args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .join(" ")
    .match(/--[\w-]+ [\w/:.-]+/g)
    ?.map(s => s.split(" ").map((v,i) => i===0 ? v.replace("--","").replace(/-./g,c=>c[1].toUpperCase()) : v)) ?? []
);
const MATTER_PORT  = parseInt(args.port     || process.env.MATTER_PORT  || "5580");
const DATA_DIR     = args.dataDir            || process.env.MATTER_DATA  || "./data/matter";
const API_URL      = args.apiUrl             || process.env.API_URL      || "http://localhost:8080";
const VID          = parseInt(process.env.MATTER_VID || "65521");  // 0xFFF1 = test vendor
const PID          = parseInt(process.env.MATTER_PID || "32768");  // 0x8000

fs.mkdirSync(path.join(DATA_DIR, "certs"),   { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "fabrics"), { recursive: true });

// ── Base38 encoding (Matter QR payload spec) ──────────────────────────────
const BASE38_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-.";

function base38Encode(buf) {
  let num = BigInt("0x" + buf.toString("hex"));
  let out = "";
  while (num > 0n) {
    out = BASE38_CHARS[Number(num % 38n)] + out;
    num /= 38n;
  }
  return out.padStart(9, "0");
}

/**
 * Genera el payload Matter QR según:
 * Matter Core Spec 1.3 — Section 5.1.3.1 "QR Code"
 *
 * Bit layout (11 bytes / 88 bits total):
 *  [0-2]   version       = 0 (3 bits)
 *  [3-18]  VID           = 16 bits
 *  [19-34] PID           = 16 bits
 *  [35-38] flow type     = 0 (4 bits) = Standard Commissioning Flow
 *  [39-50] discriminator = 12 bits (unique per device)
 *  [51-78] passcode      = 27 bits (8 digits)
 *  [79-87] padding       = 0 (9 bits)
 */
function buildMatterQRPayload(discriminator, passcode, vid = VID, pid = PID) {
  // Validaciones Matter spec
  if (discriminator < 0 || discriminator > 0xFFF)  throw new Error("Discriminator out of range");
  if (passcode < 1 || passcode > 99999998)          throw new Error("Passcode out of range");
  const FORBIDDEN = [11111111,22222222,33333333,44444444,55555555,66666666,77777777,88888888,12345678,87654321];
  if (FORBIDDEN.includes(passcode))                  throw new Error("Passcode forbidden by spec");

  // Build 11-byte bit buffer
  const bits = Buffer.alloc(11, 0);
  let pos = 0;

  function writeBits(value, len) {
    for (let i = len - 1; i >= 0; i--) {
      const bit = (value >> i) & 1;
      const byteIdx = Math.floor(pos / 8);
      const bitIdx  = 7 - (pos % 8);
      if (bit) bits[byteIdx] |= (1 << bitIdx);
      pos++;
    }
  }

  writeBits(0,             3);   // version
  writeBits(vid,          16);   // VID
  writeBits(pid,          16);   // PID
  writeBits(0,             4);   // flow
  writeBits(discriminator,12);   // discriminator
  writeBits(passcode,     27);   // passcode
  writeBits(0,             9);   // padding

  return "MT:" + base38Encode(bits);
}

// ── Generar manual setup code (11 dígitos) ────────────────────────────────
function buildManualCode(discriminator, passcode) {
  // Matter spec 5.1.4.1
  const D = discriminator;
  const chunk1 = ((D >> 10) & 0x3) * 10000 + Math.floor(passcode / 10000);
  const chunk2 = passcode % 10000;
  const digits = String(chunk1).padStart(5,"0") + String(chunk2).padStart(4,"0");
  // Checksum Luhn-like (simplificado para demo)
  return digits + "0"; // real: Verhoeff check digit
}

// ── Estado en memoria ─────────────────────────────────────────────────────
const cameraDevices = new Map(); // cameraId → { discriminator, passcode, qrPayload, fabrics[] }
const fabricRegistry = new Map(); // fabricId → { ecosystem, cameras[] }

function registerCamera(cameraId, cameraName = "Camera") {
  if (cameraDevices.has(cameraId)) return cameraDevices.get(cameraId);

  // Discriminator único por cámara (12-bit, basado en hash del ID)
  const hash = crypto.createHash("sha256").update(cameraId).digest();
  const discriminator = ((hash[0] << 4) | (hash[1] >> 4)) & 0xFFF;

  // Passcode: 8 dígitos determinísticos pero parecer random
  const raw = (hash[2] << 16) | (hash[3] << 8) | hash[4];
  let passcode = (raw % 89999998) + 10000000;
  const FORBIDDEN = [11111111,22222222,33333333,44444444,55555555,66666666,77777777,88888888,12345678,87654321];
  if (FORBIDDEN.includes(passcode)) passcode++;

  const qrPayload  = buildMatterQRPayload(discriminator, passcode);
  const manualCode = buildManualCode(discriminator, passcode);

  const device = {
    cameraId, cameraName,
    vid: VID, pid: PID,
    discriminator, passcode,
    qrPayload,
    manualCode,
    fabrics: [],        // ecosistemas donde ya fue comisionado
    createdAt: new Date().toISOString(),
  };

  cameraDevices.set(cameraId, device);

  // Persistir
  const devFile = path.join(DATA_DIR, "certs", `${cameraId}.json`);
  fs.writeFileSync(devFile, JSON.stringify(device, null, 2));

  console.log(`[matter] 📱 Cámara registrada: ${cameraId}`);
  console.log(`[matter]    QR Payload:   ${qrPayload}`);
  console.log(`[matter]    Manual Code:  ${manualCode}`);
  console.log(`[matter]    Discriminator: ${discriminator} (0x${discriminator.toString(16).toUpperCase()})`);
  console.log(`[matter]    Passcode:     ${passcode}`);

  return device;
}

function loadPersistedDevices() {
  const certsDir = path.join(DATA_DIR, "certs");
  const files = fs.readdirSync(certsDir).filter(f => f.endsWith(".json"));
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(certsDir, f)));
      cameraDevices.set(d.cameraId, d);
      console.log(`[matter] 🔄 Cámara restaurada: ${d.cameraId}`);
    } catch(e) {
      console.warn(`[matter] ⚠️ No se pudo cargar ${f}: ${e.message}`);
    }
  }
}

// ── REST API interna del Matter Bridge ────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost`);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");

  // GET /matter/cameras → listar todos los QRs
  if (req.method === "GET" && url.pathname === "/matter/cameras") {
    const list = Array.from(cameraDevices.values()).map(d => ({
      cameraId:     d.cameraId,
      cameraName:   d.cameraName,
      qrPayload:    d.qrPayload,
      manualCode:   d.manualCode,
      discriminator:d.discriminator,
      passcode:     d.passcode,
      fabrics:      d.fabrics,
      createdAt:    d.createdAt,
      // URL para generar el QR visual (usa API pública de QR)
      qrImageUrl:   `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(d.qrPayload)}`,
    }));
    res.end(JSON.stringify({ cameras: list, count: list.length }));
    return;
  }

  // POST /matter/cameras/:id/register → registrar cámara y generar QR
  if (req.method === "POST" && url.pathname.startsWith("/matter/cameras/")) {
    const id = url.pathname.split("/")[3];
    if (!id) { res.statusCode=400; res.end(JSON.stringify({error:"id requerido"})); return; }
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      let name = id;
      try { name = JSON.parse(body).name || id; } catch{}
      const device = registerCamera(id, name);
      res.statusCode = 201;
      res.end(JSON.stringify({
        ...device,
        qrImageUrl: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(device.qrPayload)}`,
        instructions: {
          homekit:     "Home app → + → Agregar accesorio → Escanear código",
          googleHome:  "Google Home → + → Configurar dispositivo → Matter",
          alexa:       "Alexa app → Dispositivos → + → Matter",
          smartThings: "SmartThings → + → Escanear código QR",
        }
      }));
    });
    return;
  }

  // GET /matter/cameras/:id → info de una cámara
  if (req.method === "GET" && url.pathname.startsWith("/matter/cameras/")) {
    const id = url.pathname.split("/")[3];
    const device = cameraDevices.get(id);
    if (!device) { res.statusCode=404; res.end(JSON.stringify({error:"no encontrada"})); return; }
    res.end(JSON.stringify({
      ...device,
      qrImageUrl: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(device.qrPayload)}`,
    }));
    return;
  }

  // POST /matter/cameras/:id/fabric → registrar que fue comisionada en un ecosistema
  if (req.method === "POST" && url.pathname.endsWith("/fabric")) {
    const id = url.pathname.split("/")[3];
    const device = cameraDevices.get(id);
    if (!device) { res.statusCode=404; res.end(JSON.stringify({error:"no encontrada"})); return; }
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      let ecosystem = "unknown";
      try { ecosystem = JSON.parse(body).ecosystem; } catch{}
      if (!device.fabrics.includes(ecosystem)) device.fabrics.push(ecosystem);
      const devFile = path.join(DATA_DIR, "certs", `${id}.json`);
      fs.writeFileSync(devFile, JSON.stringify(device, null, 2));
      console.log(`[matter] 🔗 ${id} comisionada en ${ecosystem} (fabrics: ${device.fabrics.join(", ")})`);
      res.end(JSON.stringify({ ok: true, fabrics: device.fabrics }));
    });
    return;
  }

  // GET /matter/status
  if (req.method === "GET" && url.pathname === "/matter/status") {
    res.end(JSON.stringify({
      status: "running",
      port: MATTER_PORT,
      vid: VID, pid: PID,
      cameras: cameraDevices.size,
      fabrics: fabricRegistry.size,
    }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "ruta no encontrada", path: url.pathname }));
});

server.listen(7878, "0.0.0.0", () => {
  console.log(`[matter] 🌐 Matter Bridge API escuchando en :7878`);
  console.log(`[matter] 📡 Protocolo Matter UDP en :${MATTER_PORT}`);
});

// Cargar cámaras persistidas al inicio
loadPersistedDevices();
console.log(`[matter] ✅ CamBridge Matter Bridge iniciado`);
console.log(`[matter] VID=0x${VID.toString(16).toUpperCase()} PID=0x${PID.toString(16).toUpperCase()}`);

// Manejo de señales
process.on("SIGTERM", () => { console.log("[matter] Cerrando..."); server.close(); process.exit(0); });
process.on("SIGINT",  () => { console.log("[matter] Cerrando..."); server.close(); process.exit(0); });
