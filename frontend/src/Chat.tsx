import { useState, useRef, useEffect } from "react";

type Message = { role: "user" | "assistant"; content: string };

function Face({ mood = "happy" }: { mood?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "10px" }}>
      <svg width="100" height="100" viewBox="0 0 100 100" style={{ background: "#333", borderRadius: "50%", padding: "10px" }}>
        <circle cx="30" cy="40" r="5" fill="white" />
        <circle cx="70" cy="40" r="5" fill="white" />
        {mood === "happy" ? (
          <path d="M 30 70 Q 50 85 70 70" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" />
        ) : (
          <path d="M 30 80 Q 50 65 70 80" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" />
        )}
      </svg>
    </div>
  );
}

function renderContent(content: string) {
  try {
    const parsed = JSON.parse(content);
    if (parsed.type === "ui-component") {
      if (parsed.component === "Face") {
        return <Face mood={parsed.props?.mood} />;
      }
    }
  } catch (e) {}
  return <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit" }}>{content}</pre>;
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    try {
      const res = await fetch("/api/pi-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply ?? data.error ?? "No response" }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Error: could not reach backend." }]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", maxWidth:800, margin:"0 auto" }}>
      <div style={{ padding:"16px 24px", borderBottom:"1px solid #2a2a2a", display:"flex", alignItems:"center", gap:10 }}>
        <h1 style={{ fontSize:"1.1rem", fontWeight:600 }}>Pi Agent</h1>
        <span style={{ width:8, height:8, borderRadius:"50%", background:"#4ade80", marginLeft:"auto" }} />
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:24, display:"flex", flexDirection:"column", gap:16 }}>
        {messages.length === 0 && <p style={{ color:"#666", textAlign:"center", marginTop:40 }}>Type a message to start.</p>}
        {messages.map((m, i) => (
          <div key={i} style={{
            maxWidth:"75%", padding:"12px 16px", borderRadius:12, fontSize:"0.9rem", lineHeight:1.6,
            alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            background: m.role === "user" ? "#1e1b3a" : "#1a1a1a",
            border: m.role === "user" ? "1px solid #2d2560" : "1px solid #2a2a2a",
          }}>
            {renderContent(m.content)}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf:"flex-start", background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, padding:"14px 18px", display:"flex", gap:6 }}>
            {[0,200,400].map((d) => (
              <span key={d} style={{ width:7, height:7, borderRadius:"50%", background:"#666", display:"inline-block", animation:`bounce 1.2s ${d}ms infinite` }} />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding:"16px 24px", borderTop:"1px solid #2a2a2a", display:"flex", gap:10 }}>
        <textarea
          ref={textareaRef}
          rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown} disabled={loading}
          placeholder="Ask the agent anything…"
          style={{ flex:1, background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, color:"#e8e8e8", fontFamily:"inherit", fontSize:"0.9rem", padding:"12px 16px", resize:"none", outline:"none", overflow:"hidden" }}
        />
        <button onClick={send} disabled={loading || !input.trim()}
          style={{ background:"#7c6af7", color:"#fff", border:"none", borderRadius:12, padding:"0 20px", fontSize:"0.9rem", fontWeight:500, cursor:"pointer", opacity: loading || !input.trim() ? 0.4 : 1 }}>
          Send
        </button>
      </div>
      <style>{`@keyframes bounce { 0%,80%,100%{transform:translateY(0);opacity:0.4} 40%{transform:translateY(-6px);opacity:1} }`}</style>
    </div>
  );
}
