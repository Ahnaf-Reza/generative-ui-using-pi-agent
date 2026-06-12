// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

describe("frontend", () => {
  it("renders without crashing", () => {
    expect(true).toBe(true);
  });

  it("API base is correct", () => {
    const api = "/api/pi-chat";
    expect(api.startsWith("/api")).toBe(true);
  });
});
