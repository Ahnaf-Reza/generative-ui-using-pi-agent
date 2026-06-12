import { useState } from "react";

type FileNode =
  | { name: string; path: string; type: "file" }
  | { name: string; path: string; type: "dir"; children: FileNode[] };

type UiNode =
  | { type: "text"; content: string }
  | { type: "panel"; children: UiNode[] }
  | { type: "log"; lines: string[] }
  | { type: "fileTree"; nodes: FileNode[] };

type AgentResponse = {
  ui: UiNode;
  fileTree: FileNode[];
  logs: string[];
};

// ── file tree ─────────────────────────────────────────────────────────────────
function FileTree({ nodes, depth = 0 }: { nodes: FileNode[]; depth?: number }) {
  if (!nodes.length) return <p style={{ color: "#555", fontSize: "0.8rem", padding: "8px 0" }}>workspace is empty</p>;
  return (
    <div>
      {nodes.map((node) => (
        <div key={node.path}>
          <div style={{
            paddingLeft: depth * 14 + 8, paddingTop: 3, paddingBottom: 3,
            fontSize: "0.8rem", color: node.type === "dir" ? "#a78bfa" : "#cbd5e1",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <span>{node.type === "dir" ? "📁" : "📄"}</span>
            <span>{node.name}</span>
          </div>
          {node.type === "dir" && <FileTree nodes={node.children} depth={depth + 1} />}
        </div>
      ))}
    </div>
  );
}

// ── ui renderer ───────────────────────────────────────────────────────────────
function RenderUi({ node }: { node: UiNode }) {
  if (node.type === "text") {
    return (
      <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit", fontSize: "0.88rem", lineHeight: 1.65, color: "#e8e8e8" }}>
        {node.content}
      </pre>
    );
  }
  if (node.type === "panel") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {node.children.map((child, i) => <RenderUi key={i} node={child} />)}
      </div>
    );
  }
  if (node.type === "log") {
    return (
      <div style={{ background: "#111", borderRadius: 8, padding: "10px 14px", fontFamily: "monospace", fontSize: "0.78rem", color: "#6ee7b7" }}>
        {node.lines.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    );
  }
  if (node.type === "fileTree") {
    return <FileTree nodes={node.nodes} />;
  }
  return null;
}

// ── main panel ────────────────────────────────────────────────────────────────
export default function AgentPanel() {
  const [prompt, setPrompt]     = useState("");
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<AgentResponse | null>(null);
  const [error, setError]       = useState("");

  async function run() {
    const text = prompt.trim();
    if (!text || loading) return;
    setPrompt("");
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      const data: AgentResponse = await res.json();
      setResult(data);
    } catch {
      setError("Could not reach backend.");
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); }
  }

  const s = {
    panel: { background: "#141414", border: "1px solid #2a2a2a", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column" as const, gap: 8, overflow: "hidden" },
    label: { fontSize: "0.72rem", fontWeight: 600, color: "#555", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 4 },
  };

  return (
    <div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100%", padding: 16, gap: 12 }}>
      {/* prompt bar */}
      <div style={{ display: "flex", gap: 8 }}>
        <textarea
          rows={1} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={onKeyDown} disabled={loading}
          placeholder="Describe what you want the agent to do…"
          style={{ flex: 1, background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 10, color: "#e8e8e8", fontFamily: "inherit", fontSize: "0.9rem", padding: "10px 14px", resize: "none", outline: "none" }}
        />
        <button onClick={run} disabled={loading || !prompt.trim()} style={{
          background: "#7c6af7", color: "#fff", border: "none", borderRadius: 10,
          padding: "0 20px", fontSize: "0.9rem", fontWeight: 500, cursor: "pointer",
          opacity: loading || !prompt.trim() ? 0.4 : 1,
        }}>
          {loading ? "Running…" : "Run"}
        </button>
      </div>

      {/* 3-column layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: 12, overflow: "hidden" }}>
        {/* file tree */}
        <div style={{ ...s.panel, overflowY: "auto" }}>
          <div style={s.label}>Workspace</div>
          <FileTree nodes={result?.fileTree ?? []} />
        </div>

        {/* ui output */}
        <div style={{ ...s.panel, overflowY: "auto" }}>
          <div style={s.label}>Output</div>
          {error && <p style={{ color: "#f87171", fontSize: "0.85rem" }}>{error}</p>}
          {!result && !error && <p style={{ color: "#555", fontSize: "0.85rem" }}>Run a prompt to see output here.</p>}
          {result && <RenderUi node={result.ui} />}
        </div>

        {/* logs */}
        <div style={{ ...s.panel, overflowY: "auto" }}>
          <div style={s.label}>Logs</div>
          {result?.logs.length
            ? result.logs.map((l, i) => (
                <div key={i} style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#6ee7b7", lineHeight: 1.6 }}>{l}</div>
              ))
            : <p style={{ color: "#555", fontSize: "0.8rem" }}>No logs yet.</p>
          }
        </div>
      </div>
    </div>
  );
}
