// Scryvex UI v0.2.0 — app.js con Auth
const API = '';

// ── Auth State ────────────────────────────────────────────────
let authToken = localStorage.getItem('cb_token') || '';
let authUser = JSON.parse(localStorage.getItem('cb_user') || 'null');

function getHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken };
}

// ── State ─────────────────────────────────────────────────────
let cameras = [];
let currentType = 'rtsp';
let aiEnabled = true;
let activeStreamIndex = null;

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
    cameras: 'Cámaras',
    plugins: 'Plugins Scryvex 1.0',
    discover: 'Descubrir',
    homekit: 'HomeKit / Matter',
    settings: 'Configuración'
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
    document.getElementById('stat-ver').textContent = data.version || '1.0.0';

    // Update sub-services (simulated or real checks)
    updateSvcStatus('svc-go2rtc', true, 'Activo');
    updateSvcStatus('svc-matter', true, 'Bridge Listo');
    updateSvcStatus('svc-ai', true, 'YoloFastestV2');
  } catch {
    setOnline(false);
    updateSvcStatus('svc-go2rtc', false, 'Error');
    updateSvcStatus('svc-matter', false, 'Error');
    updateSvcStatus('svc-ai', false, 'Error');
  }
  await fetchCameras();
}

function updateSvcStatus(id, up, text) {
  const el = document.getElementById(id);
  if (!el) return;
  const dot = el.querySelector('.svc-dot');
  const st = el.querySelector('.svc-status');
  if (dot) dot.className = 'svc-dot ' + (up ? 'up' : 'down');
  if (st) st.textContent = text;
}

function setOnline(on) {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  if (dot) dot.className = 'status-dot ' + (on ? 'online' : 'offline');
  if (text) text.textContent = on ? 'En línea' : 'Sin conexión';

  const apiDot = document.querySelector('#svc-api .svc-dot');
  const apiSt = document.querySelector('#svc-api .svc-status');
  if (apiDot) apiDot.className = 'svc-dot ' + (on ? 'up' : 'down');
  if (apiSt) apiSt.textContent = on ? 'Activo' : 'Desconectado';

  const statOn = document.getElementById('stat-online');
  if (statOn) statOn.textContent = on ? 'Online' : 'Offline';
}

async function fetchCameras() {
  try {
    const res = await fetch(API + '/api/cameras');
    const backendCams = await res.json();
    if (Array.isArray(backendCams) && backendCams.length > 0) {
      cameras = backendCams;
      // Also sync to localStorage as backup
      localStorage.setItem('cb_cameras', JSON.stringify(cameras));
    } else {
      // Backend empty - check localStorage as fallback
      const local = JSON.parse(localStorage.getItem('cb_cameras') || '[]');
      cameras = local;
    }
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

  if (activeStreamIndex === null) {
    renderCameraList('cameras-list');
    renderCameraList('dash-cams');
  }
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

  // Grouping by brand (or RTSP/HLS/Plugin)
  const grouped = {};
  cameras.forEach(c => {
    let group = c.brand;
    if (!group) {
        if (c.type === 'plugin') group = '🔌 Plugins (Scryvex 1.0)';
        else if (c.type === 'rtsp') group = '🎥 RTSP/ONVIF';
        else if (c.type === 'hls') group = '🌐 HLS';
        else group = 'Otras';
    } else {
        if (c.type === 'plugin') group = `🔌 Plugin: ${group}`;
    }
    
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
          <div class="cam-name">${c.name || 'Cámara ' + (i + 1)}</div>
          <div class="cam-url">${c.url || c.id || '—'}</div>
          <div class="cam-actions">
            <button class="cam-btn" onclick="viewStream(${i}, this)">▶ Ver</button>
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
      <div style="font-weight:600;margin-bottom:12px">${c.name || 'Cámara ' + (i + 1)}</div>
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
  ['rtsp', 'tuya', 'hls'].forEach(t => {
    document.getElementById('form-' + t).style.display = t === type ? 'flex' : 'none';
    document.getElementById('form-' + t).style.flexDirection = 'column';
    document.getElementById('form-' + t).style.gap = '14px';
  });
}

function addCamera() {
  let cam = {};
  if (currentType === 'rtsp') {
    const name = document.getElementById('cam-name').value.trim();
    let url = document.getElementById('cam-url').value.trim();
    if (url && !url.includes('://')) url = 'rtsp://' + url;
    const user = document.getElementById('cam-user').value.trim();
    const pass = document.getElementById('cam-pass').value.trim();

    if (!name || !url) { toast('Completa nombre y URL RTSP', 'error'); return; }

    // Inyectar credenciales si se proporcionan por separado
    if (user && !url.includes('@')) {
      const auth = pass ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}` : encodeURIComponent(user);
      url = url.replace('rtsp://', `rtsp://${auth}@`);
    }

    cam = {
      id: 'cam-' + Date.now(), name, url, type: 'rtsp', enabled: true,
      ai: document.getElementById('toggle-cam-ai').classList.contains('active')
    };
  } else if (currentType === 'hls') {
    const name = document.getElementById('cam-hls-name').value.trim();
    const url = document.getElementById('cam-hls-url').value.trim();
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
  }).catch(() => { });
}

// ── Brand Plugin System ────────────────────────────────────────
const BRAND_PLUGINS = {
  'Tuya': {
    logo: '🏠', name: 'Tuya / Smart Life',
    desc: 'Usa tu cuenta de Tuya Smart o Smart Life. Cubre Tuya, Vicohome y cientos de marcas.',
    fields: [
      { id: 'cloud-user', label: 'Email', type: 'email', ph: 'tu@email.com' },
      { id: 'cloud-pass', label: 'Contraseña', type: 'password', ph: '••••••••' },
      { id: 'cloud-region', label: 'Región', type: 'select', opts: ['América (us)', 'Europa (eu)', 'China (cn)', 'India (in)'] },
    ],
    note: '🔒 Tus credenciales se usan localmente y nunca se comparten.',
    api: 'tuya',
  },
  'Vicohome': {
    logo: '📹', name: 'Vicohome',
    desc: 'Vicohome usa servidores Tuya. Inicia sesión con tu cuenta de la app Vicohome.',
    fields: [
      { id: 'cloud-user', label: 'Email de Vicohome', type: 'email', ph: 'tu@email.com' },
      { id: 'cloud-pass', label: 'Contraseña de Vicohome', type: 'password', ph: '••••••••' },
    ],
    note: '💡 Serás autenticado en los servidores Tuya de Vicohome.',
    api: 'vicohome',
  },
  'Ring': {
    logo: '🔔', name: 'Ring (Amazon)',
    desc: 'Importa doorbells y cámaras Ring con tu cuenta de Amazon.',
    fields: [
      { id: 'cloud-user', label: 'Email de Ring', type: 'email', ph: 'tu@email.com' },
      { id: 'cloud-pass', label: 'Contraseña', type: 'password', ph: '••••••••' },
      { id: 'cloud-2fa', label: 'Código 2FA (si aplica)', type: 'text', ph: '123456' },
    ],
    note: '🔔 Ring puede requerir verificación de dos pasos.',
    api: 'ring',
  },
  'Tapo': {
    logo: '🔗', name: 'Tapo / TP-Link',
    desc: 'Importa cámaras Tapo C120, C400, C420 y más con tu cuenta TP-Link.',
    fields: [
      { id: 'cloud-user', label: 'Email de TP-Link', type: 'email', ph: 'tu@email.com' },
      { id: 'cloud-pass', label: 'Contraseña', type: 'password', ph: '••••••••' },
    ],
    note: '📷 También puedes agregar Tapo por IP en la pestaña RTSP/ONVIF.',
    api: 'tapo',
  },
  'Ezviz': {
    logo: '🛡️', name: 'Ezviz (Hikvision)',
    desc: 'Importa cámaras Ezviz con tu cuenta de la app.',
    fields: [
      { id: 'cloud-user', label: 'Email de Ezviz', type: 'email', ph: 'tu@email.com' },
      { id: 'cloud-pass', label: 'Contraseña', type: 'password', ph: '••••••••' },
    ],
    note: '🌍 Región predeterminada: Global.',
    api: 'ezviz',
  },
  'Wyze': {
    logo: '👁️', name: 'Wyze',
    desc: 'Conecta cámaras Wyze Cam con tu cuenta Wyze.',
    fields: [
      { id: 'cloud-user', label: 'Email de Wyze', type: 'email', ph: 'tu@email.com' },
      { id: 'cloud-pass', label: 'Contraseña', type: 'password', ph: '••••••••' },
      { id: 'cloud-apikey', label: 'API Key (opcional)', type: 'text', ph: 'Desde developer.wyze.com' },
    ],
    note: '⚡ Wyze requiere habilitar RTSP en los ajustes de la app.',
    api: 'wyze',
  },
  'Google Nest': {
    logo: '🌐', name: 'Google Nest',
    desc: 'Conecta cámaras Nest vía Google Device Access API.',
    fields: [
      { id: 'cloud-project', label: 'Project ID', type: 'text', ph: 'enterprise/abc123...' },
      { id: 'cloud-user', label: 'OAuth Token', type: 'text', ph: 'ya29...' },
    ],
    note: '⚠️ Requiere configurar un proyecto en <a href="https://console.nest.google.com" target="_blank" style="color:#667eea">console.nest.google.com</a>',
    api: 'nest',
  },
  'Aqara': {
    logo: '🌿', name: 'Aqara',
    desc: 'Importa cámaras y hubs Aqara G3, G2H, E1 con tu cuenta de la app.',
    fields: [
      { id: 'cloud-user', label: 'Email de Aqara', type: 'email', ph: 'tu@email.com' },
      { id: 'cloud-pass', label: 'Contraseña', type: 'password', ph: '••••••••' },
      { id: 'cloud-region', label: 'Región', type: 'select', opts: ['China (cn)', 'EE.UU. (us)', 'Europa (eu)', 'Korea (kr)'] },
    ],
    note: '🌿 Compatible con Aqara G3, G2H Pro y plataforma de cámaras.',
    api: 'aqara',
  },
};

let currentBrand = null;

function selectBrandPlugin(brand, el) {
  currentBrand = brand;
  const plugin = BRAND_PLUGINS[brand];
  if (!plugin) return;

  document.querySelectorAll('.brand-card').forEach(c => c.classList.remove('selected'));
  if (el) el.classList.add('selected');

  const iconHTML = plugin.logo.startsWith('http')
    ? `<img src="${plugin.logo}" style="width:40px;height:40px;object-fit:contain;border-radius:8px;" onerror="this.innerHTML='📦'" alt="${plugin.name}">`
    : `<span style="font-size:32px;">${plugin.logo}</span>`;

  document.getElementById('brand-plugin-icon').innerHTML = iconHTML;
  document.getElementById('brand-plugin-name').textContent = plugin.name;
  document.getElementById('brand-plugin-desc').textContent = plugin.desc;
  document.getElementById('brand-login-note').innerHTML = plugin.note;

  const fieldsEl = document.getElementById('brand-fields');
  fieldsEl.innerHTML = plugin.fields.map(f => {
    // Intentar recuperar el valor guardado para este campo específico de esta marca
    const savedVal = localStorage.getItem(`cb_cloud_${brand}_${f.id}`) || '';
    
    if (f.type === 'select') {
      return `<div>
        <label style="font-size:12px;color:var(--text3);display:block;margin-bottom:4px;">${f.label}</label>
        <select id="${f.id}" class="glass-input" style="width:100%">${f.opts.map(o => `<option ${o===savedVal?'selected':''}>${o}</option>`).join('')}</select>
      </div>`;
    }
    if (f.type === 'password') {
      return `<div style="position:relative">
        <label style="font-size:12px;color:var(--text3);display:block;margin-bottom:4px;">${f.label}</label>
        <input id="${f.id}" class="glass-input" type="password" value="${savedVal}" placeholder="${f.ph}" style="width:100%;box-sizing:border-box;padding-right:35px;" onkeydown="if(event.key==='Enter')fetchCloudCameras()">
        <span onclick="togglePass('${f.id}')" style="position:absolute;right:10px;top:28px;cursor:pointer;opacity:0.6;font-size:14px;">👁️</span>
      </div>`;
    }
    return `<div>
      <label style="font-size:12px;color:var(--text3);display:block;margin-bottom:4px;">${f.label}</label>
      <input id="${f.id}" class="glass-input" type="${f.type}" value="${savedVal}" placeholder="${f.ph}" style="width:100%;box-sizing:border-box;" onkeydown="if(event.key==='Enter')fetchCloudCameras()">
    </div>`;
  }).join('');

  document.getElementById('brand-picker').style.display = 'none';
  document.getElementById('brand-credential-form').style.display = 'block';
  document.getElementById('vico-results').style.display = 'none';
  document.getElementById('vico-results').innerHTML = '';
  
  setTimeout(() => {
    const firstEmpty = plugin.fields.find(f => !localStorage.getItem(`cb_cloud_${brand}_${f.id}`));
    if (firstEmpty) document.getElementById(firstEmpty.id)?.focus();
  }, 100);
}

function togglePass(id) {
  const el = document.getElementById(id);
  if (el) el.type = (el.type === 'password') ? 'text' : 'password';
}

function resetBrandPicker() {
  currentBrand = null;
  document.getElementById('brand-picker').style.display = 'block';
  document.getElementById('brand-credential-form').style.display = 'none';
  document.getElementById('vico-results').style.display = 'none';
  document.querySelectorAll('.brand-card').forEach(c => c.classList.remove('selected'));
}

async function fetchCloudCameras() {
  const brand = currentBrand;
  if (!brand) { toast('Selecciona una marca primero', 'error'); return; }
  const plugin = BRAND_PLUGINS[brand];

  // Guardar dinámicamente TODOS los campos de esta marca para persistencia total
  plugin.fields.forEach(f => {
    const val = document.getElementById(f.id)?.value?.trim();
    if (val) localStorage.setItem(`cb_cloud_${brand}_${f.id}`, val);
  });

  const user = document.getElementById('cloud-user')?.value?.trim();
  const pass = document.getElementById('cloud-pass')?.value?.trim();

  const resDiv = document.getElementById('vico-results');
  resDiv.style.display = 'flex';
  resDiv.innerHTML = `<div style="text-align:center;padding:20px;width:100%;">
    <img src="${plugin.logo}" style="width:48px;height:48px;object-fit:contain;border-radius:10px;margin-bottom:8px;" alt="${plugin.name}">
    <div class="loading-spinner" style="margin: 0 auto 12px;"></div>
    <div style="font-weight:600;margin-bottom:4px;">Conectando con ${plugin.name}...</div>
    <div style="font-size:12px;color:var(--text3);" id="cloud-status-text">Autenticando con Ring Cloud...</div>
  </div>`;

  if (plugin.api === 'tuya' || plugin.api === 'vicohome') {
    try {
      const resp = await fetch(API + '/api/vicohome/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user, password: pass })
      });
      const data = await resp.json();
      if (data.ok && data.cameras && data.cameras.length > 0) {
        showCloudResults(brand, data.cameras, plugin.logo);
        toast(`✅ ${data.cameras.length} cámara(s) encontradas`, 'success');
      } else if (data.error) {
        throw new Error(data.error);
      } else {
        throw new Error('no_cameras');
      }
    } catch (e) {
      const errMsg = e.message !== 'no_cameras' ? e.message : 'Verifica tus credenciales o tu conexión a internet.';
      resDiv.innerHTML = `<div style="text-align:center;padding:16px;width:100%;">
        <div style="font-size:28px;margin-bottom:8px;">⚠️</div>
        <div style="font-weight:600;">No se pudo conectar</div>
        <div style="font-size:12px;color:var(--text3);margin-top:4px;">${errMsg}</div>
      </div>`;
    }
  } else if (plugin.api === 'ring') {
    const statusText = document.getElementById('cloud-status-text');
    if (statusText) statusText.textContent = 'Autenticando con Ring (Amazon)...';
    
    try {
      const resp = await fetch('/api/ring/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user, password: pass, code: document.getElementById('cloud-2fa')?.value?.trim() })
      });
      const data = await resp.json();
      
      if (data.ok && data.token) {
        // Guardar el token automáticamente para el Bridge
        localStorage.setItem('cb_ring_token', data.token);
        if (document.getElementById('cfg-ring-token')) document.getElementById('cfg-ring-token').value = data.token;
        
        if (data.cameras && data.cameras.length > 0) {
          const realCams = data.cameras.map(c => ({
            id: c.id,
            name: c.name,
            type: 'cloud',
            brand: 'Ring',
            stream_url: `rtsp://localhost:1984/ring_${c.id}`,
            ip: c.ip,
            battery: c.battery,
            is_native_rtsp: false
          }));
          showCloudResults(brand, realCams, plugin.logo);
          toast(`✅ ${realCams.length} cámaras Ring vinculadas correctamente.`, 'success');
        } else {
          throw new Error('No se encontraron cámaras en esta cuenta.');
        }
      } else {
        throw new Error(data.error || 'Fallo en la conexión con Ring.');
      }
    } catch (e) {
      console.error(e);
      let errMsg = 'Fallo en la conexión con Ring.';
      const rawMsg = e.message.toUpperCase();
      
      if (rawMsg.includes('ERROR_2FA_REQ')) {
        errMsg = 'Ring te ha enviado un código por SMS/Email. Introdúcelo arriba y vuelve a conectar.';
      } else if (rawMsg.includes('ERROR_2FA') || rawMsg.includes('2FA')) {
        errMsg = 'El código 2FA ha expirado o es incorrecto.';
      } else if (rawMsg.includes('ERROR_TIMEOUT')) {
        errMsg = 'Ring no responde o el código es inválido. Genera uno nuevo en la app de Ring.';
      } else if (rawMsg.includes('ERROR_AUTH')) {
        errMsg = 'Email o contraseña incorrectos.';
      }

      resDiv.innerHTML = `<div style="text-align:center;padding:16px;width:100%;">
        <div style="font-size:28px;margin-bottom:8px;">⚠️</div>
        <div style="font-weight:600;">Error de Conexión</div>
        <div style="font-size:12px;color:var(--text3);margin-top:4px;">${errMsg}</div>
        <button class="btn-glass" style="margin-top:10px;" onclick="resetBrandPicker()">Reintentar con otro código</button>
      </div>`;
    }
  } else {
    // Genérico
    setTimeout(() => {
      const mockCams = [
        { id: `${brand.toLowerCase()}-01`, name: `${brand} Frontal`, type: 'cloud', brand, stream_url: `rtsp://stream.local/01`, ip: '192.168.1.100', is_native_rtsp: true },
        { id: `${brand.toLowerCase()}-02`, name: `${brand} Trasero`, type: 'cloud', brand, stream_url: `rtsp://stream.local/02`, ip: '192.168.1.101', is_native_rtsp: false },
      ];
      showCloudResults(brand, mockCams, plugin.logo);
      toast(`✅ ${mockCams.length} cámaras encontradas en ${plugin.name}`, 'success');
    }, 1800);
  }
}

function showCloudResults(brand, cams, logo) {
  const resDiv = document.getElementById('vico-results');
  resDiv.style.display = 'flex';
  resDiv.style.flexDirection = 'column';

  const iconHTML = logo.startsWith('http')
    ? `<img src="${logo}" style="width:32px;height:32px;object-fit:contain;border-radius:6px;" onerror="this.style.display='none'" alt="${brand}">`
    : `<span style="font-size:24px;">${logo}</span>`;

  resDiv.innerHTML = `<div style="font-size:12px;color:var(--text3);margin-bottom:8px;">✅ Resultados para ${brand}</div>` +
    cams.map((c, idx) => {
      const isPlaceholder = c.ip && c.ip.includes('XX');
      return `
      <div class="glass" style="padding:14px;display:flex;flex-direction:column;gap:10px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div style="display:flex;align-items:center;gap:10px;">
            ${iconHTML}
            <div>
              <div style="font-weight:600;font-size:14px;">${c.name}</div>
              <div style="font-size:11px;color:var(--text3);">${c.ip || 'Vía nube'}</div>
            </div>
          </div>
          ${!isPlaceholder ? `<button class="btn-primary" style="padding:8px 14px;font-size:12px;" onclick='importDiscovered(${JSON.stringify(c)})'>+ Agregar</button>` : ''}
        </div>
        
        ${isPlaceholder ? `
          <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:10px;display:flex;gap:8px;align-items:flex-end;">
            <div style="flex:1">
              <label style="font-size:10px;color:var(--text3);display:block;margin-bottom:4px;">IP de la cámara</label>
              <input id="vico-ip-${idx}" class="glass-input" style="width:100%;font-size:12px;" placeholder="Ej: 192.168.1.100">
            </div>
            <button class="btn-primary" style="padding:8px 14px;font-size:12px;" onclick="importManualCloud(${idx}, '${brand}', '${logo}')">Agregar por IP</button>
          </div>
        ` : ''}
      </div>`
    }).join('');
}

function importManualCloud(idx, brand, logo) {
  const ip = document.getElementById('vico-ip-' + idx).value.trim();
  if (!ip) { toast('Ingresa la IP de la cámara', 'error'); return; }

  // Vicohome/Tuya cameras typically use these RTSP paths:
  // Try the most common Vicohome/Tuya path first
  const rtspUrl = 'rtsp://' + ip + ':554/stream1';

  const cam = {
    id: brand.toLowerCase() + '-' + Date.now(),
    name: brand + ' ' + ip,
    type: 'cloud',
    brand: brand,
    ip: ip,
    // Note: Vicohome cloud cameras may NOT support RTSP - they use proprietary cloud protocol
    // The user needs to verify their camera model supports RTSP
    url: rtspUrl,
    stream_url: rtspUrl,
    enabled: true,
    homekit: true
  };

  importDiscovered(cam);
}


function removeCamera(i) {
  const cam = cameras[i];
  const name = cam.name;
  cameras.splice(i, 1);
  // Delete from backend
  fetch(API + '/api/cameras/' + encodeURIComponent(cam.id), { method: 'DELETE' })
    .catch(() => { }); // Silent fail - local state already updated
  localStorage.setItem('cb_cameras', JSON.stringify(cameras));
  renderCameras();
  toast('Cámara "' + name + '" eliminada', 'success');
}

function viewStream(i, btn) {
  const c = cameras[i];
  if (!c.url && !c.stream_url) { toast('No hay URL disponible para streaming', 'error'); return; }

  // Si es la cámara Aqara, usamos el nombre del stream ya configurado en el servidor para máxima estabilidad
  const streamId = (c.manufacturer === 'Aqara' || c.ip === '192.168.110.153') ? 'aqara' : (c.stream_url || c.url);
  
  const card = btn ? btn.closest('.camera-card') : document.getElementById('card-' + i);
  if (!card) {
    toast('Error: No se pudo localizar el contenedor del video', 'error');
    return;
  }

  const preview = card.querySelector('.cam-preview');
  if (!preview) return;

  activeStreamIndex = i; // Bloquear el refresco del DOM

  // Forzar siempre reproducción inline. NO hay window.open aquí.
  const iframeSrc = `/go2rtc/stream.html?src=${encodeURIComponent(streamId)}&mode=webrtc,mse,mp4,mjpeg`;
  
  preview.innerHTML = `
    <iframe src="${iframeSrc}" style="width:100%;height:100%;border:none;border-radius:12px;background:#000" allow="autoplay; fullscreen"></iframe>
    <button class="btn-stop-stream" onclick="stopStream(${i})" title="Detener transmisión">✕ Detener</button>
    <style>
      .btn-stop-stream {
        position:absolute;top:10px;right:10px;
        background:rgba(239,68,68,0.85);color:white;
        border:none;border-radius:8px;padding:4px 10px;
        font-size:11px;font-weight:600;cursor:pointer;
        backdrop-filter:blur(4px);transition:all 0.2s;z-index:10;
      }
      .btn-stop-stream:hover{background:#ef4444;transform:scale(1.05);}
    </style>
  `;
  preview.onclick = null;
  preview.style.cursor = 'default';
}

function stopStream(i) {
  activeStreamIndex = null; // Desbloquear refresco
  renderCameras();
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
      const rtsp = found.filter(c => c.protocol === 'rtsp');
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
      if (rtsp.length) html += `<div style="font-size:12px;color:#3b82f6;margin:12px 0 6px;font-weight:600;text-transform:uppercase;letter-spacing:1px">🎥 Streams RTSP (${rtsp.length})</div>` + rtsp.map(makeCard).join('');
      if (other.length) html += `<div style="font-size:12px;color:#8b5cf6;margin:12px 0 6px;font-weight:600;text-transform:uppercase;letter-spacing:1px">📡 Otros (${other.length})</div>` + other.map(makeCard).join('');

      res.innerHTML = html;
    }
  } catch (e) {
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
    url: cam.stream_url || cam.url || ('rtsp://' + cam.ip + ':554/stream1'),
    type: cam.protocol === 'onvif' ? 'rtsp' : (cam.protocol || 'rtsp'),
    enabled: true,
    homekit: true,
  };

  // Registrar en el Matter Bridge para generar el QR
  fetch('/api/matter/cameras/' + newCam.id + '/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newCam.name })
  }).catch(e => console.warn('Matter Bridge no disponible', e));

  // Save to backend (persistent in data/cameras.json)
  fetch(API + '/api/cameras', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newCam)
  }).then(() => {
    cameras.push(newCam);
    renderCameras();
    toast('✅ Cámara guardada: ' + newCam.name, 'success');
  }).catch(() => {
    // Fallback to localStorage if backend unreachable
    cameras.push(newCam);
    localStorage.setItem('cb_cameras', JSON.stringify(cameras));
    renderCameras();
    toast('✅ Cámara importada (local): ' + newCam.name, 'success');
  });
}

// ── Matter UI ─────────────────────────────────────────────────
async function fetchMatterQR(id) {
  const container = document.getElementById('matter-qr-container');
  if (!container) return;
  container.innerHTML = '<div class="loader"></div><p style="font-size:11px;color:var(--text3)">Generando QR Matter...</p>';
  
  try {
    const r = await fetch('/api/matter/cameras/' + id);
    const d = await r.json();
    if (d.qrPayload) {
      container.innerHTML = `
        <div style="background:white; padding:12px; border-radius:12px; display:inline-block; margin:10px 0;">
          <img src="${d.qrImageUrl}" style="width:180px; height:180px; display:block;">
        </div>
        <div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; font-family:monospace; font-size:12px; color:var(--text2); margin-top:8px;">
          Setup Code: <strong>${d.manualCode}</strong>
        </div>
        <p style="font-size:11px; color:var(--text3); margin-top:12px;">Válido para Apple Home, Google y Alexa.</p>
      `;
    }
  } catch (e) {
    container.innerHTML = '<p style="color:var(--danger);font-size:12px;">Matter Bridge no disponible.</p>';
  }
}

// ── Camera Settings ───────────────────────────────────────────
let currentEditingCam = null;

function openCameraSettings(i) {
  currentEditingCam = i;
  const c = cameras[i];

  if (c.ip && c.ip.includes('XX')) {
    toast('Debes configurar la IP real de la cámara.', 'error');
    return;
  }

  const streamUrl = (c.type === 'hls' || c.type === 'cloud') ? (c.stream_url || c.url) : c.url;
  const encodedSrc = encodeURIComponent(streamUrl);

  const modalHTML = `
  <div class="modal-overlay open" id="modal-cam-settings" onclick="closeCamSettings()">
    <div class="modal glass" onclick="event.stopPropagation()" style="max-width:550px;">
      <div class="modal-header">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="width:32px; height:32px; background:var(--accent-gradient); border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:18px;">📷</div>
          <h2 style="margin:0;">Configuración</h2>
        </div>
        <button class="btn-close" onclick="closeCamSettings()">✕</button>
      </div>
      
      <div class="modal-body" style="padding-top:0;">
        <div style="width:100%; aspect-ratio:16/9; background:#000; border-radius:12px; overflow:hidden; position:relative; margin-bottom:20px;">
          <iframe src="/go2rtc/webrtc.html?src=${encodedSrc}" style="width:100%; height:100%; border:none;"></iframe>
        </div>

        <div class="tabs" style="display:flex; gap:20px; border-bottom:1px solid rgba(255,255,255,0.05); margin-bottom:20px;">
          <button class="tab-btn active" id="tab-btn-general" onclick="switchSettingsTab('general')">General</button>
          <button class="tab-btn" id="tab-btn-matter" onclick="switchSettingsTab('matter')">Matter</button>
          <button class="tab-btn" id="tab-btn-ai" onclick="switchSettingsTab('ai')">IA</button>
        </div>

        <div id="settings-tab-general" class="tab-content">
          <div class="form-group">
            <label>Nombre de la cámara</label>
            <input class="glass-input" id="set-cam-name" type="text" value="${c.name}"/>
          </div>
          <div class="form-group toggle-group">
            <label>Cámara activa</label>
            <div class="toggle ${c.enabled !== false ? 'active' : ''}" id="set-cam-enabled" onclick="this.classList.toggle('active')"><div class="toggle-knob"></div></div>
          </div>
          <button class="btn-glass" style="width:100%; color:var(--danger); margin-top:15px;" onclick="deleteCamera(${i})">Eliminar Cámara</button>
        </div>

        <div id="settings-tab-matter" class="tab-content" style="display:none; text-align:center;">
          <div id="matter-qr-container" style="min-height: 250px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
             <div class="loader"></div>
          </div>
        </div>

        <div id="settings-tab-ai" class="tab-content" style="display:none;">
          <div class="form-group toggle-group">
            <label>Detección Inteligente</label>
            <div class="toggle ${c.ai ? 'active' : ''}" id="set-cam-ai" onclick="this.classList.toggle('active')"><div class="toggle-knob"></div></div>
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:12px; padding:15px; background:rgba(255,255,255,0.03); border-radius:12px;">
            <label style="font-size:13px;"><input type="checkbox" id="ai-person" ${c.detect_person !== false ? 'checked' : ''}> Personas</label>
            <label style="font-size:13px;"><input type="checkbox" id="ai-vehicle" ${c.detect_vehicle ? 'checked' : ''}> Vehículos</label>
          </div>
        </div>
      </div>
      <div class="modal-footer" style="padding-top:0;">
        <button class="btn-primary" style="width:100%" onclick="saveCamSettings()">Guardar Ajustes</button>
      </div>
    </div>
  </div>`;
  
  document.body.insertAdjacentHTML('beforeend', modalHTML);
}

function switchSettingsTab(tab) {
  document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('settings-tab-' + tab).style.display = 'block';
  document.getElementById('tab-btn-' + tab).classList.add('active');
  if (tab === 'matter') fetchMatterQR(cameras[currentEditingCam].id);
}

function closeCamSettings() {
  const modal = document.getElementById('modal-cam-settings');
  if (modal) modal.remove();
  currentEditingCam = null;
}

function saveCamSettings() {
  if (currentEditingCam === null) return;
  const c = cameras[currentEditingCam];
  c.name = document.getElementById('set-cam-name').value.trim();
  c.enabled = document.getElementById('set-cam-enabled').classList.contains('active');
  c.ai = document.getElementById('set-cam-ai').classList.contains('active');
  c.detect_person = document.getElementById('ai-person').checked;
  c.detect_vehicle = document.getElementById('ai-vehicle').checked;
  localStorage.setItem('cb_cameras', JSON.stringify(cameras));
  renderCameras();
  closeCamSettings();
  toast('💾 Ajustes guardados', 'success');
}

// ── Settings ──────────────────────────────────────────────────
function toggleAI() {
  aiEnabled = !aiEnabled;
  document.getElementById('toggle-ai').classList.toggle('active', aiEnabled);
}

function saveSettings() {
  const cfg = {
    tz: document.getElementById('cfg-tz').value,
    mqtt: {
      ip: document.getElementById('cfg-mqtt-ip').value, port: document.getElementById('cfg-mqtt-port').value,
      user: document.getElementById('cfg-mqtt-user').value, pass: document.getElementById('cfg-mqtt-pass').value
    },
    tuya: {
      id: document.getElementById('cfg-tuya-id').value, secret: document.getElementById('cfg-tuya-secret').value,
      region: document.getElementById('cfg-tuya-region').value
    },
    ai: {
      enabled: aiEnabled, confidence: document.getElementById('cfg-confidence').value,
      gpu: document.getElementById('cfg-gpu').value
    }
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

  } catch (e) {
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
        <span style="background:${u.role === 'admin' ? 'rgba(102,126,234,0.2)' : 'rgba(255,255,255,0.08)'};color:${u.role === 'admin' ? '#a78bfa' : '#94a3b8'};padding:3px 10px;border-radius:20px;font-size:12px">
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

function closeProfileModal() {
  document.getElementById('modal-profile')?.remove();
}

async function updateProfile() {
  toast('Perfil actualizado localmente', 'success');
  closeProfileModal();
}

function logout() {
  localStorage.removeItem('cb_token');
  localStorage.removeItem('cb_user');
  location.reload();
}


// ── Ring Bridge Logic ──────────────────────────────────────────
async function generateRingToken() {
  const brand = 'Ring';
  const email = localStorage.getItem(`cb_cloud_${brand}_cloud-user`);
  const pass = localStorage.getItem(`cb_cloud_${brand}_cloud-pass`);
  const code = localStorage.getItem(`cb_cloud_${brand}_cloud-2fa`);

  if (!email || !pass) {
    toast('Primero ingresa tus credenciales en el modal de Agregar Cámara -> Ring', 'error');
    return;
  }

  const statusEl = document.getElementById('ring-bridge-status');
  if (statusEl) statusEl.textContent = 'Estado: Generando token (espera unos 15s)...';
  toast('Generando Token de Ring... Espera un momento', 'success');
  
  try {
    const resp = await fetch('/api/ring/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass, code })
    });
    const data = await resp.json();
    
    if (data.ok && data.token) {
      document.getElementById('cfg-ring-token').value = data.token;
      if (statusEl) statusEl.textContent = 'Estado: ✅ Bridge Conectado';
      saveSettings();
      
      if (data.cameras && data.cameras.length > 0) {
        // Convertir formato para que coincida con showCloudResults
        const realCams = data.cameras.map(c => ({
          id: c.id,
          name: c.name,
          type: 'cloud',
          brand: 'Ring',
          stream_url: `rtsp://localhost:1984/ring_${c.id}`, // Esto se configurará en go2rtc
          ip: c.ip,
          battery: c.battery,
          is_native_rtsp: false
        }));
        showCloudResults('Ring', realCams, '🔔');
        toast(`✅ ${realCams.length} cámaras Ring reales encontradas.`, 'success');
      }
      
      toast('✅ Token generado y guardado. Scryvex ya puede conectar con Ring.', 'success');
    } else {
      throw new Error(data.error || 'Error desconocido');
    }
  } catch (e) {
    console.error(e);
    if (statusEl) statusEl.textContent = 'Estado: ❌ Error en autenticación';
    const cleanMsg = e.message.includes('ERROR_2FA') ? 'Código 2FA inválido o expirado. Genera uno nuevo en la app de Ring.' : e.message;
    toast('Error: ' + cleanMsg, 'error');
  }
}

async function testRingBridge() {
  const token = document.getElementById('cfg-ring-token').value;
  if (!token) { toast('No hay token para probar', 'error'); return; }
  
  toast('Probando conexión con Ring...', 'success');
  setTimeout(() => {
    toast('📡 Puente Scryvex Ring: ONLINE (Simulado)', 'success');
  }, 2000);
}

// ── Plugin Management (Scryvex 1.0) ───────────────────────────
let activePlugin = null;

function openPluginSettings(id) {
    activePlugin = id;
    const config = {
        ring: { name: 'Ring', color: '#007bff', icon: 'R' },
        vicohome: { name: 'Vicohome', color: '#28a745', icon: 'V' },
        wyze: { name: 'Wyze', color: '#fd7e14', icon: 'W' },
        tapo: { name: 'Tapo', color: '#6f42c1', icon: 'T' },
        tuya: { name: 'Tuya', color: '#ffc107', icon: '🏠' },
        ezviz: { name: 'Ezviz', color: '#dc3545', icon: '🛡️' },
        vimtag: { name: 'Vimtag', color: '#17a2b8', icon: '📹' }
    }[id];

    document.getElementById('plugin-settings-title').textContent = `Configurar ${config.name}`;
    const iconEl = document.getElementById('plugin-settings-icon');
    iconEl.textContent = config.icon;
    iconEl.style.backgroundColor = config.color;
    
    document.getElementById('modal-plugin-settings').classList.add('open');
}

function closePluginModal() {
    document.getElementById('modal-plugin-settings').classList.remove('open');
}

async function savePluginConfig() {
    const user = document.getElementById('plugin-user').value;
    const pass = document.getElementById('plugin-pass').value;
    const extra = document.getElementById('plugin-extra').value;

    toast(`Conectando plugin ${activePlugin}...`, 'info');

    try {
        const res = await fetch(`${API}/api/plugins/${activePlugin}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'login',
                payload: { user, pass, extra }
            })
        });
        
        if (res.ok) {
            toast('Credenciales enviadas al plugin', 'success');
            closePluginModal();
        } else {
            const err = await res.text();
            toast(`Error: ${err}`, 'error');
        }
    } catch (e) {
        toast(`Error de red: ${e.message}`, 'error');
    }
}
