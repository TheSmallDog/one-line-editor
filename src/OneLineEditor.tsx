import React, { useMemo, useRef, useState } from 'react'

type NodeType = 'source' | 'breaker' | 'bus' | 'load'
type NodeId = string
type Node = { id: NodeId; type: NodeType; x: number; y: number; label: string; closed?: boolean }
type Edge = { id: string; from: NodeId; to: NodeId }
type Diagram = { nodes: Node[]; edges: Edge[]; version: 1; name?: string }

const STARTER: Diagram = {
  version: 1,
  name: 'Utility–Generator–Load',
  nodes: [
    { id: 'UTIL', type: 'source', x: 120, y: 80, label: 'Utility' },
    { id: 'BRK_UTIL', type: 'breaker', x: 260, y: 80, label: 'CB-UTIL', closed: true },
    { id: 'GEN', type: 'source', x: 120, y: 240, label: 'Generator' },
    { id: 'BRK_GEN', type: 'breaker', x: 260, y: 240, label: 'CB-GEN', closed: false },
    { id: 'BUS', type: 'bus', x: 440, y: 160, label: 'Main Bus' },
    { id: 'LOAD', type: 'load', x: 620, y: 160, label: 'Critical Load' },
  ],
  edges: [
    { id: 'E1', from: 'UTIL', to: 'BRK_UTIL' },
    { id: 'E2', from: 'BRK_UTIL', to: 'BUS' },
    { id: 'E3', from: 'GEN', to: 'BRK_GEN' },
    { id: 'E4', from: 'BRK_GEN', to: 'BUS' },
    { id: 'E5', from: 'BUS', to: 'LOAD' },
  ],
}

const LS_KEY = 'one_line_editor_diagram_v1'
const uid = (() => { let n = 0; return (p = 'N') => `${p}${++n}` })()
const mid = (a: number, b: number) => (a + b) / 2

export default function OneLineEditor({ lockedView = false }: { lockedView?: boolean }) {
  const [diagram, setDiagram] = useState<Diagram>(() => {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) return JSON.parse(raw) as Diagram; } catch {}
    return STARTER
  })
  const [selectedNode, setSelectedNode] = useState<NodeId | null>(null)
  const [connectFrom, setConnectFrom] = useState<NodeId | null>(null)
  const [jsonIO, setJsonIO] = useState('')
  const dragging = useRef<{ id: NodeId; dx: number; dy: number } | null>(null)

  const energized = useMemo(() => {
    const nodesById = new Map(diagram.nodes.map(n => [n.id, n] as const))
    const adj = new Map<NodeId, NodeId[]>()
    diagram.nodes.forEach(n => adj.set(n.id, []))
    for (const e of diagram.edges) {
      const A = nodesById.get(e.from)!; const B = nodesById.get(e.to)!
      if ((A.type === 'breaker' && !A.closed) || (B.type === 'breaker' && !B.closed)) continue
      adj.get(A.id)!.push(B.id); adj.get(B.id)!.push(A.id)
    }
    const reached = new Set<NodeId>(); const q: NodeId[] = []
    diagram.nodes.filter(n => n.type === 'source').forEach(s => { reached.add(s.id); q.push(s.id) })
    while (q.length) { const cur = q.shift()!; for (const nb of adj.get(cur) || []) if (!reached.has(nb)) { reached.add(nb); q.push(nb) } }
    const edgeOn = new Set<string>(); for (const e of diagram.edges) if (reached.has(e.from) && reached.has(e.to)) edgeOn.add(e.id)
    return { node: reached, edge: edgeOn }
  }, [diagram])

  const addNode = (type: NodeType) => {
    if (lockedView) return
    const x = 120 + Math.random() * 480
    const y = 80 + Math.random() * 200
    const id = uid(type[0].toUpperCase())
    const labelBase = { source: 'Source', breaker: 'CB', bus: 'Bus', load: 'Load' }[type]
    setDiagram(d => ({ ...d, nodes: [...d.nodes, { id, type, x, y, label: `${labelBase} ${id}`, ...(type === 'breaker' ? { closed: True } : {}) }] }))
  }const startConnect = (from: NodeId) => {
    if (lockedView) return
    if (connectFrom && connectFrom !== from) {
      const id = uid('E')
      setDiagram(d => ({ ...d, edges: [...d.edges, { id, from: connectFrom, to: from }] }))
      setConnectFrom(null)
    } else { setConnectFrom(from) }
  }

  const toggleBreaker = (id: NodeId) => {
    setDiagram(d => ({ ...d, nodes: d.nodes.map(n => (n.id === id && n.type === 'breaker' ? { ...n, closed: !n.closed } : n)) }))
  }

  const onMouseDownNode = (e: React.MouseEvent, n: Node) => {
    if (lockedView) return
    dragging.current = { id: n.id, dx: e.clientX - n.x, dy: e.clientY - n.y }
    setSelectedNode(n.id)
  }
  const onMouseMove = (e: React.MouseEvent) => {
    const drag = dragging.current; if (!drag || lockedView) return
    const x = e.clientX - drag.dx; const y = e.clientY - drag.dy
    setDiagram(d => ({ ...d, nodes: d.nodes.map(n => (n.id === drag.id ? { ...n, x, y } : n)) }))
  }
  const onMouseUp = () => { dragging.current = null }

  const saveLocal = () => { if (!lockedView) localStorage.setItem(LS_KEY, JSON.stringify(diagram)) }
  const loadFromJson = () => {
    if (lockedView) return
    try { const obj = JSON.parse(jsonIO) as Diagram; if (!obj.nodes || !obj.edges) throw new Error('Bad diagram JSON'); setDiagram(obj) }
    catch (err) { alert(`Load failed: ${err}`) }
  }
  const exportJson = () => setJsonIO(JSON.stringify(diagram, null, 2))

  const busHot = energized.node.has('BUS')
  const loadHot = energized.node.has('LOAD')

  return (
    <div className="w-full min-h-[620px] grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 p-6 bg-neutral-50"
         onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
      <style>{`
        .energized { stroke: #16a34a; }
        .conductor { stroke: #334155; stroke-width: 6; stroke-linecap: round; }
        .pulse { stroke-dasharray: 10 10; animation: march 1.2s linear infinite; }
        @keyframes march { to { stroke-dashoffset: -20; } }
        .node-hit { cursor: pointer; }
        .sel { filter: drop-shadow(0 0 6px rgba(99,102,241,.6)); }
      `}</style>

      <div className="rounded-2xl bg-white shadow p-4 flex flex-col gap-3">
        {!lockedView && (
          <div className="flex flex-wrap items-center gap-2">
            <button className="px-3 py-1.5 rounded-xl border bg-slate-50 border-slate-300" onClick={() => addNode('source')}>+ Source</button>
            <button className="px-3 py-1.5 rounded-xl border bg-slate-50 border-slate-300" onClick={() => addNode('breaker')}>+ Breaker</button>
            <button className="px-3 py-1.5 rounded-xl border bg-slate-50 border-slate-300" onClick={() => addNode('bus')}>+ Bus</button>
            <button className="px-3 py-1.5 rounded-xl border bg-slate-50 border-slate-300" onClick={() => addNode('load')}>+ Load</button>
            <div className="h-6 w-px bg-slate-300"/>
            <button className={\`\${connectFrom ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-300'} px-3 py-1.5 rounded-xl border\`}
                    onClick={() => setConnectFrom(c => (c ? null : '' as any))}>
              {connectFrom ? 'Connecting… click another node' : 'Connect nodes (click 2)'}
            </button>
            <div className="h-6 w-px bg-slate-300"/>
            <button className="px-3 py-1.5 rounded-xl border bg-slate-50 border-slate-300" onClick={saveLocal}>Save (local)</button>
            <button className="px-3 py-1.5 rounded-xl border bg-slate-50 border-slate-300" onClick={exportJson}>Export JSON</button>
          </div>
        )}

        <svg viewBox="0 0 760 420" className="w-full h-[480px] rounded-xl bg-white">
          {diagram.edges.map(e => {
            const a = diagram.nodes.find(n => n.id === e.from)!
            const b = diagram.nodes.find(n => n.id === e.to)!
            const hot = energized.edge.has(e.id)
            return (
              <g key={e.id}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={\`conductor \${hot ? 'energized pulse' : ''}\`} />
                {!lockedView && <circle cx={mid(a.x,b.x)} cy={mid(a.y,b.y)} r={3} fill="#94a3b8" />}
              </g>
            )
          })}

          {diagram.nodes.map(n => (
            <g key={n.id} transform={\`translate(\${n.x}, \${n.y})\`}>
              <circle r={24} fill="transparent" className="node-hit"
                      onMouseDown={e => onMouseDownNode(e, n)}
                      onClick={() => { if (!lockedView && connectFrom !== null) startConnect(n.id); else setSelectedNode(n.id) }} />
              {n.type === 'source' && (<g className={selectedNode === n.id ? 'sel' : ''}><circle r={18} fill="#fff" stroke="#0f172a" strokeWidth={3} /><path d="M -10 0 A 10 10 0 0 0 10 0" fill="none" stroke="#0f172a" strokeWidth={3} /></g>)}
              {n.type === 'bus'    && (<g className={selectedNode === n.id ? 'sel' : ''}><rect x={-40} y={-6} width={80} height={12} rx={6} fill="#e2e8f0" stroke="#0f172a" strokeWidth={2} /></g>)}
              {n.type === 'load'   && (<g className={selectedNode === n.id ? 'sel' : ''}><rect x={-26} y={-16} width={52} height={32} rx={4} fill="#f8fafc" stroke="#0f172a" strokeWidth={2} /></g>)}
              {n.type === 'breaker'&& (<g className={(selectedNode === n.id ? 'sel ' : '') + 'cursor-pointer'} onDoubleClick={() => toggleBreaker(n.id)}>
                <rect x={-22} y={-16} width={44} height={32} rx={6} fill="#fff" stroke="#0f172a" strokeWidth={2} />
                {n.closed ? (<path d="M -12 10 L 12 -10" stroke="#0f172a" strokeWidth={3} />) : (<><line x1={-12} y1={6} x2={-2} y2={-2} stroke="#0f172a" strokeWidth={3} /><line x1={2} y1={2} x2={12} y2={-6} stroke="#0f172a" strokeWidth={3} /></>)}
              </g>)}
              <text x={0} y={32} textAnchor="middle" className="fill-slate-700 text-[12px] select-none">{n.label}</text>
              <circle cx={0} cy={46} r={4} fill={energized.node.has(n.id) ? '#16a34a' : '#94a3b8'} />
            </g>
          ))}
        </svg>
      </div>

      <div className="rounded-2xl bg-white shadow p-5 flex flex-col gap-4">
        <h2 className="text-xl font-semibold tracking-tight">Panel</h2>
        <div className="mt-1 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-slate-50 px-3 py-2 border border-slate-200">
            <div className="text-slate-500">Bus (starter)</div>
            <div className={\`font-semibold \${energized.node.has('BUS') ? 'text-green-600' : 'text-slate-700'}\`}>
              {energized.node.has('BUS') ? 'Energized' : 'De-energized'}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2 border border-slate-200">
            <div className="text-slate-500">Load (starter)</div>
            <div className={\`font-semibold \${energized.node.has('LOAD') ? 'text-green-600' : 'text-slate-700'}\`}>
              {energized.node.has('LOAD') ? 'Energized' : 'De-energized'}
            </div>
          </div>
        </div>

        {!lockedView && (
          <div className="mt-2">
            <div className="text-sm font-medium mb-1">Import / Export JSON</div>
            <textarea className="w-full h-32 p-2 font-mono text-xs border rounded-md" value={jsonIO} onChange={e => setJsonIO(e.target.value)} placeholder="Click Export to dump, paste JSON here then Load to import."/>
            <div className="mt-2 flex gap-2">
              <button className="px-3 py-1.5 rounded-xl border bg-slate-50 border-slate-300" onClick={loadFromJson}>Load</button>
              <button className="px-3 py-1.5 rounded-xl border bg-slate-50 border-slate-300" onClick={exportJson}>Export</button>
            </div>
          </div>
        )}

        <div className="mt-auto text-xs text-slate-500 leading-relaxed">
          {lockedView ? (
            <p><strong>Viewer mode:</strong> Double‑click breakers to toggle. Use <code>?mode=view</code> in the URL to share this mode.</p>
          ) : (
            <p><strong>Editor mode:</strong> Drag nodes; double‑click a breaker to toggle; Connect nodes by clicking two nodes; Save to localStorage.</p>
          )}
        </div>
      </div>
    </div>
  )
}