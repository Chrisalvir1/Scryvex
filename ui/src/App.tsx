import React, { useState, useEffect } from 'react'
import './App.css'
import './Modal.css'
import './Views.css'
import './Player.css'
import './CameraCard.css'

function App() {
  const [status, setStatus] = useState<any>(null)
  const [systemInfo, setSystemInfo] = useState({ cpu: 0, memory: 0 })
  const [showAddModal, setShowAddModal] = useState(false)
  const [cameras, setCameras] = useState<any[]>([])
  const [deletedCameras, setDeletedCameras] = useState<any[]>([])
  const [newCam, setNewCam] = useState({ name: '', url: '', username: '', password: '' })
  const [currentView, setCurrentView] = useState('dashboard')
  const [selectedCam, setSelectedCam] = useState<any>(null)
  const [showTrash, setShowTrash] = useState(false)

  const fetchCameras = () => {
    fetch('http://localhost:1994/api/cameras')
      .then(res => res.json())
      .then(data => setCameras(data || []))
      .catch(err => console.error(err))
  }

  const fetchDeletedCameras = () => {
    fetch('http://localhost:1994/api/cameras/deleted')
      .then(res => res.json())
      .then(data => setDeletedCameras(data || []))
      .catch(err => console.error(err))
  }

  useEffect(() => {
    const fetchData = async () => {
      try {
        const sRes = await fetch('http://localhost:1994/api/status')
        const sData = await sRes.json()
        setStatus(sData)
      } catch (e) { setStatus(null) }

      try {
        const sysRes = await fetch('http://localhost:1994/api/system')
        const sysData = await sysRes.json()
        setSystemInfo(sysData)
      } catch (e) { console.error(e) }

      fetchCameras()
    }

    fetchData()
    const interval = setInterval(fetchData, 3000)
    return () => clearInterval(interval)
  }, [])

  // Construir URL final con credenciales sin duplicarlas
  const buildFinalUrl = (rawUrl: string, username: string, password: string): string => {
    if (!username || !password) return rawUrl
    try {
      const parsed = new URL(rawUrl)
      // Si ya tiene credenciales en la URL no las duplicar
      if (parsed.username || parsed.password) return rawUrl
      parsed.username = encodeURIComponent(username)
      parsed.password = encodeURIComponent(password)
      return parsed.toString()
    } catch {
      // URL no estándar — insertar manualmente solo si no tiene credenciales
      if (rawUrl.includes('@')) return rawUrl
      if (rawUrl.includes('://')) {
        const [scheme, rest] = rawUrl.split('://')
        return `${scheme}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${rest}`
      }
      return rawUrl
    }
  }

  const handleAddCamera = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const finalUrl = buildFinalUrl(newCam.url, newCam.username, newCam.password)
      const hasAuth = !!(newCam.username && newCam.password)

      const res = await fetch('http://localhost:1994/api/cameras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCam.name,
          url: finalUrl,
          has_auth: hasAuth
        })
      })
      // go2rtc ahora lo registra el backend — no duplicar aquí

      if (res.ok) {
        setShowAddModal(false)
        setNewCam({ name: '', url: '', username: '', password: '' })
        fetchCameras()
      }
    } catch (err) {
      alert('Error saving camera.')
    }
  }

  const handleDeleteCamera = async (id: number, name: string) => {
    if (!id) {
      alert('No se pudo obtener el ID de la cámara.')
      return
    }
    if (!window.confirm(`¿Eliminar la cámara "${name}"? Podrás restaurarla desde la papelera.`)) return

    try {
      const res = await fetch(`http://localhost:1994/api/cameras/${id}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        fetchCameras()
        fetchDeletedCameras()
      }
    } catch (err) {
      alert('Error deleting camera')
    }
  }

  const handleRestoreCamera = async (id: number, name: string) => {
    try {
      const res = await fetch(`http://localhost:1994/api/cameras/${id}/restore`, {
        method: 'POST'
      })
      if (res.ok) {
        fetchCameras()
        fetchDeletedCameras()
      } else {
        alert(`Error al restaurar la cámara "${name}"`)
      }
    } catch (err) {
      alert('Error restaurando cámara')
    }
  }

  const renderDashboard = () => (
    <div className="dashboard-layout">
      <div className="glass main-content-card">
        <div className="card-header">
          <div className="header-titles">
            <h3>Live Monitoring</h3>
            <p className="card-subtitle">Real-time surveillance feeds</p>
          </div>
          <span className="badge">ACTIVE</span>
        </div>

        {cameras.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📹</div>
            <p>No active video streams</p>
            <button className="btn-primary" onClick={() => setShowAddModal(true)}>+ Add First Camera</button>
          </div>
        ) : (
          <div className="camera-grid">
            {cameras.map((cam) => (
              <div key={cam.ID} className="camera-item glass">
                <div className="cam-preview-placeholder">
                  <span className="icon-large">📹</span>
                  <div className="cam-status-overlay">
                    {!cam.has_auth && <span className="auth-warning">🔐 AUTH?</span>}
                    <span className="live-dot-container"><span className="live-dot"></span> LIVE</span>
                  </div>
                </div>
                <div className="cam-details">
                  <span className="cam-name">{cam.name}</span>
                  <span className="cam-url-sub">{cam.url.replace(/:.*@/, ':****@')}</span>
                  <div className="cam-footer">
                    <button className="btn-view-live" onClick={() => setSelectedCam(cam)}>VIEW STREAM</button>
                    <button className="btn-mini-delete" onClick={() => handleDeleteCamera(cam.ID, cam.name)}>🗑️</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="side-panel">
        <div className="glass side-card stats">
          <h3>System Health</h3>
          <div className="stat-group">
            <div className="stat-label"><span>CPU Usage</span><span>{Math.round(systemInfo.cpu)}%</span></div>
            <div className="progress-bar"><div className="fill" style={{width: `${systemInfo.cpu}%`}}></div></div>
          </div>
          <div className="stat-group">
            <div className="stat-label"><span>Memory</span><span>{Math.round(systemInfo.memory)}%</span></div>
            <div className="progress-bar"><div className="fill" style={{width: `${systemInfo.memory}%`}}></div></div>
          </div>
        </div>

        <div className="glass side-card actions">
          <h3>Quick Actions</h3>
          <div className="action-list">
            <button className="action-btn-wide" onClick={() => setShowAddModal(true)}>
              <span className="icon">➕</span> Add New Device
            </button>
            <button className="action-btn-wide" onClick={() => setCurrentView('cameras')}>
              <span className="icon">⚙️</span> Manage All
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  const renderCamerasView = () => (
    <div className="view-container">
      <div className="view-header">
        <h2>Camera Management</h2>
        <div style={{display:'flex', gap:'0.75rem'}}>
          <button
            className="btn-secondary"
            onClick={() => { setShowTrash(!showTrash); fetchDeletedCameras() }}
          >
            🗑️ Papelera {deletedCameras.length > 0 && `(${deletedCameras.length})`}
          </button>
          <button className="btn-primary" onClick={() => setShowAddModal(true)}>
            <span>➕</span> Add Camera
          </button>
        </div>
      </div>

      {/* Tabla de cámaras activas */}
      <div className="glass full-width">
        <table className="cam-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Stream URL</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {cameras.map((cam) => (
              <tr key={cam.ID}>
                <td style={{fontWeight: 700}}>{cam.name}</td>
                <td style={{opacity: 0.6, fontFamily: 'monospace'}}>{cam.url.replace(/:.*@/, ':****@')}</td>
                <td>
                  <div className="status-cell">
                    <span className={`dot ${cam.has_auth ? 'active' : 'warning'}`}></span>
                    {cam.has_auth ? 'Connected' : 'Credentials Required'}
                  </div>
                </td>
                <td>
                  <div className="actions-cell">
                    <button className="btn-action" title="View Stream" onClick={() => setSelectedCam(cam)}>👁️</button>
                    <button className="btn-action red" title="Delete Camera" onClick={() => handleDeleteCamera(cam.ID, cam.name)}>🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
            {cameras.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-table-msg">No cameras registered.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Papelera — cámaras eliminadas */}
      {showTrash && (
        <div className="glass full-width" style={{marginTop: '1.5rem'}}>
          <div style={{padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.08)'}}>
            <h3 style={{margin: 0}}>🗑️ Papelera — Cámaras Eliminadas</h3>
            <p style={{margin: '0.25rem 0 0', opacity: 0.6, fontSize: '0.85rem'}}>Puedes restaurar cualquier cámara eliminada aquí.</p>
          </div>
          <table className="cam-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Stream URL</th>
                <th>Eliminada</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {deletedCameras.map((cam) => (
                <tr key={cam.ID} style={{opacity: 0.7}}>
                  <td style={{fontWeight: 700}}>{cam.name}</td>
                  <td style={{opacity: 0.6, fontFamily: 'monospace'}}>{cam.url.replace(/:.*@/, ':****@')}</td>
                  <td style={{fontSize: '0.8rem', opacity: 0.5}}>
                    {cam.DeletedAt ? new Date(cam.DeletedAt).toLocaleString() : '—'}
                  </td>
                  <td>
                    <div className="actions-cell">
                      <button
                        className="btn-action"
                        title="Restaurar cámara"
                        onClick={() => handleRestoreCamera(cam.ID, cam.name)}
                      >♻️ Restaurar</button>
                    </div>
                  </td>
                </tr>
              ))}
              {deletedCameras.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty-table-msg">La papelera está vacía.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  return (
    <div className="app-root">
      <div className="liquid-bg">
        <div className="blob"></div>
        <div className="blob blob-2"></div>
      </div>

      <div className="app-container">
        <aside className="glass sidebar">
          <div className="logo-area">
            <div className="logo-icon">S</div>
            <div className="logo-text">SCRYVEX</div>
          </div>
          <ul className="nav-links">
            <li className={currentView === 'dashboard' ? 'active' : ''} onClick={() => setCurrentView('dashboard')}>Dashboard</li>
            <li className={currentView === 'cameras' ? 'active' : ''} onClick={() => setCurrentView('cameras')}>Cameras</li>
            <li onClick={() => alert('Coming soon...')}>Events</li>
            <li onClick={() => alert('Coming soon...')}>Settings</li>
          </ul>
          <div className="sidebar-footer">
            <div className="version-tag">v2.0.0 PRO</div>
          </div>
        </aside>

        <main className="main-content">
          <header className="glass topbar">
            <div className="topbar-left">
              <span className="topbar-title">
                {currentView === 'dashboard' ? 'System Dashboard' : 'Camera Management'}
              </span>
            </div>
            <div className="topbar-right">
              <span className={`status-pill ${status ? 'ok' : 'offline'}`}>
                {status ? '● ONLINE' : '○ OFFLINE'}
              </span>
            </div>
          </header>

          <div className="content-area">
            {currentView === 'dashboard' && renderDashboard()}
            {currentView === 'cameras' && renderCamerasView()}
          </div>
        </main>
      </div>

      {/* Modal agregar cámara */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-glass" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add New Camera</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>✕</button>
            </div>
            <form onSubmit={handleAddCamera} className="modal-form">
              <div className="form-group">
                <label>Camera Name</label>
                <input
                  type="text"
                  placeholder="e.g. Front Door"
                  value={newCam.name}
                  onChange={e => setNewCam({...newCam, name: e.target.value})}
                  required
                />
              </div>
              <div className="form-group">
                <label>Stream URL (RTSP / HTTP)</label>
                <input
                  type="text"
                  placeholder="rtsp://192.168.1.x:554/stream"
                  value={newCam.url}
                  onChange={e => setNewCam({...newCam, url: e.target.value})}
                  required
                />
              </div>
              <div className="form-group">
                <label>Username <span style={{opacity:0.5}}>(opcional)</span></label>
                <input
                  type="text"
                  placeholder="admin"
                  value={newCam.username}
                  onChange={e => setNewCam({...newCam, username: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label>Password <span style={{opacity:0.5}}>(opcional)</span></label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={newCam.password}
                  onChange={e => setNewCam({...newCam, password: e.target.value})}
                />
              </div>
              <p style={{fontSize:'0.78rem', opacity:0.5, margin:'-0.25rem 0 0.5rem'}}>
                Si la URL ya contiene usuario:contraseña, deja estos campos en blanco.
              </p>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Save Camera</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal ver stream */}
      {selectedCam && (
        <div className="modal-overlay" onClick={() => setSelectedCam(null)}>
          <div className="modal-glass wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📹 {selectedCam.name}</h3>
              <button className="modal-close" onClick={() => setSelectedCam(null)}>✕</button>
            </div>
            <div className="stream-container">
              <iframe
                src={`http://localhost:1984/stream.html?src=${encodeURIComponent(selectedCam.name)}&mode=webrtc`}
                style={{width:'100%', height:'400px', border:'none', borderRadius:'8px', background:'#000'}}
                allowFullScreen
                title={selectedCam.name}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
