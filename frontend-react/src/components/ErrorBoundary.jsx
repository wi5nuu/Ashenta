import React from 'react'

const IS_DEV = import.meta.env.DEV

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, errorId: null }
  }

  static getDerivedStateFromError(error) {
    // Generate a short error ID for support reference without exposing details
    const errorId = Math.random().toString(36).slice(2, 8).toUpperCase()
    return { error, errorId }
  }

  componentDidCatch(error, info) {
    // Log to console only — never send to external service without consent
    if (IS_DEV) {
      console.error('[Ashenta] Runtime error:', error, info)
    } else {
      console.error('[Ashenta] Runtime error (ID:', this.state.errorId, '):', error?.message)
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#08080a', color: '#f0f0f4',
          fontFamily: 'Inter, system-ui, sans-serif',
          padding: '2rem', gap: '1.25rem', textAlign: 'center',
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 19h20L12 2Z" stroke="#f87171" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M12 9v4M12 16h.01" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 650, color: '#f0f0f4', margin: 0 }}>
            Terjadi kesalahan
          </h2>
          <p style={{ fontSize: '.875rem', color: '#6e6e82', maxWidth: 360, lineHeight: 1.6, margin: 0 }}>
            Aplikasi mengalami error tak terduga. Coba muat ulang halaman.
            {this.state.errorId && (
              <><br /><span style={{ fontFamily: 'monospace', fontSize: '.75rem', color: '#48485a' }}>
                Kode error: {this.state.errorId}
              </span></>
            )}
          </p>
          {/* Only show technical details in development */}
          {IS_DEV && this.state.error && (
            <pre style={{
              background: '#0f0f12', padding: '1rem', borderRadius: 8,
              color: '#fbbf24', fontSize: '.75rem', maxWidth: 640,
              overflow: 'auto', whiteSpace: 'pre-wrap',
              border: '1px solid rgba(255,255,255,.06)',
              textAlign: 'left', maxHeight: 200,
            }}>
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              background: 'linear-gradient(135deg, #4d8fff, #7c5cfc)',
              color: '#fff', border: 'none',
              padding: '.5625rem 1.25rem', borderRadius: 7, fontWeight: 600,
              cursor: 'pointer', fontSize: '.875rem', fontFamily: 'inherit',
            }}
          >
            Muat Ulang
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
