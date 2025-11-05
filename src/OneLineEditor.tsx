import React, { useEffect, useMemo, useRef, useState } from "react";

type Signal = "AC" | "DC";
type NodeType = "source" | "breaker" | "bus" | "load" | "rectifier" | "inverter";
type NodeId = string;

type Node = {
  id: NodeId;
  type: NodeType;
  x: number; y: number;
  label: string;
  // For sources and converters:
  sourceSignal?: Signal;       // only if type === "source"
  // For breakers:
  closed?: boolean;            // only if type === "breaker"
};

type Edge = {
  id: string;
  from: NodeId; fromPort: number;
  to: NodeId;   toPort: number;
};

type Diagram = { version: 1; name?: string; nodes: Node[]; edges: Edge[] };

const STARTER: Diagram = {
  version: 1,
  name: "Utility–Generator–Load (+ converters)",
  nodes: [
    { id: "UTIL", type: "source",   x: 120, y: 80,  label: "Utility (AC Source)",  sourceSignal: "AC" },
    { id: "BRK_UTIL", type: "breaker", x: 260, y: 80,  label: "CB-UTIL", closed: true },
    { id: "GEN",  type: "source",   x: 120, y: 240, label: "Generator (AC Source)", sourceSignal: "AC" },
    { id: "BRK_GEN",  type: "breaker", x: 260, y: 240, label: "CB-GEN", closed: false },
    { id: "BUS",  type: "bus",      x: 440, y: 160, label: "Main Bus" },
    // Example UPS block (rectifier-DC-link-inverter) – you can wire these up later:
    { id: "RECT1", type: "rectifier", x: 520, y: 80,  label: "Rectifier" },
    { id: "INV1",  type: "inverter",  x: 520, y: 240, label: "Inverter" },
    { id: "LOAD", type: "load",     x: 680, y: 160, label: "Critical Load" },
  ],
  edges: [
    { id: "E1", from: "UTIL",     fromPort: 0, to: "BRK_UTIL", toPort: 0 },
    { id: "E2", from: "BRK_UTIL", fromPort: 1, to: "BUS",      toPort: 0 },
    { id: "E3", from: "GEN",      fromPort: 0, to: "BRK_GEN",  toPort: 0 },
    { id: "E4", from: "BRK_GEN",  fromPort: 1, to: "BUS",      toPort: 1 },
    // BUS → LOAD direct (AC path)
    { id: "E5", from: "BUS", fromPort: 1, to: "LOAD", toPort: 0 },
    // (Leave RECT1/INV1 unconnected in starter — you can connect in Editor)
  ],
};

// ------- Port geometry (left/right) and semantics for converters -------
type Port = { dx: number; dy: number; role?: "AC" | "DC" }; // role for rect/inv
const PORTS: Record<NodeType, Port[]> = {
  source:   [{ dx: 22, dy: 0 }],                // 1 port (right)
  breaker:  [{ dx: -22, dy: 0 }, { dx: 22, dy: 0 }], // 2 ports (L/R)
  bus:      [{ dx: -40, dy: 0 }, { dx: 40, dy: 0 }],
  load:     [{ dx: -26, dy: 0 }, { dx: 26, dy: 0 }],
  rectifier:[{ dx: -26, dy: 0, role: "AC" }, { dx: 26, dy: 0, role: "DC" }], // AC in (L) → DC out (R)
  inverter: [{ dx: -26, dy: 0, role: "DC" }, { dx: 26, dy: 0, role: "AC" }], // DC in (L) → AC out (R)
};

// ------- Helpers -------
const uid = (() => { let n = 0; return (p = "N") => p + String(++n); })();
const mid = (a: number, b: number) => (a + b) / 2;

// Snap-to-grid for nicer layouts
const GRID = 10;
const snap = (v: number) => Math.round(v / GRID) * GRID;

// ------- Component -------
export default function OneLineEditor({ lockedView = false }: { lockedView?: boolean }) {
  const [diagram, setDiagram] = useState<Diagram>(() => STARTER);
  const [selectedNode, setSelectedNode] = useState<NodeId | null>(null);
  const [connectFrom, setConnectFrom] = useState<{ node: NodeId; port: number } | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const dragging = useRef<{ id: NodeId; dx: number; dy: number } | null>(null);
  const [editingLabel, setEditingLabel] = useState<NodeId | null>(null);
  const [jsonIO, setJsonIO] = useState("");

  // ---------- Energization + Signal Type (pin-graph BFS with state) ----------
  type PinKey = string; // `${nodeId}#${portIndex}`
  const pinKey = (id: NodeId, p: number) => `${id}#${p}`;
  const parsePin = (k: PinKey): [NodeId, number] => {
    const i = k.lastIndexOf("#");
    return [k.slice(0, i), Number(k.slice(i + 1))];
  };

  const sim = useMemo(() => {
    const nodesById = new Map(diagram.nodes.map((n) => [n.id, n] as const));

    // Build pin-to-pin adjacency. We'll carry Signal state during BFS.
    const pinAdj = new Map<PinKey, PinKey[]>();
    const pushAdj = (a: PinKey, b: PinKey) => {
      if (!pinAdj.has(a)) pinAdj.set(a, []);
      pinAdj.get(a)!.push(b);
    };

    // 1) Wires (edges) connect pin ↔ pin in both directions
    for (const e of diagram.edges) {
      pushAdj(pinKey(e.from, e.fromPort), pinKey(e.to, e.toPort));
      pushAdj(pinKey(e.to, e.toPort), pinKey(e.from, e.fromPort));
    }

    // 2) Internal connectivity per node (breaker closed, bus tie-through, etc.)
    for (const n of diagram.nodes) {
      const ports = PORTS[n.type] ?? [];
      if (n.type === "breaker") {
        if (n.closed) {
          // Connect L <-> R
          if (ports.length >= 2) {
            pushAdj(pinKey(n.id, 0), pinKey(n.id, 1));
            pushAdj(pinKey(n.id, 1), pinKey(n.id, 0));
          }
        }
      } else if (n.type === "bus" || n.type === "load") {
        // Tie ports both ways (simple pass-through)
        if (ports.length >= 2) {
          pushAdj(pinKey(n.id, 0), pinKey(n.id, 1));
          pushAdj(pinKey(n.id, 1), pinKey(n.id, 0));
        }
      } else if (n.type === "rectifier") {
        // Only AC(L) -> DC(R)
        if (ports.length >= 2) {
          pushAdj(pinKey(n.id, 0), pinKey(n.id, 1)); // directional
        }
      } else if (n.type === "inverter") {
        // Only DC(L) -> AC(R)
        if (ports.length >= 2) {
          pushAdj(pinKey(n.id, 0), pinKey(n.id, 1)); // directional
        }
      }
      // sources have only one output pin, no internal ties needed
    }

    // 3) BFS over pins carrying Signal; conversions at rectifier/inverter
    type State = { pin: PinKey; sig: Signal };
    const reached = new Map<PinKey, Set<Signal>>();
    const q: State[] = [];

    // Seed from all sources
    for (const n of diagram.nodes) {
      if (n.type === "source" && n.sourceSignal) {
        const p0 = pinKey(n.id, 0);
        q.push({ pin: p0, sig: n.sourceSignal });
        reached.set(p0, new Set([n.sourceSignal]));
      }
    }

    const addReach = (pin: PinKey, sig: Signal) => {
      const s = reached.get(pin) ?? new Set<Signal>();
      if (!s.has(sig)) {
        s.add(sig);
        reached.set(pin, s);
        return true;
      }
      return false;
    };

    while (q.length) {
      const cur = q.shift()!;
      const [nodeId, portIdx] = parsePin(cur.pin);
      const node = nodesById.get(nodeId)!;

      // If moving through a converter, enforce signal rules by port direction
      const ports = PORTS[node.type] ?? [];
      const neighbors = pinAdj.get(cur.pin) || [];

      for (const nb of neighbors) {
        const [nbNodeId, nbPort] = parsePin(nb);
        const nbNode = nodesById.get(nbNodeId)!;

        let outSig: Signal | null = cur.sig;

        if (nbNode.id === node.id) {
          // We're traversing inside the same node (internal link)
          // Handle conversion when we traverse from L->R on rectifier/inverter
          if (node.type === "rectifier") {
            // AC(L idx 0) -> DC(R idx 1)
            if (portIdx === 0 && nbPort === 1 && cur.sig === "AC") outSig = "DC";
            else outSig = null; // block other internal directions/signals
          } else if (node.type === "inverter") {
            // DC(L 0) -> AC(R 1)
            if (portIdx === 0 && nbPort === 1 && cur.sig === "DC") outSig = "AC";
            else outSig = null;
          } else if (node.type === "breaker") {
            // Already enforced by closed state: pass cur.sig
          } else if (node.type === "bus" || node.type === "load") {
            // Pass-through: cur.sig unchanged
          }
        } else {
          // Traversing a wire to a different node:
          // For sources: nothing special. For others: signal stays the same here.
          // Note: blocking will happen inside the next node if necessary.
        }

        if (outSig && addReach(nb, outSig)) {
          q.push({ pin: nb, sig: outSig });
        }
      }
    }

    // Derive energized flags
    const nodeHot = new Set<NodeId>();
    for (const [k, sigs] of reached) {
      if (sigs.size > 0) nodeHot.add(parsePin(k)[0]);
    }
    // Edge energized + signal kind (AC or DC)
    const edgeHot = new Set<string>();
    const edgeSig = new Map<string, Signal>("size" in Object ? [] : []); // TS hush
    for (const e of diagram.edges) {
      const a = pinKey(e.from, e.fromPort);
      const b = pinKey(e.to, e.toPort);
      const aS = reached.get(a);
      const bS = reached.get(b);
      if (aS && bS) {
        edgeHot.add(e.id);
        // If either side has DC, mark as DC, else AC.
        const isDC = (aS.has("DC") || bS.has("DC")) && !(aS.has("AC") && bS.has("AC"));
        edgeSig.set(e.id, isDC ? "DC" : "AC");
      }
    }

    return { reached, nodeHot, edgeHot, edgeSig, pinAdj, nodesById };
  }, [diagram]);

  // ---------- UI actions ----------
  function addNode(type: NodeType) {
    if (lockedView) return;
    const x = 120 + Math.random() * 520;
    const y = 80 + Math.random() * 240;
    const id = uid(type[0].toUpperCase());
    const base = { source: "Source", breaker: "CB", bus: "Bus", load: "Load", rectifier: "Rectifier", inverter: "Inverter" }[type];
    const node: Node = { id, type, x: snap(x), y: snap(y), label: `${base} ${id}` };
    if (type === "source") node.sourceSignal = "AC";             // default AC source
    if (type === "breaker") node.closed = true;
    setDiagram(d => ({ ...d, nodes: d.nodes.concat(node) }));
  }

  function toggleBreaker(id: NodeId) {
    setDiagram(d => ({
      ...d,
      nodes: d.nodes.map(n => n.id === id && n.type === "breaker" ? { ...n, closed: !n.closed } : n)
    }));
  }

  function onMouseDownNode(e: React.MouseEvent, n: Node) {
    if (lockedView) return;
    dragging.current = { id: n.id, dx: e.clientX - n.x, dy: e.clientY - n.y };
    setSelectedNode(n.id);
  }

  function onMouseMove(e: React.MouseEvent) {
    if (connectFrom && !lockedView) setGhostPos({ x: e.clientX, y: e.clientY });
    const drag = dragging.current;
    if (!drag || lockedView) return;
    const x = snap(e.clientX - drag.dx);
    const y = snap(e.clientY - drag.dy);
    setDiagram(d => ({
      ...d,
      nodes: d.nodes.map(n => (n.id === drag.id ? { ...n, x, y } : n)),
    }));
  }

  function onMouseUp() { dragging.current = null; setGhostPos(null); }

  function portXY(n: Node, idx: number) {
    const p = (PORTS[n.type] || [])[idx] || { dx: 0, dy: 0 };
    return { x: n.x + p.dx, y: n.y + p.dy };
  }

  function startConnect(nodeId: NodeId, port: number) {
    if (lockedView) return;
    if (!connectFrom) {
      setConnectFrom({ node: nodeId, port });
      return;
    }
    // finish connection
    if (connectFrom.node === nodeId && connectFrom.port === port) {
      // same port → cancel
      setConnectFrom(null); setGhostPos(null);
      return;
    }
    const id = uid("E");
    setDiagram(d => ({ ...d, edges: d.edges.concat({ id, from: connectFrom.node, fromPort: connectFrom.port, to: nodeId, toPort: port }) }));
    setConnectFrom(null);
    setGhostPos(null);
  }

  function deleteSelected() {
    if (!selectedNode) return;
    setDiagram(d => {
      const keepNodes = d.nodes.filter(n => n.id !== selectedNode);
      const keepIds = new Set(keepNodes.map(n => n.id));
      const keepEdges = d.edges.filter(e => keepIds.has(e.from) && keepIds.has(e.to));
      return { ...d, nodes: keepNodes, edges: keepEdges };
    });
    setSelectedNode(null);
    setConnectFrom(null);
    setGhostPos(null);
  }

  // keyboard delete/backspace (unless typing in inputs)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if (!typing && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedNode]);

  // inline rename save
  function renameNode(id: NodeId, label: string) {
    setDiagram(d => ({ ...d, nodes: d.nodes.map(n => (n.id === id ? { ...n, label } : n)) }));
  }

  // ---------- Derived for starter cards ----------
  const busHot = sim.nodeHot.has("BUS");
  const loadHot = sim.nodeHot.has("LOAD");

  // ---------- Render ----------
  return (
    <div
      className="w-full min-h-[620px] grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 p-6 bg-neutral-50"
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      <style>{`
        .conductor { stroke: #334155; stroke-width: 6; stroke-linecap: round; }
        .energized { }
        .ac { stroke-dasharray: 10 12; animation: acdash 1.1s ease-in-out infinite alternate; }
        @keyframes acdash { 0% { stroke-dashoffset: 0 } 100% { stroke-dashoffset: -22 } }
        .dc { stroke-dasharray: 10 10; animation: dcmarch 1.2s linear infinite; }
        @keyframes dcmarch { to { stroke-dashoffset: -20 } }
        .node-hit { cursor: pointer; }
        .sel { filter: drop-shadow(0 0 6px rgba(99,102,241,.6)); }
        .port { fill: #94a3b8; cursor: crosshair; }
        .port.hot { fill: #16a34a; }
        .ghost { stroke: #64748b; stroke-width: 2; stroke-dasharray: 4 6; }
      `}</style>

      {/* Left: toolbar + canvas */}
      <div className="rounded-2xl bg-white shadow p-4 flex flex-col gap-3">
        {!lockedView && (
          <div className="flex flex-wrap items-center gap-2">
            <button className="px-3 py-1.5 rounded-xl border bg-slate-50 border-slate-300" onClick={() => addNode("source")}>+ AC Source</button>
            <button className="px-3 py-1.5 rounded-xl border bg-slate-50 border-slate-300" onClick={() => addNode("breaker")}>+ Breaker</button>
            <button className="px-3 py-1.5 rounded-xl border bg-slate-50 border-slate-300" onClick={() => addNode("bus")}>+ Bus</button>
            <button className="px-3 py-1.5 rounded-xl border bg-slate-50 border-slate-300" onClick={() => addNode("load")}>+ Load</button>
            <button className="px-3 py-1.5 rounded-xl border bg-slate-50 border-slate-300" onClick={() => addNode("rectifier")}>+ Rectifier</button>
            <button className="px-3 py-1.5 rounded-xl border bg-slate-50 border-slate-300" onClick={() => addNode("inverter")}>+ Inverter</button>
            <div className="h-6 w-px bg-slate-300" />
            <button
              className={"px-3 py-1.5 rounded-xl border " + (connectFrom ? "bg-amber-50 border-amber-300" : "bg-slate-50 border-slate-300")}
              title="Click a port, then another port to draw a conductor"
            >
              Connect (click two ports)
            </button>
            {selectedNode && (
              <button
                className="px-3 py-1.5 rounded-xl border bg-red-50 border-red-300 text-red-800"
                title="Delete selected node and attached lines"
                onClick={deleteSelected}
              >
                Delete selected
              </button>
            )}
          </div>
        )}

        <svg viewBox="0 0 820 460" className="w-full h-[500px] rounded-xl bg-white">
          {/* conductors */}
          {diagram.edges.map((e) => {
            const a = diagram.nodes.find(n => n.id === e.from)!;
            const b = diagram.nodes.find(n => n.id === e.to)!;
            const A = portXY(a, e.fromPort);
            const B = portXY(b, e.toPort);
            const hot = sim.edgeHot.has(e.id);
            const sig = sim.edgeSig.get(e.id) || "AC";
            const cls = hot ? (sig === "DC" ? "dc" : "ac") : "";
            return (
              <line key={e.id} x1={A.x} y1={A.y} x2={B.x} y2={B.y} className={`conductor energized ${cls}`} />
            );
          })}

          {/* ghost wire while connecting */}
          {!lockedView && connectFrom && ghostPos && (() => {
            const n = diagram.nodes.find(x => x.id === connectFrom.node)!;
            const p = portXY(n, connectFrom.port);
            return <line className="ghost" x1={p.x} y1={p.y} x2={ghostPos.x} y2={ghostPos.y} />;
          })()}

          {/* nodes */}
          {diagram.nodes.map((n) => (
            <g key={n.id} transform={`translate(${n.x},${n.y})`}>
              {/* hit area for dragging */}
              {!lockedView && (
                <circle
                  r={28}
                  fill="transparent"
                  className="node-hit"
                  onMouseDown={(e) => onMouseDownNode(e, n)}
                  onClick={() => setSelectedNode(n.id)}
                />
              )}

              {/* symbols */}
              {n.type === "source" && (
                <g className={selectedNode === n.id ? "sel" : ""}>
                  <circle r={18} fill="#fff" stroke="#0f172a" strokeWidth={3} />
                  <path d="M -10 0 A 10 10 0 0 0 10 0" fill="none" stroke="#0f172a" strokeWidth={3} />
                </g>
              )}

              {n.type === "bus" && (
                <g className={selectedNode === n.id ? "sel" : ""}>
                  <rect x={-40} y={-6} width={80} height={12} rx={6} fill="#e2e8f0" stroke="#0f172a" strokeWidth={2} />
                </g>
              )}

              {n.type === "load" && (
                <g className={selectedNode === n.id ? "sel" : ""}>
                  <rect x={-26} y={-16} width={52} height={32} rx={4} fill="#f8fafc" stroke="#0f172a" strokeWidth={2} />
                </g>
              )}

              {n.type === "breaker" && (
                <g
                  className={(selectedNode === n.id ? "sel " : "") + "cursor-pointer"}
                  onDoubleClick={() => toggleBreaker(n.id)}
                >
                  {/* ANSI-ish: two terminals + blade */}
                  <circle cx={-14} cy={0} r={3} fill="#0f172a" />
                  <circle cx={14} cy={0} r={3} fill="#0f172a" />
                  {n.closed ? (
                    <line x1={-10} y1={6} x2={10} y2={-6} stroke="#0f172a" strokeWidth={3} />
                  ) : (
                    <line x1={-10} y1={-6} x2={6} y2={-20} stroke="#0f172a" strokeWidth={3} />
                  )}
                  <rect x={-22} y={-16} width={44} height={32} rx={6} fill="transparent" stroke="#0f172a" strokeWidth={2} />
                </g>
              )}

              {n.type === "rectifier" && (
                <g className={selectedNode === n.id ? "sel" : ""}>
                  {/* left: AC symbol ~ ; right: DC symbol = */}
                  <text x={-14} y={-10} fontSize="12" textAnchor="middle">~</text>
                  <text x={14} y={-10} fontSize="12" textAnchor="middle">=</text>
                  <rect x={-22} y={-16} width={44} height={32} rx={6} fill="#fff" stroke="#0f172a" strokeWidth={2} />
                </g>
              )}

              {n.type === "inverter" && (
                <g className={selectedNode === n.id ? "sel" : ""}>
                  {/* left: DC = ; right: AC ~ */}
                  <text x={-14} y={-10} fontSize="12" textAnchor="middle">=</text>
                  <text x={14} y={-10} fontSize="12" textAnchor="middle">~</text>
                  <rect x={-22} y={-16} width={44} height={32} rx={6} fill="#fff" stroke="#0f172a" strokeWidth={2} />
                </g>
              )}

              {/* label (inline rename) */}
              {editingLabel === n.id ? (
                <foreignObject x={-60} y={26} width={120} height={26}>
                  <input
                    autoFocus
                    defaultValue={n.label}
                    onBlur={(e) => { renameNode(n.id, e.currentTarget.value); setEditingLabel(null); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { const el = e.target as HTMLInputElement; renameNode(n.id, el.value); setEditingLabel(null); }
                      if (e.key === "Escape") setEditingLabel(null);
                    }}
                    style={{ width: "100%", fontSize: 12, padding: "2px 6px", border: "1px solid #cbd5e1", borderRadius: 6 }}
                  />
                </foreignObject>
