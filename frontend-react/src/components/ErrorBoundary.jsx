import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[Ashenta] Runtime error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#0f172a', color: '#e2e8f0', fontFamily: 'monospace',
          padding: '2rem', gap: '1rem'
        }}>
          <h2 style={{ color: '#f87171' }}>App Error</h2>
          <pre style={{
            background: '#1e293b', padding: '1.25rem', borderRadius: 8,
            color: '#fbbf24', fontSize: '.8rem', maxWidth: 700,
            overflow: 'auto', whiteSpace: 'pre-wrap', border: '1px solid #334155'
          }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              background: '#38bdf8', color: '#0f172a', border: 'none',
              padding: '.6rem 1.4rem', borderRadius: 7, fontWeight: 700,
              cursor: 'pointer', fontSize: '.9rem'
            }}
          >
            Coba Lagi
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
