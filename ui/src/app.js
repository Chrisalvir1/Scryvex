// Scryvex UI v0.2.0 — app.js con Auth
const API = '';

// ── Auth State ────────────────────────────────────────────────
let authToken = localStorage.getItem('cb_token') || '';
let authUser  = JSON.parse(localStorage.getItem('cb_user') || 'null');

function getHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken };
}

// ── State ─────────────────────────────────────────────────────
let cameras = [];
let currentType = 'rtsp';
let aiEnabled = true;

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Bypass authentication for Scryvex native version
  authToken = 'scryvex-local-token';
  authUser = { username: 'admin', role: 'admin' };
  bootApp();
});

function bootApp() {
  // Mostrar nombre de usuario en sidebar
  const userEl = document.getElementById('sidebar-user');
  if (userEl && authUser) {
    const avatar = authUser.avatar_url ? `<img src="${authUser.avatar_url}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">` : `<div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700">${authUser.username[0].toUpperCase()}</div>`;
    userEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid rgba(255,255,255,0.08);margin-top:auto;cursor:pointer" onclick="openProfileModal()">
        ${avatar}
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" id="side-username">${authUser.username}</div>
          <div style="font-size:11px;color:var(--text3)">${authUser.role === 'admin' ? '👑 Admin' : '👁 Viewer'}</div>
        </div>
        <button onclick="event.stopPropagation(); logout()" title="Cerrar sesión" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:16px;padding:4px">⏏</button>
      </div>`;
  }
  tickClock();
  setInterval(tickClock, 1000);
  fetchStatus();
  setInterval(fetchStatus, 15000);
  
  // Mostrar/ocultar opciones admin
  if (authUser && authUser.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
  }
}


function tickClock() {
  const el = document.getElementById('sys-time');
  if (el) el.textContent = new Date().toLocaleTimeString('es', { hour12: false });
}

// ── Navigation ────────────────────────────────────────────────
function showPage(name, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  if (el) el.classList.add('active');
  document.getElementById('page-title').textContent = {
    dashboard: 'Dashboard',
    cameras:   'Cámaras',
    discover:  'Descubrir',
    homekit:   'HomeKit / Matter',
    settings:  'Configuración'
  }[name] || name;
  // Close sidebar on mobile
  if (window.innerWidth < 900) document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ── API calls ─────────────────────────────────────────────────
async function fetchStatus() {
  try {
    const res = await fetch(API + '/api/status');
    const data = await res.json();
    setOnline(true);
    document.getElementById('stat-ver').textContent = data.version || '0.1.0';
  } catch {
    setOnline(false);
  }
  await fetchCameras();
}

function setOnline(on) {
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  const svcDot = document.querySelector('#svc-api .svc-dot');
  const svcSt  = document.querySelector('#svc-api .svc-status');
  dot.className  = 'status-dot ' + (on ? 'online' : 'offline');
  text.textContent = on ? 'En línea' : 'Sin conexión';
  if (svcDot) svcDot.className = 'svc-dot ' + (on ? 'up' : 'down');
  if (svcSt)  svcSt.textContent = on ? 'Activo' : 'Error';
  document.getElementById('stat-online').textContent = on ? 'Online' : 'Offline';
}

async function fetchCameras() {
  try {
    const res = await fetch(API + '/api/cameras');
    cameras = await res.json();
  } catch {
    cameras = JSON.parse(localStorage.getItem('cb_cameras') || '[]');
  }
  renderCameras();
}

function renderCameras() {
  const count = cameras.length;
  document.getElementById('cam-count').textContent = count;
  document.getElementById('stat-cams').textContent = count;
  document.getElementById('stat-hk').textContent = cameras.filter(c => c.homekit).length;

  renderCameraList('cameras-list');
  renderCameraList('dash-cams');
  renderQRGrid();
}

function renderCameraList(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (cameras.length === 0) {
    el.innerHTML = `<div class="empty-state glass">
      <svg viewBox="0 0 24 24"><path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z"/></svg>
      <p>No hay cámaras configuradas.</p>
      <button class="btn-primary" onclick="openAddCamera()">+ Agregar cámara</button>
    </div>`;
    return;
  }

  // Grouping by brand (or RTSP/HLS)
  const grouped = {};
  cameras.forEach(c => {
    const group = c.brand || (c.type === 'rtsp' ? 'RTSP/ONVIF' : c.type === 'hls' ? 'HLS' : 'Otras');
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(c);
  });

  let html = '';
  for (const [group, cams] of Object.entries(grouped)) {
    html += `
    <div style="grid-column: 1 / -1; margin-top: 16px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
      <h3 style="font-size: 16px; font-weight: 600; color: var(--text2); display: flex; align-items: center; gap: 8px;">
        <svg style="width:18px;height:18px;fill:var(--text3)" viewBox="0 0 24 24"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>
        ${group}
      </h3>
      <button class="btn-secondary" style="padding: 4px 10px; font-size: 11px;" onclick="toast('Actualizando ${group}...', 'success'); renderCameras()">⟳ Recargar</button>
    </div>`;
    
    html += cams.map((c) => {
      const i = cameras.indexOf(c);
      return `
      <div class="camera-card" id="card-${i}">
        <div class="cam-preview" style="cursor:pointer" onclick="openCameraSettings(${i})">
          <svg viewBox="0 0 24 24"><path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z"/></svg>
          <span class="cam-preview-badge ${c.enabled !== false ? '' : 'offline'}">${c.enabled !== false ? c.type.toUpperCase() : 'OFFLINE'}</span>
          <div style="position:absolute; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity 0.2s; color:#fff; font-weight:600; font-size:14px;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0">⚙️ Ajustes</div>
        </div>
        <div class="cam-info">
          <div class="cam-name">${c.name || 'Cámara ' + (i+1)}</div>
          <div class="cam-url">${c.url || c.id || '—'}</div>
          <div class="cam-actions">
            <button class="cam-btn" onclick="viewStream(${i})">▶ Ver</button>
            <button class="cam-btn danger" onclick="removeCamera(${i})">✕</button>
          </div>
        </div>
      </div>`
    }).join('');
  }
  el.innerHTML = html;
}

function renderQRGrid() {
  const el = document.getElementById('qr-grid');
  if (!el) return;
  if (cameras.length === 0) {
    el.innerHTML = `<div class="empty-state glass"><p>Agrega cámaras primero para generar códigos QR Matter.</p></div>`;
    return;
  }
  el.innerHTML = cameras.map((c, i) => `
    <div class="glass" style="padding:20px;text-align:center;border-radius:16px">
      <div style="font-weight:600;margin-bottom:12px">${c.name || 'Cámara ' + (i+1)}</div>
      <div style="width:120px;height:120px;margin:0 auto;background:white;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#333;padding:8px;text-align:center;">
        QR Matter<br/><small style="font-family:monospace">${c.id || 'ID-' + i}</small>
      </div>
      <div style="margin-top:12px;font-size:12px;color:var(--text3)">Escanear con HomeKit</div>
    </div>`).join('');
}

// ── Add Camera Modal ──────────────────────────────────────────
function openAddCamera() {
  document.getElementById('modal-add').classList.add('open');
}
function closeModal() {
  document.getElementById('modal-add').classList.remove('open');
}

function selectType(type, btn) {
  currentType = type;
  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  ['rtsp','tuya','hls'].forEach(t => {
    document.getElementById('form-' + t).style.display = t === type ? 'flex' : 'none';
    document.getElementById('form-' + t).style.flexDirection = 'column';
    document.getElementById('form-' + t).style.gap = '14px';
  });
}

function addCamera() {
  let cam = {};
  if (currentType === 'rtsp') {
    const name = document.getElementById('cam-name').value.trim();
    const url  = document.getElementById('cam-url').value.trim();
    if (!name || !url) { toast('Completa nombre y URL RTSP', 'error'); return; }
    cam = { id: 'cam-' + Date.now(), name, url, type: 'rtsp', enabled: true,
            ai: document.getElementById('toggle-cam-ai').classList.contains('active') };
  } else if (currentType === 'hls') {
    const name = document.getElementById('cam-hls-name').value.trim();
    const url  = document.getElementById('cam-hls-url').value.trim();
    if (!name || !url) { toast('Completa nombre y URL HLS', 'error'); return; }
    cam = { id: 'cam-' + Date.now(), name, url, type: 'hls', enabled: true };
  } else {
    return; // Tuya/Vicohome is handled separately
  }

  saveNewCamera(cam);
}

function saveNewCamera(cam) {
  cameras.push(cam);
  localStorage.setItem('cb_cameras', JSON.stringify(cameras));
  renderCameras();
  closeModal();
  toast('✅ Cámara "' + cam.name + '" agregada', 'success');

  // Intentar POST al API
  fetch(API + '/api/cameras', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cam)
  }).catch(() => {});
}

async function fetchCloudCameras() {
  const brand = document.getElementById('cam-cloud-brand').value;
  const user = document.getElementById('cam-vico-user').value.trim();
  const pass = document.getElementById('cam-vico-pass').value.trim();
  if (!user || !pass) { toast('Ingresa tus credenciales', 'error'); return; }
  
  const resDiv = document.getElementById('vico-results');
  resDiv.style.display = 'flex';
  resDiv.innerHTML = `<div style="color:var(--text2);text-align:center;font-size:13px">Conectando a la nube de ${brand}... ⏳</div>`;

  if (brand === "Vicohome" || brand === "Tuya") {
    try {
      const resp = await fetch(API + '/api/vicohome/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user, password: pass })
      });
      const data = await resp.json();
      if (data.cameras) {
        resDiv.innerHTML = data.cameras.map((c, i) => `
          <div class="glass" style="padding:12px;display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-weight:600;font-size:14px">${c.name}</div>
              <div style="font-size:11px;color:var(--text3)">MAC: ${c.mac || c.id}</div>
            </div>
            <button class="btn-primary" style="padding:6px 12px;font-size:12px" onclick='importDiscovered(${JSON.stringify({
              id: c.id, name: c.name, type: 'cloud', brand: brand, 
              stream_url: c.stream_url, ip: c.ip, mac: c.mac, 
              battery: c.battery, is_native_rtsp: c.is_native_rtsp
            })})'>Agregar</button>
          </div>
        `).join('');
        toast('✅ Sesión iniciada en ' + brand, 'success');
      } else {
        throw new Error();
      }
    } catch(e) {
      toast('Error conectando a Vicohome API', 'error');
      resDiv.style.display = 'none';
    }
  } else {
    // Simulación de respuesta para otras marcas
    setTimeout(() => {
      const mockCams = [
        { id: `${brand.toLowerCase()}-123`, name: `${brand} Frontal`, type: 'cloud', brand: brand, stream_url: `rtsp://cloud-relay.${brand.toLowerCase()}.com/123`, ip: '192.168.1.55', mac: 'AA:BB:CC:DD:EE:11', battery: 95, is_native_rtsp: true },
        { id: `${brand.toLowerCase()}-456`, name: `${brand} Trasera`, type: 'cloud', brand: brand, stream_url: `rtsp://cloud-relay.${brand.toLowerCase()}.com/456`, ip: '192.168.1.56', mac: 'AA:BB:CC:DD:EE:22', battery: 40, is_native_rtsp: false }
      ];
      
      resDiv.innerHTML = mockCams.map((c, i) => `
        <div class="glass" style="padding:12px;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-weight:600;font-size:14px">${c.name}</div>
            <div style="font-size:11px;color:var(--text3)">ID: ${c.id}</div>
          </div>
          <button class="btn-primary" style="padding:6px 12px;font-size:12px" onclick='importDiscovered(${JSON.stringify(c)})'>Agregar</button>
        </div>
      `).join('');
      toast('✅ Sesión iniciada con éxito en ' + brand, 'success');
    }, 1500);
  }
}

function removeCamera(i) {
  const name = cameras[i].name;
  cameras.splice(i, 1);
  localStorage.setItem('cb_cameras', JSON.stringify(cameras));
  renderCameras();
  toast('Cámara "' + name + '" eliminada', 'success');
}

function viewStream(i) {
  const c = cameras[i];
  if (!c.url) { toast('No hay URL disponible', 'error'); return; }
  window.open('http://localhost:1984/stream.html?src=' + encodeURIComponent(c.url), '_blank');
}

function copyQR(i) {
  toast('QR de HomeKit disponible próximamente 🎥', 'success');
}

// ── Discover ──────────────────────────────────────────────────
async function startScan() {
  const btn = document.getElementById('btn-scan');
  const res = document.getElementById('scan-results');
  btn.textContent = '⏳ Escaneando...';
  btn.disabled = true;

  // Mostrar progreso animado
  res.innerHTML = `
    <div class="glass" style="padding:24px;text-align:center">
      <div style="font-size:32px;margin-bottom:12px;animation:spin 1.5s linear infinite;display:inline-block">🔍</div>
      <div style="font-weight:600;margin-bottom:6px">Escaneando red local...</div>
      <div style="font-size:13px;color:var(--text3)">Probando WS-Discovery (ONVIF), SSDP y puertos RTSP en toda la subred. Puede tardar 15-30 segundos.</div>
      <div style="margin-top:16px;height:3px;background:rgba(255,255,255,0.08);border-radius:99px;overflow:hidden">
        <div style="height:100%;width:60%;background:linear-gradient(90deg,#667eea,#764ba2);animation:progress 2s ease-in-out infinite;border-radius:99px"></div>
      </div>
    </div>
    <style>
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes progress { 0%{margin-left:-60%} 100%{margin-left:100%} }
    </style>`;

  try {
    const r = await fetch(API + '/api/discover', { headers: getHeaders() });
    const data = await r.json();
    const found = data.cameras || [];

    if (found.length === 0) {
      res.innerHTML = `
        <div class="glass" style="padding:32px;text-align:center">
          <div style="font-size:48px;margin-bottom:12px">📡</div>
          <div style="font-weight:600;margin-bottom:8px">No se encontraron dispositivos</div>
          <div style="font-size:13px;color:var(--text3);max-width:380px;margin:0 auto;line-height:1.6">
            Asegúrate de que el Scanner Agent está corriendo:<br>
            <code style="background:rgba(255,255,255,0.08);padding:4px 8px;border-radius:6px;font-size:12px">./start.sh</code><br><br>
            Y que tus cámaras están encendidas y en la misma red Wi-Fi.
          </div>
        </div>`;
    } else {
      // Separar por protocolo
      const onvif = found.filter(c => c.protocol === 'onvif');
      const rtsp  = found.filter(c => c.protocol === 'rtsp');
      const other = found.filter(c => c.protocol !== 'onvif' && c.protocol !== 'rtsp');

      const makeCard = (c) => {
        const proto = c.protocol.toUpperCase();
        const protoColor = proto === 'ONVIF' ? '#10b981' : proto === 'RTSP' ? '#3b82f6' : '#8b5cf6';
        const icon = proto === 'ONVIF' ? '📷' : proto === 'RTSP' ? '🎥' : '📡';
        return `
        <div class="glass" style="padding:16px;display:flex;align-items:center;gap:14px;border-left:3px solid ${protoColor}">
          <div style="font-size:28px">${icon}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <div style="font-weight:600;font-size:14px">${c.name || 'Dispositivo'}</div>
              <span style="background:${protoColor}22;color:${protoColor};padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600">${proto}</span>
              ${c.is_native_rtsp ? '<span style="background:rgba(16,185,129,0.15);color:#34d399;padding:2px 8px;border-radius:20px;font-size:11px">RTSP nativo</span>' : ''}
            </div>
            <div style="font-family:monospace;font-size:12px;color:var(--text3)">${c.ip}</div>
            <div style="font-family:monospace;font-size:11px;color:var(--text3);opacity:0.7;margin-top:2px">${c.stream_url || ''}</div>
          </div>
          <button class="btn-primary" style="white-space:nowrap;padding:8px 14px;font-size:13px" 
            onclick='importDiscovered(${JSON.stringify(c)})'>+ Agregar</button>
        </div>`;
      };

      let html = `<div style="font-size:13px;color:var(--text3);margin-bottom:12px;font-weight:600">✅ ${found.length} dispositivo${found.length !== 1 ? 's' : ''} encontrado${found.length !== 1 ? 's' : ''}</div>`;

      if (onvif.length) html += `<div style="font-size:12px;color:#10b981;margin:12px 0 6px;font-weight:600;text-transform:uppercase;letter-spacing:1px">📷 Cámaras ONVIF (${onvif.length})</div>` + onvif.map(makeCard).join('');
      if (rtsp.length)  html += `<div style="font-size:12px;color:#3b82f6;margin:12px 0 6px;font-weight:600;text-transform:uppercase;letter-spacing:1px">🎥 Streams RTSP (${rtsp.length})</div>` + rtsp.map(makeCard).join('');
      if (other.length) html += `<div style="font-size:12px;color:#8b5cf6;margin:12px 0 6px;font-weight:600;text-transform:uppercase;letter-spacing:1px">📡 Otros (${other.length})</div>` + other.map(makeCard).join('');

      res.innerHTML = html;
    }
  } catch(e) {
    res.innerHTML = `
      <div class="glass" style="padding:24px;text-align:center;color:var(--text2)">
        <div style="font-size:32px;margin-bottom:12px">⚠️</div>
        API no disponible. Asegúrate de que Scryvex esté corriendo en localhost:8080
      </div>`;
  }
  btn.textContent = '🔍 Escanear red';
  btn.disabled = false;
}

function importDiscovered(cam) {
  // Si ya existe por IP, no duplicar
  const exists = cameras.find(c => c.ip === cam.ip || c.url === cam.stream_url);
  if (exists) {
    toast('⚠️ Esta cámara ya fue agregada', 'error');
    return;
  }
  const newCam = {
    ...cam,
    id: cam.id || ('disc-' + Date.now()),
    name: cam.name || ('Cámara ' + cam.ip),
    url: cam.stream_url || ('rtsp://' + cam.ip + ':554/stream1'),
    type: cam.protocol === 'onvif' ? 'rtsp' : (cam.protocol || 'rtsp'),
    enabled: true,
    homekit: true,
  };
  cameras.push(newCam);
  localStorage.setItem('cb_cameras', JSON.stringify(cameras));
  renderCameras();
  toast('✅ Cámara importada: ' + newCam.name, 'success');
}

// ── Camera Settings ───────────────────────────────────────────
let currentEditingCam = null;

function openCameraSettings(i) {
  currentEditingCam = i;
  const c = cameras[i];
  
  // Determinar la URL para el reproductor (simulación HLS o WebRTC)
  // En producción, aquí se llamaría a go2rtc
  const streamUrl = (c.type === 'hls' || c.type === 'cloud') ? c.stream_url : c.url;
  
  // Entidades simuladas (esto vendrá del backend según la marca)
  const entitiesHTML = c.type === 'cloud' ? `
    <div style="margin-top:16px;">
      <h4 style="font-size:12px; color:var(--text3); margin-bottom:8px; text-transform:uppercase; letter-spacing:1px;">Datos y Entidades de la Cámara</h4>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
        <div class="glass" style="padding:10px; display:flex; align-items:center; gap:8px; font-size:13px;">
          <span>🌐</span> IP: <strong>${c.ip || 'Oculta por nube'}</strong>
        </div>
        <div class="glass" style="padding:10px; display:flex; align-items:center; gap:8px; font-size:13px;">
          <span>🏷️</span> MAC: <strong>${c.mac || 'Desconocida'}</strong>
        </div>
        <div class="glass" style="padding:10px; display:flex; align-items:center; gap:8px; font-size:13px;">
          <span>🔋</span> Batería: <strong>${c.battery ? c.battery + '%' : 'N/A'}</strong>
        </div>
        <div class="glass" style="padding:10px; display:flex; align-items:center; gap:8px; font-size:13px;">
          <span>📶</span> Señal: <strong>Buena</strong>
        </div>
        <div class="glass" style="padding:10px; display:flex; align-items:center; gap:8px; font-size:13px;">
          <span>🏃</span> Movimiento: <strong>Despejado</strong>
        </div>
        <div class="glass" style="padding:10px; display:flex; align-items:center; gap:8px; font-size:13px;">
          <span>📡</span> Natively RTSP: <strong>${c.is_native_rtsp ? 'Sí' : 'No (Convertido)'}</strong>
        </div>
      </div>
    </div>
  ` : '';

  const modalHTML = `
  <div class="modal-overlay open" id="modal-cam-settings" onclick="closeCamSettings()">
    <div class="modal glass" onclick="event.stopPropagation()" style="max-width:500px;">
      <div class="modal-header">
        <h2>${c.name}</h2>
        <button class="btn-close" onclick="closeCamSettings()">✕</button>
      </div>
      
      <!-- Reproductor 16:9 -->
      <div style="width:100%; aspect-ratio:16/9; background:#000; border-radius:8px; overflow:hidden; position:relative; margin-bottom:16px; display:flex; align-items:center; justify-content:center;">
        <div id="player-loading" style="color:var(--text2); font-size:13px; position:absolute; z-index:1;">Conectando stream... ⏳</div>
        <video id="settings-player" autoplay muted playsinline controls style="width:100%; height:100%; object-fit:contain; position:relative; z-index:2; opacity:0; transition:opacity 0.3s;"></video>
      </div>

      <div class="modal-body" style="max-height: 40vh; overflow-y: auto; padding-right: 8px;">
        <div class="form-group">
          <label>Nombre de la cámara</label>
          <input class="glass-input" id="set-cam-name" type="text" value="${c.name || ''}" />
        </div>
        
        ${entitiesHTML}

        <div style="margin-top:16px;">
          <h4 style="font-size:12px; color:var(--text3); margin-bottom:8px; text-transform:uppercase; letter-spacing:1px;">Ajustes del Sistema</h4>
          <div class="form-group toggle-group">
            <label>Activar cámara en Scryvex</label>
            <div class="toggle ${c.enabled !== false ? 'active' : ''}" id="set-cam-enabled" onclick="this.classList.toggle('active')"><div class="toggle-knob"></div></div>
          </div>
          <div class="form-group toggle-group" style="margin-top: 10px;">
            <label>Exportar a HomeKit (Matter)</label>
            <div class="toggle ${c.homekit !== false ? 'active' : ''}" id="set-cam-hk" onclick="this.classList.toggle('active')"><div class="toggle-knob"></div></div>
          </div>
          <div class="form-group toggle-group" style="margin-top: 10px;">
            <label>Detección de Personas (AI)</label>
            <div class="toggle ${c.ai ? 'active' : ''}" id="set-cam-ai" onclick="this.classList.toggle('active')"><div class="toggle-knob"></div></div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="closeCamSettings()">Cerrar</button>
        <button class="btn-primary" onclick="saveCamSettings()">Guardar Ajustes</button>
      </div>
    </div>
  </div>`;
  
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  // Simular la carga del video tras 1 segundo para no bloquear
  setTimeout(() => {
    const video = document.getElementById('settings-player');
    const loading = document.getElementById('player-loading');
    if (video) {
      // Para demo visual, cargamos un video de prueba de Apple o un placeholder si no hay URL real
      video.src = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"; 
      video.oncanplay = () => {
        video.style.opacity = '1';
        if(loading) loading.style.display = 'none';
      };
    }
  }, 1000);
}

function closeCamSettings() {
  const modal = document.getElementById('modal-cam-settings');
  if (modal) {
    // Detener la transmisión para no consumir recursos
    const video = document.getElementById('settings-player');
    if (video) {
      video.pause();
      video.src = "";
      video.load();
    }
    modal.remove();
  }
  currentEditingCam = null;
}

function saveCamSettings() {
  if (currentEditingCam === null) return;
  const c = cameras[currentEditingCam];
  
  c.name = document.getElementById('set-cam-name').value.trim();
  c.enabled = document.getElementById('set-cam-enabled').classList.contains('active');
  c.homekit = document.getElementById('set-cam-hk').classList.contains('active');
  c.ai = document.getElementById('set-cam-ai').classList.contains('active');
  
  localStorage.setItem('cb_cameras', JSON.stringify(cameras));
  renderCameras();
  closeCamSettings();
  
  toast('💾 Ajustes guardados. Sincronizando...', 'success');
}

// ── Settings ──────────────────────────────────────────────────
function toggleAI() {
  aiEnabled = !aiEnabled;
  document.getElementById('toggle-ai').classList.toggle('active', aiEnabled);
}

function saveSettings() {
  const cfg = {
    tz:      document.getElementById('cfg-tz').value,
    mqtt:    { ip: document.getElementById('cfg-mqtt-ip').value, port: document.getElementById('cfg-mqtt-port').value,
               user: document.getElementById('cfg-mqtt-user').value, pass: document.getElementById('cfg-mqtt-pass').value },
    tuya:    { id: document.getElementById('cfg-tuya-id').value, secret: document.getElementById('cfg-tuya-secret').value,
               region: document.getElementById('cfg-tuya-region').value },
    ai:      { enabled: aiEnabled, confidence: document.getElementById('cfg-confidence').value,
               gpu: document.getElementById('cfg-gpu').value }
  };
  localStorage.setItem('cb_config', JSON.stringify(cfg));
  toast('✅ Configuración guardada (reinicia Docker para aplicar)', 'success');
}

function refresh() {
  fetchStatus();
  toast('Actualizando...', 'success');
}

// ── Toast ─────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3000);
}

// ── Auth UI ───────────────────────────────────────────────────
function showLoginScreen() {
  // Ocultar app, mostrar pantalla de login
  document.getElementById('app-shell')?.style.setProperty('display', 'none');
  
  const existing = document.getElementById('login-screen');
  if (existing) { existing.style.display = 'flex'; return; }

  const loginHTML = `
  <div id="login-screen" style="
    position:fixed; inset:0; z-index:9999;
    background: radial-gradient(ellipse at 20% 50%, rgba(102,126,234,0.15) 0%, transparent 60%),
                radial-gradient(ellipse at 80% 50%, rgba(118,75,162,0.15) 0%, transparent 60%),
                #0d0d1a;
    display:flex; align-items:center; justify-content:center; font-family: inherit;
  ">
    <div style="
      width: 380px; max-width: 95vw;
      background: rgba(255,255,255,0.05);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 24px;
      padding: 40px;
      box-shadow: 0 8px 64px rgba(0,0,0,0.5);
    ">
      <div style="text-align:center; margin-bottom:32px;">
        <div style="font-size:48px; margin-bottom:8px;">🎥</div>
        <h1 style="font-size:26px; font-weight:700; color:#fff; margin:0">Scryvex</h1>
        <p style="color:rgba(255,255,255,0.5); font-size:14px; margin:6px 0 0">Camera Matter Bridge</p>
      </div>
      
      <div id="login-error" style="display:none; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); border-radius:10px; padding:10px 14px; color:#fc8181; font-size:13px; margin-bottom:16px;"></div>
      
      <div id="login-form">
        <div style="margin-bottom:16px;">
          <label style="font-size:12px; color:rgba(255,255,255,0.5); text-transform:uppercase; letter-spacing:1px; display:block; margin-bottom:6px;">Usuario</label>
          <input id="login-user" type="text" placeholder="admin" autocomplete="username"
            style="width:100%; box-sizing:border-box; background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.12); border-radius:10px; padding:12px 14px; color:#fff; font-size:14px; outline:none;"
            onkeydown="if(event.key==='Enter') doLogin()">
        </div>
        <div style="margin-bottom:24px;">
          <label style="font-size:12px; color:rgba(255,255,255,0.5); text-transform:uppercase; letter-spacing:1px; display:block; margin-bottom:6px;">Contraseña</label>
          <input id="login-pass" type="password" placeholder="••••••••" autocomplete="current-password"
            style="width:100%; box-sizing:border-box; background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.12); border-radius:10px; padding:12px 14px; color:#fff; font-size:14px; outline:none;"
            onkeydown="if(event.key==='Enter') doLogin()">
        </div>
        <button id="login-btn" onclick="doLogin()" style="
          width:100%; padding:14px; border:none; border-radius:12px; cursor:pointer; font-size:15px; font-weight:600;
          background: linear-gradient(135deg, #667eea, #764ba2);
          color: #fff; transition: opacity 0.2s;
        ">Iniciar Sesión</button>
        <div style="text-align:center; margin-top:16px;">
          <button onclick="showResetForm()" style="background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.4);font-size:13px;text-decoration:underline;">¿Olvidaste tu contraseña?</button>
        </div>
      </div>

      <div id="reset-form" style="display:none;">
        <p style="color:rgba(255,255,255,0.6);font-size:13px;margin-bottom:16px;text-align:center;">Ingresa tu usuario. El token de reseteo aparecerá en los logs del servidor Scryvex.</p>
        <div style="margin-bottom:16px;">
          <input id="reset-user" type="text" placeholder="Usuario"
            style="width:100%; box-sizing:border-box; background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.12); border-radius:10px; padding:12px 14px; color:#fff; font-size:14px; outline:none;">
        </div>
        <button onclick="requestReset()" style="width:100%;padding:12px;border:none;border-radius:12px;cursor:pointer;font-size:14px;font-weight:600;background:linear-gradient(135deg,#f093fb,#f5576c);color:#fff;">Generar Token de Reseteo</button>
        <div style="margin-bottom:16px;margin-top:16px;">
          <input id="reset-token" type="text" placeholder="Token recibido en logs"
            style="width:100%; box-sizing:border-box; background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.12); border-radius:10px; padding:12px 14px; color:#fff; font-size:14px; outline:none; margin-bottom:10px;">
          <input id="reset-newpass" type="password" placeholder="Nueva contraseña"
            style="width:100%; box-sizing:border-box; background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.12); border-radius:10px; padding:12px 14px; color:#fff; font-size:14px; outline:none;">
        </div>
        <button onclick="doReset()" style="width:100%;padding:12px;border:none;border-radius:12px;cursor:pointer;font-size:14px;font-weight:600;background:linear-gradient(135deg,#43e97b,#38f9d7);color:#000;">Restablecer Contraseña</button>
        <div style="text-align:center;margin-top:12px;">
          <button onclick="showLoginForm()" style="background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.4);font-size:13px;">← Volver al login</button>
        </div>
      </div>
    </div>
  </div>`;
  
  document.body.insertAdjacentHTML('beforeend', loginHTML);
  setTimeout(() => document.getElementById('login-user')?.focus(), 100);
}

function showResetForm() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('reset-form').style.display = '';
}
function showLoginForm() {
  document.getElementById('reset-form').style.display = 'none';
  document.getElementById('login-form').style.display = '';
}

async function doLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  
  if (!username || !password) { showLoginError('Ingresa usuario y contraseña'); return; }
  
  btn.textContent = 'Verificando...';
  btn.disabled = true;
  
  try {
    const r = await fetch(API + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await r.json();
    
    if (!r.ok || !data.token) {
      showLoginError(data.error || 'Credenciales incorrectas');
      btn.textContent = 'Iniciar Sesión';
      btn.disabled = false;
      return;
    }
    
    authToken = data.token;
    authUser = data.user;
    localStorage.setItem('cb_token', authToken);
    localStorage.setItem('cb_user', JSON.stringify(authUser));
    
    // Ocultar login y mostrar app
    document.getElementById('login-screen').style.display = 'none';
    const appShell = document.getElementById('app-shell');
    if (appShell) appShell.style.display = '';
    bootApp();
    
  } catch(e) {
    showLoginError('Error de conexión con el servidor');
    btn.textContent = 'Iniciar Sesión';
    btn.disabled = false;
  }
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  if (el) { el.textContent = msg; el.style.display = ''; }
}

async function requestReset() {
  const username = document.getElementById('reset-user').value.trim();
  if (!username) return;
  const r = await fetch(API + '/api/auth/reset-request', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  });
  const data = await r.json();
  if (r.ok) {
    alert('✅ Token generado. Revisa los logs de Docker:\ndocker logs cambrige\n\nToken: ' + (data.token || '(ver logs)'));
  } else {
    alert('❌ ' + (data.error || 'Error'));
  }
}

async function doReset() {
  const username = document.getElementById('reset-user').value.trim();
  const token = document.getElementById('reset-token').value.trim();
  const newPass = document.getElementById('reset-newpass').value;
  if (!username || !token || !newPass) { alert('Completa todos los campos'); return; }
  
  const r = await fetch(API + '/api/auth/reset-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, token, new_password: newPass })
  });
  const data = await r.json();
  if (r.ok) {
    alert('✅ Contraseña restablecida. Ahora puedes iniciar sesión.');
    showLoginForm();
  } else {
    alert('❌ ' + (data.error || 'Token inválido o expirado'));
  }
}

function logout() {
  authToken = '';
  authUser = null;
  localStorage.removeItem('cb_token');
  localStorage.removeItem('cb_user');
  location.reload();
}

// ── Gestión de Usuarios (solo Admin) ─────────────────────────
async function openUsersManager() {
  const r = await fetch(API + '/api/users', { headers: getHeaders() });
  const users = await r.json();
  
  const rows = users.map(u => `
    <tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
      <td style="padding:10px 8px">${u.username}</td>
      <td style="padding:10px 8px;color:var(--text3)">${u.email}</td>
      <td style="padding:10px 8px">
        <span style="background:${u.role==='admin'?'rgba(102,126,234,0.2)':'rgba(255,255,255,0.08)'};color:${u.role==='admin'?'#a78bfa':'#94a3b8'};padding:3px 10px;border-radius:20px;font-size:12px">
          ${u.role === 'admin' ? '👑 Admin' : '👁 Viewer'}
        </span>
      </td>
      <td style="padding:10px 8px;color:var(--text3);font-size:12px">${u.last_login ? new Date(u.last_login).toLocaleDateString('es') : 'Nunca'}</td>
      <td style="padding:10px 8px">
        ${u.id !== authUser?.id ? `<button onclick="deleteUser('${u.id}')" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#fc8181;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px">Eliminar</button>` : '<span style="color:var(--text3);font-size:12px">Tú</span>'}
      </td>
    </tr>`).join('');
  
  const modalHTML = `
  <div class="modal-overlay open" id="modal-users" onclick="closeUsersManager()">
    <div class="modal glass" onclick="event.stopPropagation()" style="max-width:600px;width:90vw">
      <div class="modal-header">
        <h2>👥 Gestión de Usuarios</h2>
        <button class="btn-close" onclick="closeUsersManager()">✕</button>
      </div>
      <div class="modal-body">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:1px solid rgba(255,255,255,0.1)">
              <th style="padding:8px;text-align:left;font-size:12px;color:var(--text3)">USUARIO</th>
              <th style="padding:8px;text-align:left;font-size:12px;color:var(--text3)">EMAIL</th>
              <th style="padding:8px;text-align:left;font-size:12px;color:var(--text3)">ROL</th>
              <th style="padding:8px;text-align:left;font-size:12px;color:var(--text3)">ÚLTIMO ACCESO</th>
              <th style="padding:8px"></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        
        <div style="margin-top:24px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.08)">
          <h4 style="font-size:13px;color:var(--text3);margin-bottom:12px;text-transform:uppercase;letter-spacing:1px">Agregar Usuario</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            <input class="glass-input" id="new-user-name" placeholder="Usuario" type="text">
            <input class="glass-input" id="new-user-email" placeholder="Email" type="email">
            <input class="glass-input" id="new-user-pass" placeholder="Contraseña" type="password">
            <select class="glass-input" id="new-user-role" style="cursor:pointer">
              <option value="viewer">👁 Viewer (Solo lectura)</option>
              <option value="admin">👑 Admin (Control total)</option>
            </select>
          </div>
          <button class="btn-primary" onclick="createUser()" style="width:100%">+ Crear Usuario</button>
        </div>

        <div style="margin-top:20px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.08)">
          <h4 style="font-size:13px;color:var(--text3);margin-bottom:12px;text-transform:uppercase;letter-spacing:1px">Cambiar mi contraseña</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            <input class="glass-input" id="chg-old" placeholder="Contraseña actual" type="password">
            <input class="glass-input" id="chg-new" placeholder="Nueva contraseña" type="password">
          </div>
          <button class="btn-secondary" onclick="changeMyPassword()" style="width:100%">Cambiar Contraseña</button>
        </div>
      </div>
    </div>
  </div>`;
  
  document.body.insertAdjacentHTML('beforeend', modalHTML);
}

function closeUsersManager() {
  document.getElementById('modal-users')?.remove();
}

async function createUser() {
  const body = {
    username: document.getElementById('new-user-name').value.trim(),
    email: document.getElementById('new-user-email').value.trim(),
    password: document.getElementById('new-user-pass').value,
    role: document.getElementById('new-user-role').value
  };
  if (!body.username || !body.password) { toast('Ingresa usuario y contraseña', 'error'); return; }
  
  const r = await fetch(API + '/api/users', {
    method: 'POST', headers: getHeaders(), body: JSON.stringify(body)
  });
  const data = await r.json();
  if (r.ok) {
    toast('✅ Usuario "' + data.username + '" creado', 'success');
    closeUsersManager();
    setTimeout(openUsersManager, 100);
  } else {
    toast('❌ ' + (data.error || 'Error'), 'error');
  }
}

async function deleteUser(id) {
  if (!confirm('¿Eliminar este usuario? Esta acción no se puede deshacer.')) return;
  const r = await fetch(API + '/api/users/' + id, { method: 'DELETE', headers: getHeaders() });
  const data = await r.json();
  if (r.ok) {
    toast('Usuario eliminado', 'success');
    closeUsersManager();
    setTimeout(openUsersManager, 100);
  } else {
    toast('❌ ' + (data.error || 'Error'), 'error');
  }
}

async function changeMyPassword() {
  const body = {
    old_password: document.getElementById('chg-old').value,
    new_password: document.getElementById('chg-new').value
  };
  if (!body.old_password || !body.new_password) { toast('Completa ambos campos', 'error'); return; }
  const r = await fetch(API + '/api/auth/change-password', {
    method: 'POST', headers: getHeaders(), body: JSON.stringify(body)
  });
  const data = await r.json();
  if (r.ok) {
    toast('✅ Contraseña actualizada', 'success');
    document.getElementById('chg-old').value = '';
    document.getElementById('chg-new').value = '';
  } else {
    toast('❌ ' + (data.error || 'Error'), 'error');
  }
}

// ── Profile Modal (All Users) ─────────────────────────────────
function openProfileModal() {
  const modalHTML = `
  <div class="modal-overlay open" id="modal-profile" onclick="closeProfileModal()">
    <div class="modal glass" onclick="event.stopPropagation()" style="max-width:400px;width:95vw">
      <div class="modal-header">
        <h2>👤 Mi Perfil</h2>
        <button class="btn-close" onclick="closeProfileModal()">✕</button>
      </div>
      <div class="modal-body">
        <div style="text-align:center; margin-bottom:20px;">
          <div id="profile-avatar-preview" 
            onclick="document.getElementById('avatar-upload-input').click()"
            style="width:100px;height:100px;border-radius:50%;margin:0 auto 12px;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;overflow:hidden;border:3px solid var(--accent);cursor:pointer;position:relative;group">
            ${authUser.avatar_url ? `<img src="${authUser.avatar_url}" style="width:100%;height:100%;object-fit:cover;">` : `<span style="font-size:36px;font-weight:700">${authUser.username[0].toUpperCase()}</span>`}
            <div style="position:absolute; inset:0; background:rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity 0.2s; color:#fff; font-size:24px;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0">📷</div>
          </div>
          <input type="file" id="avatar-upload-input" style="display:none" accept="image/*" onchange="uploadAvatar(this)">
          <p style="font-size:12px;color:var(--accent);font-weight:600;cursor:pointer" onclick="document.getElementById('avatar-upload-input').click()">Click para subir foto</p>
        </div>

        <div class="form-group">
          <label>Nombre de usuario</label>
          <input class="glass-input" id="prof-username" type="text" value="${authUser.username}">
        </div>
        <div class="form-group" style="margin-top:12px">
          <label>Email</label>
          <input class="glass-input" id="prof-email" type="email" value="${authUser.email}">
        </div>
        
        <div style="margin-top:24px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.08)">
          <h4 style="font-size:13px;color:var(--text3);margin-bottom:12px;text-transform:uppercase;letter-spacing:1px">Seguridad</h4>
          <div class="form-group">
            <input class="glass-input" id="prof-old-pass" placeholder="Contraseña actual" type="password">
          </div>
          <div class="form-group" style="margin-top:10px">
            <input class="glass-input" id="prof-new-pass" placeholder="Nueva contraseña" type="password">
          </div>
          <button class="btn-secondary" onclick="changeProfilePassword()" style="width:100%;margin-top:10px">Actualizar Contraseña</button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="closeProfileModal()">Cerrar</button>
        <button class="btn-primary" onclick="updateProfile()">Guardar Cambios</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', modalHTML);
}

async function uploadAvatar(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  
  // Mostrar preview inmediato (base64 temporal)
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('profile-avatar-preview').innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;">`;
  };
  reader.readAsDataURL(file);

  const formData = new FormData();
  formData.append('avatar', file);

  try {
    toast('Subiendo imagen... ⏳', 'success');
    const r = await fetch(API + '/api/auth/upload-avatar', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + authToken }, // Sin Content-Type para FormData
      body: formData
    });
    const data = await r.json();
    if (r.ok) {
      authUser.avatar_url = data.url;
      localStorage.setItem('cb_user', JSON.stringify(authUser));
      bootApp(); // Actualizar sidebar
      toast('✅ Foto de perfil actualizada', 'success');
    } else {
      throw new Error(data.error);
    }
  } catch (e) {
    toast('❌ Error al subir: ' + e.message, 'error');
  }
}

function closeProfileModal() {
  document.getElementById('modal-profile')?.remove();
}

function updateAvatarPreview(url) {
  const preview = document.getElementById('profile-avatar-preview');
  if (url) {
    preview.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;">`;
  } else {
    preview.innerHTML = `<span style="font-size:32px;font-weight:700">${authUser.username[0].toUpperCase()}</span>`;
  }
}

async function updateProfile() {
  const body = {
    username: document.getElementById('prof-username').value.trim(),
    email: document.getElementById('prof-email').value.trim(),
    avatar_url: document.getElementById('prof-avatar').value.trim()
  };
  
  const r = await fetch(API + '/api/auth/me', {
    method: 'PUT', headers: getHeaders(), body: JSON.stringify(body)
  });
  const data = await r.json();
  if (r.ok) {
    authUser = data;
    localStorage.setItem('cb_user', JSON.stringify(data));
    bootApp(); // Actualizar sidebar
    toast('✅ Perfil actualizado', 'success');
    closeProfileModal();
  } else {
    toast('❌ ' + (data.error || 'Error'), 'error');
  }
}

async function changeProfilePassword() {
  const body = {
    old_password: document.getElementById('prof-old-pass').value,
    new_password: document.getElementById('prof-new-pass').value
  };
  if (!body.old_password || !body.new_password) { toast('Completa ambos campos', 'error'); return; }
  const r = await fetch(API + '/api/auth/change-password', {
    method: 'POST', headers: getHeaders(), body: JSON.stringify(body)
  });
  if (r.ok) {
    toast('✅ Contraseña actualizada', 'success');
    document.getElementById('prof-old-pass').value = '';
    document.getElementById('prof-new-pass').value = '';
  } else {
    const data = await r.json();
    toast('❌ ' + (data.error || 'Error'), 'error');
  }
}

// ── Cloud Discovery ───────────────────────────────────────────
function openCloudModal() {
  const brands = [
    {id:'tuya', name:'Tuya / Smart Life', icon:'🏠'},
    {id:'vicohome', name:'Vicohome', icon:'📹'},
    {id:'ring', name:'Ring', icon:'🔔'},
    {id:'google', name:'Google Nest', icon:'🌐'},
    {id:'wyze', name:'Wyze', icon:'⚡'},
    {id:'tapo', name:'Tapo', icon:'🔵'},
    {id:'ezviz', name:'Ezviz', icon:'👁️'},
    {id:'aqara', name:'Aqara', icon:'🌿'}
  ];

  const modalHTML = `
  <div class="modal-overlay open" id="modal-cloud" onclick="closeCloudModal()">
    <div class="modal glass" onclick="event.stopPropagation()" style="max-width:500px">
      <div class="modal-header">
        <h2>☁️ Conectar Cámara Cloud</h2>
        <button class="btn-close" onclick="closeCloudModal()">✕</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--text3);margin-bottom:20px">Selecciona tu proveedor e ingresa tus credenciales para importar tus cámaras automáticamente.</p>
        
        <div class="form-group">
          <label>Marca / Ecosistema</label>
          <select class="glass-input" id="cloud-brand" style="appearance:auto">
            ${brands.map(b => `<option value="${b.id}">${b.icon} ${b.name}</option>`).join('')}
          </select>
        </div>
        
        <div class="form-group" style="margin-top:12px">
          <label>Correo electrónico</label>
          <input class="glass-input" id="cloud-email" type="email" placeholder="usuario@ejemplo.com">
        </div>
        
        <div class="form-group" style="margin-top:12px">
          <label>Contraseña</label>
          <input class="glass-input" id="cloud-pass" type="password" placeholder="••••••••">
        </div>

        <div id="cloud-loading" style="display:none; text-align:center; margin-top:20px">
          <div style="animation:spin 1s linear infinite; font-size:24px">⏳</div>
          <p style="font-size:12px; margin-top:8px">Conectando con la nube...</p>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" onclick="closeCloudModal()">Cancelar</button>
        <button class="btn-primary" onclick="fetchCloudCameras()">Buscar Cámaras</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', modalHTML);
}

function closeCloudModal() {
  document.getElementById('modal-cloud')?.remove();
}

async function fetchCloudCameras() {
  const brand = document.getElementById('cloud-brand').value;
  const email = document.getElementById('cloud-email').value;
  const pass = document.getElementById('cloud-pass').value;

  if (!email || !pass) { toast('Ingresa tus credenciales', 'error'); return; }

  const loader = document.getElementById('cloud-loading');
  loader.style.display = 'block';

  try {
    const r = await fetch(API + '/api/vicohome/login', { 
      method: 'POST', 
      headers: getHeaders(),
      body: JSON.stringify({ brand, email, password: pass })
    });
    const data = await r.json();
    
    if (r.ok) {
      closeCloudModal();
      renderCloudGroup(brand, data.cameras);
      toast(`✅ ${data.cameras.length} cámaras de ${brand} encontradas`, 'success');
    } else {
      toast('❌ Error: ' + (data.error || 'No se pudo conectar'), 'error');
    }
  } catch(e) {
    toast('❌ Error de conexión', 'error');
  } finally {
    loader.style.display = 'none';
  }
}

function renderCloudGroup(brand, cams) {
  const res = document.getElementById('scan-results');
  const brandName = brand.charAt(0).toUpperCase() + brand.slice(1);
  
  const groupHTML = `
    <div class="cloud-group" style="margin-top:24px">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
        <h4 style="font-size:14px; color:var(--accent); text-transform:uppercase; letter-spacing:1px">☁️ ${brandName}</h4>
        <button class="btn-secondary" style="padding:4px 8px; font-size:11px" onclick="openCloudModal()">🔄 Recargar</button>
      </div>
      <div class="grid-container" style="display:grid; gap:12px">
        ${cams.map(c => `
          <div class="glass" style="padding:16px; display:flex; align-items:center; gap:16px">
            <div style="font-size:24px">☁️</div>
            <div style="flex:1">
              <div style="font-weight:600">${c.name}</div>
              <div style="font-size:11px; color:var(--text3)">${c.ip || 'Cloud Stream'} • ${c.online ? '🟢 En línea' : '🔴 Desconectado'}</div>
            </div>
            <button class="btn-primary" onclick='importDiscovered(${JSON.stringify(c)})'>+ Agregar</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  
  res.insertAdjacentHTML('afterbegin', groupHTML);
}

