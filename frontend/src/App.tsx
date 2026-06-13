import { useState } from "react";
import Chat from "./Chat";
import AgentPanel from "./AgentPanel";
import "./index.css";

type Tab = "chat" | "agent";
type Message = { role: "user" | "assistant"; content: string };

export default function App() {
  const [tab, setTab] = useState<Tab>("chat");
  const [messages, setMessages] = useState<Message[]>([]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0f0f0f", color: "#e8e8e8", fontFamily: "system-ui, sans-serif" }}>
      <nav style={{ display: "flex", alignItems: "center", gap: 4, padding: "12px 20px", borderBottom: "1px solid #2a2a2a" }}>
        <span style={{ fontWeight: 700, fontSize: "1rem", marginRight: 16 }}>Pi Agent</span>
        {(["chat", "agent"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: tab === t ? "#7c6af7" : "transparent",
            color: tab === t ? "#fff" : "#888",
            border: "1px solid " + (tab === t ? "#7c6af7" : "#2a2a2a"),
            borderRadius: 8, padding: "5px 16px", fontSize: "0.85rem", cursor: "pointer", fontWeight: 500,
          }}>
            {t === "chat" ? "Chat" : "Agent"}
          </button>
        ))}
        <span style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
      </nav>

      <div style={{ flex: 1, overflow: "hidden" }}>
        {/* keep both mounted so state is never lost */}
        <div style={{ display: tab === "chat" ? "flex" : "none", flexDirection: "column", height: "100%" }}>
          <Chat messages={messages} setMessages={setMessages} />
        </div>
        <div style={{ display: tab === "agent" ? "flex" : "none", flexDirection: "column", height: "100%" }}>
          <AgentPanel />
        </div>
      </div>
    </div>
  );
}
