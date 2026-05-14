import React, { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [status, setStatus] = useState<any>(null)

  useEffect(() => {
    const fetchStatus = () => {
      fetch('http://localhost:1994/api/status')
        .then(res => res.json())
        .then(data => setStatus(data))
        .catch(err => setStatus(null))
    }
    
    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [])

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
          <li>Cameras</li>
          <li>Events</li>
          <li>Settings</li>
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
            <div className="empty-state">
              <div className="icon">📹</div>
              <p>No active video streams</p>
              <button className="btn-secondary">Setup Camera</button>
            </div>
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
              <button className="glass-btn">Snapshot</button>
              <button className="glass-btn">Scan</button>
              <button className="glass-btn">Logs</button>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
