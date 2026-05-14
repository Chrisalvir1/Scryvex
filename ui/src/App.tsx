import React, { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [status, setStatus] = useState<any>(null)

  useEffect(() => {
    // Intentamos conectar con el motor Go
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
            <h1>Dashboard</h1>
            <p className="subtitle">Welcome to Scryvex v2.0</p>
          </div>
          <div className="system-status">
            {status ? (
              <div className="status-indicator online">
                <span className="pulse"></span>
                CORE ONLINE v{status.version}
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
              <h3>Live Monitoring</h3>
              <span className="badge">REAL-TIME</span>
            </div>
            <div className="empty-state">
              <div className="icon">📹</div>
              <p>No cameras configured</p>
              <button className="btn-secondary">Add First Device</button>
            </div>
          </div>
          
          <div className="glass card stats">
            <h3>System Health</h3>
            <div className="stat-row">
              <span>CPU Usage</span>
              <div className="progress-bar"><div className="fill" style={{width: '12%'}}></div></div>
            </div>
            <div className="stat-row">
              <span>Memory</span>
              <div className="progress-bar"><div className="fill" style={{width: '24%'}}></div></div>
            </div>
          </div>

          <div className="glass card actions">
            <h3>Quick Actions</h3>
            <div className="action-grid">
              <button className="glass-btn">Capture</button>
              <button className="glass-btn">Record</button>
              <button className="glass-btn">Analyze</button>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
