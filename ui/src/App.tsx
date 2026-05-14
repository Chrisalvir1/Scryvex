import React, { useState, useEffect } from 'react'
import './App.css'
import './Modal.css'

function App() {
  const [status, setStatus] = useState<any>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [cameras, setCameras] = useState<any[]>([])
  const [newCam, setNewCam] = useState({ name: '', url: '', type: 'rtsp' })

  useEffect(() => {
    const fetchStatus = () => {
      fetch('http://localhost:1994/api/status')
        .then(res => res.json())
        .then(data => setStatus(data))
        .catch(err => setStatus(null))
    }

    const fetchCameras = () => {
      fetch('http://localhost:1994/api/cameras')
        .then(res => res.json())
        .then(data => setCameras(data || []))
        .catch(err => console.error(err))
    }
    
    fetchStatus()
    fetchCameras()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleAddCamera = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await fetch('http://localhost:1994/api/cameras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCam)
      })
      if (res.ok) {
        setShowAddModal(false)
        setNewCam({ name: '', url: '', type: 'rtsp' })
        // Refresh list
        fetch('http://localhost:1994/api/cameras').then(r => r.json()).then(d => setCameras(d))
      }
    } catch (err) {
      alert('Error connecting to backend')
    }
  }

  return (
    <div className="container">
      <div className="liquid-bg">
        <div className="blob"></div>
        <div className="blob blob-2"></div>
      </div>

      <nav className="glass sidebar">
        <div className="logo">SCRYVEX</div>
        <ul className="nav-links">
          <li className="active">Dashboard</li>
          <li onClick={() => alert('Coming soon')}>Cameras</li>
          <li onClick={() => alert('Coming soon')}>Events</li>
          <li onClick={() => alert('Coming soon')}>Settings</li>
        </ul>
      </nav>

      <main className="dashboard-content">
        <header className="glass top-nav">
          <div className="header-left">
            <h1>System Overview</h1>
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

        <section className="grid">
          <div className="glass card hero">
            <div className="card-header">
              <h3>Live Stream</h3>
              <span className="badge">AUTO-DETECT</span>
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
                      <span>{cam.name}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="glass card stats">
            <h3>Resources</h3>
            <div className="stat-row">
              <div className="stat-label">
                <span>CPU Load</span>
                <span>8%</span>
              </div>
              <div className="progress-bar"><div className="fill" style={{width: '8%'}}></div></div>
            </div>
            <div className="stat-row">
              <div className="stat-label">
                <span>Memory</span>
                <span>12%</span>
              </div>
              <div className="progress-bar"><div className="fill" style={{width: '12%'}}></div></div>
            </div>
          </div>

          <div className="glass card actions">
            <h3>Operations</h3>
            <div className="action-grid">
              <button className="glass-btn" onClick={() => alert('Taking Snapshot...')}>Snapshot</button>
              <button className="glass-btn" onClick={() => alert('Scanning Network...')}>Scan</button>
              <button className="glass-btn" onClick={() => window.open('http://localhost:1994/api/status')}>Logs</button>
            </div>
          </div>
        </section>
      </main>

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
                  placeholder="Front Door"
                  required
                />
              </div>
              <div className="form-group">
                <label>Stream URL (RTSP)</label>
                <input 
                  type="text" 
                  value={newCam.url} 
                  onChange={e => setNewCam({...newCam, url: e.target.value})}
                  placeholder="rtsp://admin:password@ip:554/stream"
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
    </div>
  )
}

export default App
