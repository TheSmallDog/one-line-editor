import React from 'react'
import OneLine from './OneLineEditor'

function getMode(): 'edit' | 'view' {
  const params = new URLSearchParams(window.location.search)
  return (params.get('mode') === 'view') ? 'view' : 'edit'
}

export default function App() {
  const mode = getMode()
  return (
    <div className="min-h-screen p-6">
      <h1 className="text-2xl font-semibold mb-4">
        Interactive One-Line — {mode === 'view' ? 'Viewer' : 'Editor'} Mode
      </h1>
      <OneLine lockedView={mode === 'view'} />
      <div className="mt-6 text-sm text-slate-600">
        <p>Switch modes by appending <code>?mode=view</code> (viewer) or no param (editor).</p>
      </div>
    </div>
  )
}