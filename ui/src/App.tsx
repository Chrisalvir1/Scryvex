import React, { useState, useEffect, useRef } from 'react'
import './App.css'
import './Modal.css'
import './Views.css'
import './Player.css'

function App() {
  const [status, setStatus] = useState<any>(null)
  const [systemInfo, setSystemInfo] = useState({ cpu: 0, memory: 0 })
  const [showAddModal, setShowAddModal] = useState(false)
  const [cameras, setCameras] = useState<any[]>([])
  const [newCam, setNewCam] = useState({ name: '', url: '', type: 'rtsp' })
  const [currentView, setCurrentView] = useState('dashboard')
  const [selectedCam, setSelectedCam] = useState<any>(null)

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
    }

    const fetchCameras = () => {
      fetch('http://localhost:1994/api/cameras')
        .then(res => res.json())
        .then(data => setCameras(data || []))
        .catch(err => console.error(err))
    }
    
    fetchData()
    fetchCameras()
    const interval = setInterval(fetchData, 3000)
    return () => clearInterval(interval)
  }, [])

  const handleAddCamera = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      // 1. Guardar en DB
      const res = await fetch('http://localhost:1994/api/cameras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCam)
      })
      
      if (res.ok) {
        // 2. Registrar en go2rtc dinámicamente
        await fetch(`http://localhost:1984/api/streams?name=${encodeURIComponent(newCam.name)}&src=${encodeURIComponent(newCam.url)}`, {
          method: 'PUT'
        })

        setShowAddModal(false)
        setNewCam({ name: '', url: '', type: 'rtsp' })
        const d = await fetch('http://localhost:1994/api/cameras').then(r => r.json())
        setCameras(d || [])
      }
    } catch (err) {
      alert('Error saving camera')
    }
  }

  const renderDashboard = () => (
    <section className="grid">
      <div className="glass card hero">
        <div className="card-header">
          <h3>Live Monitoring</h3>
          <span className="badge">ACTIVE</span>
        </div>
        
        {cameras.length === 0 ? (
          <div className="empty-state">
            <div className="icon">📹</div>
            <p>No active video streams</p>
            <button className="btn-secondary" onClick={() => setShowAddModal(true)}>Setup Camera</button>
          </div>
        ) : (
          <div className="camera-grid">
            {cameras.map((cam, idx) => (
              <div key={idx} className="camera-item glass">
                <div className="cam-placeholder">
                  <div className="cam-info">
                    <span className="cam-name">{cam.name}</span>
                    <span className="cam-url">{cam.url.substring(0, 30)}...</span>
                  </div>
                  <button className="btn-view" onClick={() => setSelectedCam(cam)}>VIEW LIVE</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      <div className="glass card stats">
        <h3>System Health</h3>
        <div className="stat-row">
          <div className="stat-label"><span>CPU Usage</span><span>{Math.round(systemInfo.cpu)}%</span></div>
          <div className="progress-bar"><div className="fill" style={{width: `${systemInfo.cpu}%`}}></div></div>
        </div>
        <div className="stat-row">
          <div className="stat-label"><span>Memory</span><span>{Math.round(systemInfo.memory)}%</span></div>
          <div className="progress-bar"><div className="fill" style={{width: `${systemInfo.memory}%`}}></div></div>
        </div>
      </div>

      <div className="glass card actions">
        <h3>Quick Actions</h3>
        <div className="action-grid">
          <button className="glass-btn" onClick={() => setShowAddModal(true)}>Add Device</button>
          <button className="glass-btn" onClick={() => alert('Searching network...')}>Scan</button>
          <button className="glass-btn" onClick={() => setCurrentView('cameras')}>Manage</button>
        </div>
      </div>
    </section>
  )

  const renderCameras = () => (
    <section className="view-container">
      <div className="view-header">
        <h2>Camera Management</h2>
        <button className="btn-primary" onClick={() => setShowAddModal(true)}>+ Add Camera</button>
      </div>
      <div className="glass card full-width">
        <table className="cam-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>URL</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {cameras.map((cam, idx) => (
              <tr key={idx}>
                <td>{cam.name}</td>
                <td>{cam.url}</td>
                <td><span className="dot active"></span> Online</td>
                <td>
                  <button className="btn-icon" onClick={() => setSelectedCam(cam)}>👁️</button>
                  <button className="btn-icon red">🗑️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )

  return (
    <div className="container">
      <div className="liquid-bg">
        <div className="blob"></div>
        <div className="blob blob-2"></div>
      </div>

      <nav className="glass sidebar">
        <div className="logo">SCRYVEX</div>
        <ul className="nav-links">
          <li className={currentView === 'dashboard' ? 'active' : ''} onClick={() => setCurrentView('dashboard')}>Dashboard</li>
          <li className={currentView === 'cameras' ? 'active' : ''} onClick={() => setCurrentView('cameras')}>Cameras</li>
          <li onClick={() => alert('Events coming in next phase')}>Events</li>
          <li onClick={() => alert('Settings coming in next phase')}>Settings</li>
        </ul>
      </nav>

      <main className="dashboard-content">
        <header className="glass top-nav">
          <div className="header-left">
            <h1>{currentView === 'dashboard' ? 'Overview' : 'Cameras'}</h1>
            <p className="subtitle">Scryvex v2.0 • Pro Surveillance</p>
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

        {currentView === 'dashboard' ? renderDashboard() : renderCameras()}
      </main>

      {/* MODAL: ADD CAMERA */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="glass modal-content">
            <h2>Add New Camera</h2>
            <form onSubmit={handleAddCamera}>
              <div className="form-group">
                <label>Camera Name</label>
                <input 
                  type="text" 
                  value={newCam.name} 
                  onChange={e => setNewCam({...newCam, name: e.target.value})}
                  placeholder="Ej: Patio Trasero"
                  required
                />
              </div>
              <div className="form-group">
                <label>Stream URL (RTSP)</label>
                <input 
                  type="text" 
                  value={newCam.url} 
                  onChange={e => setNewCam({...newCam, url: e.target.value})}
                  placeholder="rtsp://usuario:password@ip:554/ch1"
                  required
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Connect Device</button>
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
              <h3>{selectedCam.name}</h3>
              <button className="btn-close" onClick={() => setSelectedCam(null)}>×</button>
            </div>
            <div className="video-container">
              <iframe 
                src={`http://localhost:1984/webrtc.html?src=${encodeURIComponent(selectedCam.name)}`}
                frameBorder="0"
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
