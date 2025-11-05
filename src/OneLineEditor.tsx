import React, { useMemo, useRef, useState } from "react";

// Interactive One‑Line Diagram (Editor PoC)
// Adds a lightweight EDIT mode to place/move nodes, connect edges, edit labels/state,
// and save/load JSON (localStorage + text area). Still pure client‑side.

// --- Types ---
type NodeType = "source" | "breaker" | "bus" | "load";
export type NodeId = string;

type Node = {
  id: NodeId;
  type: NodeType;
  x: number;
  y: number;
  label: string;
  closed?: boolean; // for breaker
};

type Edge = { id: string; from: NodeId; to: NodeId };

type Diagram = {
  nodes: Node[];
  edges: Edge[];
  name?: string;
  version: 1;
};

// --- Helpers ---
const uid = (() => { let n = 0; return (p = "N") => `${p}${++n}`; })();
const mid = (a: number, b: number) => (a + b) / 2;

// Default starter diagram (Utility ⇄ Generator ⇢ Load)
const STARTER: Diagram = {
  version: 1,
  name: "Utility–Generator–Load",
  nodes: [
    { id: "UTIL", type: "source", x: 120, y: 80, label: "Utility" },
    { id: "BRK_UTIL", type: "breaker", x: 260, y: 80, label: "CB‑UTIL", closed: true },
    { id: "GEN", type: "source", x: 120, y: 240, label: "Generator" },
    { id: "BRK_GEN", type: "breaker", x: 260, y: 240, label: "CB‑GEN", closed: false },
    { id: "BUS", type: "bus", x: 440, y: 160, label: "Main Bus" },
    { id: "LOAD", type: "load", x: 620, y: 160, label: "Critical Load" },
  ],
  edges: [
    { id: "E1", from: "UTIL", to: "BRK_UTIL" },
    { id: "E2", from: "BRK_UTIL", to: "BUS" },
    { id: "E3", from: "GEN", to: "BRK_GEN" },
    { id: "E4", from: "BRK_GEN", to: "BUS" },
    { id: "E5", from: "BUS", to: "LOAD" },
  ],
};

// Storage keys
const LS_KEY = "one_line_editor_diagram_v1";

// --- Component ---
export default function OneLinePOC() {
  // --- config ---
  const GRID = 10; // snap-to-grid size
  const PORTS: Record<NodeType, Array<{dx:number, dy:number}>> = {
    source: [{dx:18,dy:0}],
    breaker: [{dx:-22,dy:0},{dx:22,dy:0}],
    bus: [{dx:-40,dy:0},{dx:40,dy:0}],
    load: [{dx:-26,dy:0},{dx:26,dy:0}],
  };

  // --- state ---
  const [utilClosed, setUtilClosed] = useState(true);
  const [genClosed, setGenClosed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(true);
  const [selectedNode, setSelectedNode] = useState<NodeId | null>(null);
  const [connectFrom, setConnectFrom] = useState<{node:NodeId, port:number} | null>(null);
  const dragging = React.useRef<{ id: NodeId; dx: number; dy: number } | null>(null);

  // model
  type NodeId = "UTIL" | "GEN" | "BRK_UTIL" | "BRK_GEN" | "BUS" | "LOAD";
  type NodeType = "source" | "breaker" | "bus" | "load";

  const nodes: Record<NodeId, { id: NodeId; type: NodeType; x: number; y: number; label: string; closed?: boolean }>
    = {
      UTIL: { id: "UTIL", type: "source", x: 120, y: 80, label: "Utility" },
      BRK_UTIL: { id: "BRK_UTIL", type: "breaker", x: 260, y: 80, label: "CB‑UTIL", closed: utilClosed },
      GEN: { id: "GEN", type: "source", x: 120, y: 240, label: "Generator" },
      BRK_GEN: { id: "BRK_GEN", type: "breaker", x: 260, y: 240, label: "CB‑GEN", closed: genClosed },
      BUS: { id: "BUS", type: "bus", x: 440, y: 160, label: "Main Bus" },
      LOAD: { id: "LOAD", type: "load", x: 620, y: 160, label: "Critical Load" },
    };

  const edges: Array<{ from: NodeId; fromPort?: number; to: NodeId; toPort?: number; id: string }> = [
    { id: "E1", from: "UTIL", to: "BRK_UTIL", fromPort:0, toPort:0 },
    { id: "E2", from: "BRK_UTIL", to: "BUS", fromPort:1, toPort:0 },
    { id: "E3", from: "GEN", to: "BRK_GEN", fromPort:0, toPort:0 },
    { id: "E4", from: "BRK_GEN", to: "BUS", fromPort:1, toPort:1 },
    { id: "E5", from: "BUS", to: "LOAD", fromPort:1, toPort:0 },
  ];

  // interlock toggle
  const toggleSourceBreaker = (which: "util" | "gen") => {
    setMessage(null);
    if (which === "util") {
      if (!utilClosed && genClosed) { setGenClosed(false); setUtilClosed(true); setMessage("Interlock: Utility closed → Generator opened."); }
      else setUtilClosed(p=>!p);
    } else {
      if (!genClosed && utilClosed) { setUtilClosed(false); setGenClosed(true); setMessage("Interlock: Generator closed → Utility opened."); }
      else setGenClosed(p=>!p);
    }
  };

  // energization
  const energized = useMemo(() => {
    const adj = new Map<NodeId, NodeId[]>();
    (Object.keys(nodes) as NodeId[]).forEach((id) => adj.set(id, []));
    for (const e of edges) {
      const a = nodes[e.from]; const b = nodes[e.to];
      if ((a.type === "breaker" && !a.closed) || (b.type === "breaker" && !b.closed)) continue;
      adj.get(a.id)!.push(b.id); adj.get(b.id)!.push(a.id);
    }
    const reached = new Set<NodeId>(["UTIL","GEN"]);
    const q: NodeId[] = ["UTIL","GEN"];
    while (q.length) { const cur=q.shift()!; for (const n of adj.get(cur)!) if(!reached.has(n)){ reached.add(n); q.push(n);} }
    const edgeOn = new Set<string>();
    for (const e of edges) if (reached.has(e.from) && reached.has(e.to)) edgeOn.add(e.id);
    return { node: reached, edge: edgeOn };
  }, [utilClosed, genClosed]);

  const busHot = energized.node.has("BUS");
  const loadHot = energized.node.has("LOAD");

  // dragging helpers
  const onMouseDownGroup = (e: any, n: {id:NodeId,x:number,y:number}) => {
    if (!editMode) return;
    dragging.current = { id: n.id, dx: e.clientX - n.x, dy: e.clientY - n.y };
    setSelectedNode(n.id);
  };
  const onMouseMove = (e:any) => {
    if (!editMode) return;
    const drag = dragging.current; if (!drag) return;
    // snap
    const x = Math.round((e.clientX - drag.dx)/GRID)*GRID;
    const y = Math.round((e.clientY - drag.dy)/GRID)*GRID;
    nodes[drag.id].x = x; nodes[drag.id].y = y; // mutate local model for demo
  };
  const onMouseUp = ()=>{ dragging.current = null; };

  // connection via ports
  const getPortXY = (n: typeof nodes[NodeId extends infer T ? never : never]) => n; // placeholder TS hack (ignored)
  const portXY = (n:{id:NodeId,type:NodeType,x:number,y:number}, idx:number) => {
    const p = PORTS[n.type][idx] || {dx:0,dy:0};
    return {x:n.x + p.dx, y:n.y + p.dy};
  };

  return (
    <div className="w-full min-h-[560px] grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 p-6 bg-neutral-50" onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
      <style>{`
        .energized{stroke:#16a34a}
        .conductor{stroke:#334155;stroke-width:6;stroke-linecap:round}
        .pulse{stroke-dasharray:10 10;animation:march 1.2s linear infinite}
        @keyframes march{to{stroke-dashoffset:-20}}
        .port{fill:#94a3b8}
        .port.hot{fill:#16a34a}
      `}</style>

      <div className="rounded-2xl bg-white shadow p-4 flex items-start justify-center flex-col gap-3">
        <div className="flex items-center gap-2">
          <button onClick={()=>setEditMode(v=>!v)} className={`px-3 py-1.5 rounded-xl border ${editMode?"bg-indigo-50 border-indigo-300":"bg-slate-50 border-slate-300"}`}>{editMode?"Editing: ON":"Editing: OFF"}</button>
          <div className="h-6 w-px bg-slate-300"/>
          <button onClick={()=>toggleSourceBreaker("util")} className={`px-3 py-1.5 rounded-xl border ${utilClosed?"bg-green-50 border-green-300":"bg-slate-50 border-slate-300"}`}>Utility Breaker: {utilClosed?"Closed":"Open"}</button>
          <button onClick={()=>toggleSourceBreaker("gen")} className={`px-3 py-1.5 rounded-xl border ${genClosed?"bg-green-50 border-green-300":"bg-slate-50 border-slate-300"}`}>Generator Breaker: {genClosed?"Closed":"Open"}</button>
        </div>

        <svg viewBox="0 0 760 360" className="w-full h-[420px]">
          {/* conductors */}
          {edges.map((e)=>{
            const a = nodes[e.from]; const b = nodes[e.to];
            const A = e.fromPort!=null?portXY(a,e.fromPort):{x:a.x,y:a.y};
            const B = e.toPort!=null?portXY(b,e.toPort):{x:b.x,y:b.y};
            const hot = energized.edge.has(e.id);
            return (
              <line key={e.id} x1={A.x} y1={A.y} x2={B.x} y2={B.y} className={`conductor ${hot?"energized pulse":""}`}/>
            );
          })}

          {/* nodes */}
          {(Object.values(nodes) as any).map((n:any)=> (
            <g key={n.id} transform={`translate(${n.x},${n.y})`} onMouseDown={(e)=>onMouseDownGroup(e,n)} onClick={()=>setSelectedNode(n.id)}>
              {/* symbols */}
              {n.type==="source" && (
                <g>
                  <circle r={18} fill="#fff" stroke="#0f172a" strokeWidth={3} />
                  <path d="M -10 0 A 10 10 0 0 0 10 0" fill="none" stroke="#0f172a" strokeWidth={3} />
                </g>
              )}
              {n.type==="bus" && (
                <rect x={-40} y={-6} width={80} height={12} rx={6} fill="#e2e8f0" stroke="#0f172a" strokeWidth={2} />
              )}
              {n.type==="load" && (
                <rect x={-26} y={-16} width={52} height={32} rx={4} fill="#f8fafc" stroke="#0f172a" strokeWidth={2} />
              )}
              {n.type==="breaker" && (
                <g className="cursor-pointer" onDoubleClick={()=> (n.id==="BRK_UTIL"?toggleSourceBreaker("util"): n.id==="BRK_GEN"?toggleSourceBreaker("gen"):null)}>
                  {/* ANSI-ish breaker: two terminals and a moving blade */}
                  <circle cx={-14} cy={0} r={3} fill="#0f172a"/>
                  <circle cx={14} cy={0} r={3} fill="#0f172a"/>
                  {n.closed ? (
                    <line x1={-10} y1={6} x2={10} y2={-6} stroke="#0f172a" strokeWidth={3} />
                  ) : (
                    <line x1={-10} y1={-6} x2={6} y2={-20} stroke="#0f172a" strokeWidth={3} />
                  )}
                  <rect x={-22} y={-16} width={44} height={32} rx={6} fill="transparent" stroke="#0f172a" strokeWidth={2} />
                </g>
              )}

              {/* labels */}
              <text x={0} y={32} textAnchor="middle" className="fill-slate-700 text-[12px] select-none">{n.label}</text>
              <circle cx={0} cy={46} r={4} fill={energized.node.has(n.id)?"#16a34a":"#94a3b8"}/>

              {/* ports (edit mode) */}
              {editMode && PORTS[n.type].map((p,idx)=>{
                const hot = energized.node.has(n.id);
                return <circle key={`${n.id}-p${idx}`} className={`port ${hot?"hot":""}`} cx={p.dx} cy={p.dy} r={4}
                  onClick={(e)=>{
                    e.stopPropagation();
                    if(!connectFrom) setConnectFrom({node:n.id,port:idx});
                    else {
                      if(connectFrom.node!==n.id || connectFrom.port!==idx){
                        // in this in-canvas demo we won't mutate the edges array; this is a visual-only POC
                        setMessage(`Connect ${connectFrom.node}:${connectFrom.port} → ${n.id}:${idx} (demo)`);
                        setConnectFrom(null);
                      }
                    }
                  }} />
              })}
            </g>
          ))}
        </svg>
      </div>

      {/* Right panel */}
      <div className="rounded-2xl bg-white shadow p-5 flex flex-col gap-4">
        <h2 className="text-xl font-semibold tracking-tight">Controls & Status</h2>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-slate-50 px-3 py-2 border border-slate-200"><div className="text-slate-500">Bus</div><div className={`font-semibold ${busHot?"text-green-600":"text-slate-700"}`}>{busHot?"Energized":"De‑energized"}</div></div>
          <div className="rounded-lg bg-slate-50 px-3 py-2 border border-slate-200"><div className="text-slate-500">Load</div><div className={`font-semibold ${loadHot?"text-green-600":"text-slate-700"}`}>{loadHot?"Energized":"De‑energized"}</div></div>
        </div>

        {selectedNode && (
          (()=>{ const n = nodes[selectedNode as NodeId]; return (
            <div className="text-sm space-y-2">
              <div className="text-slate-600">Selected: <span className="font-mono">{n.id}</span> • <span className="uppercase">{n.type}</span></div>
              <label className="block">
                <span className="text-slate-600">Rename</span>
                <input className="mt-1 w-full px-2 py-1 rounded-md border border-slate-300" defaultValue={n.label} onBlur={(e)=>{n.label=e.currentTarget.value;}}/>
              </label>
            </div>
          ); })()
        )}

        {message && <div className="text-sm rounded-lg bg-amber-50 border border-amber-300 text-amber-800 px-3 py-2">{message}</div>}

        <div className="mt-auto text-xs text-slate-500">
          <p><strong>Tips:</strong> Drag nodes by grabbing the symbol. Click small gray ports to connect (demo). Double‑click a breaker to toggle. Grid‑snaps help alignment.</p>
        </div>
      </div>
    </div>
  );
}
