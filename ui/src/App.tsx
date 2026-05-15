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
  const [newCam, setNewCam] = useState({ name: '', url: '', username: '', password: '' })
  const [currentView, setCurrentView] = useState('dashboard')
  const [selectedCam, setSelectedCam] = useState<any>(null)

  const fetchCameras = () => {
    fetch('http://localhost:1994/api/cameras')
      .then(res => res.json())
      .then(data => setCameras(data || []))
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

      // También refrescar lista de cámaras en cada ciclo
      fetchCameras()
    }

    fetchData()
    const interval = setInterval(fetchData, 3000)
    return () => clearInterval(interval)
  }, [])

  const handleAddCamera = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      let finalUrl = newCam.url
      if (newCam.username && newCam.password) {
        if (newCam.url.includes('://')) {
          const parts = newCam.url.split('://')
          finalUrl = `${parts[0]}://${encodeURIComponent(newCam.username)}:${encodeURIComponent(newCam.password)}@${parts[1]}`
        }
      }

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

      if (res.ok) {
        await fetch(`http://localhost:1984/api/streams?name=${encodeURIComponent(newCam.name)}&src=${encodeURIComponent(finalUrl)}`, {
          method: 'PUT'
        })

        setShowAddModal(false)
        setNewCam({ name: '', url: '', username: '', password: '' })
        fetchCameras()
      }
    } catch (err) {
      alert('Error saving camera.')
    }
  }

  const handleDeleteCamera = async (id: number, name: string) => {
    if (!window.confirm(`¿Estás seguro de que quieres eliminar la cámara "${name}"?`)) return

    try {
      const res = await fetch(`http://localhost:1994/api/cameras/${id}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        await fetch(`http://localhost:1984/api/streams?name=${encodeURIComponent(name)}`, {
          method: 'DELETE'
        })
        fetchCameras()
      }
    } catch (err) {
      alert('Error deleting camera')
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
            {cameras.map((cam, idx) => (
              <div key={idx} className="camera-item glass">
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
        <button className="btn-primary" onClick={() => setShowAddModal(true)}>
          <span>➕</span> Add Camera
        </button>
      </div>
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
            {cameras.map((cam, idx) => (
              <tr key={idx}>
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
          <header className="glass header-nav">
            <div className="header-left">
              <h1>{currentView === 'dashboard' ? 'Overview' : 'Cameras'}</h1>
              <p className="subtitle">Scryvex v2.0 • Pro Surveillance Hub</p>
            </div>
            <div className="system-status">
              {status ? (
                <div className="status-indicator online">
                  <span className="pulse"></span>
                  CORE ONLINE
                </div>
              ) : (
                <div className="status-indicator offline">
                  OFFLINE
                </div>
              )}
            </div>
          </header>

          <div className="content-area">
            {currentView === 'dashboard' ? renderDashboard() : renderCamerasView()}
          </div>
        </main>
      </div>

      {/* MODAL: ADD CAMERA */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="glass modal-content">
            <div className="modal-header">
              <h2>Connect Device</h2>
              <p>Register a new RTSP camera to your hub</p>
            </div>
            <form onSubmit={handleAddCamera}>
              <div className="form-group">
                <label>Device Name</label>
                <input
                  type="text"
                  value={newCam.name}
                  onChange={e => setNewCam({...newCam, name: e.target.value})}
                  placeholder="Ej: Aqara G410"
                  required
                />
              </div>
              <div className="form-group">
                <label>RTSP URL</label>
                <input
                  type="text"
                  value={newCam.url}
                  onChange={e => setNewCam({...newCam, url: e.target.value})}
                  placeholder="rtsp://192.168.1.10:554/stream"
                  required
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Username</label>
                  <input
                    type="text"
                    value={newCam.username}
                    onChange={e => setNewCam({...newCam, username: e.target.value})}
                    placeholder="admin"
                  />
                </div>
                <div className="form-group">
                  <label>Password</label>
                  <input
                    type="password"
                    value={newCam.password}
                    onChange={e => setNewCam({...newCam, password: e.target.value})}
                    placeholder="••••••••"
                  />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Verify & Add Device</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: PLAYER */}
      {selectedCam && (
        <div className="modal-overlay" onClick={() => setSelectedCam(null)}>
          <div className="glass player-modal" onClick={e => e.stopPropagation()}>
            <div className="player-header">
              <div className="player-title">
                <span className="live-dot"></span>
                <h3>{selectedCam.name} - LIVE FEED</h3>
              </div>
              <button className="btn-close" onClick={() => setSelectedCam(null)}>×</button>
            </div>
            <div className="video-container">
              <iframe
                src={`http://localhost:1984/webrtc.html?src=${encodeURIComponent(selectedCam.name)}`}
                style={{ border: 'none' }}
                scrolling="no"
                width="100%"
                height="100%"
                allowFullScreen
              ></iframe>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
