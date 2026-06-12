import { describe, it, expect } from "vitest";

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await fetch("http://localhost:4000/health");
    const data = await res.json();
    expect(data.status).toBe("ok");
  });
});

describe("POST /api/agent", () => {
  it("returns ui, fileTree, logs", async () => {
    const res = await fetch("http://localhost:4000/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "say hello" }),
    });
    const data = await res.json();
    expect(data).toHaveProperty("ui");
    expect(data).toHaveProperty("fileTree");
    expect(data).toHaveProperty("logs");
  });
});
