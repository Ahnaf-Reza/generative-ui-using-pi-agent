import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { getModel, getModels, getProviders } from "@earendil-works/pi-ai";

// ── env ──────────────────────────────────────────────────────────────────────
const envFilePath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env");
let backendEnv: Record<string, string> = {};
try {
  const raw = readFileSync(envFilePath, "utf8");
  for (const line of raw.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) backendEnv[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

// ── paths ─────────────────────────────────────────────────────────────────────
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir   = resolve(dirname(fileURLToPath(import.meta.url)), "../public");

// ── provider helpers ──────────────────────────────────────────────────────────
const providerEnvMap: Record<string, string> = {
  anthropic:  "ANTHROPIC_API_KEY",
  openai:     "OPENAI_API_KEY",
  google:     "GEMINI_API_KEY",
  mistral:    "MISTRAL_API_KEY",
  groq:       "GROQ_API_KEY",
  deepseek:   "DEEPSEEK_API_KEY",
  xai:        "XAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

function resolveProvider() {
  return (
    backendEnv.PI_PROVIDER ||
    (backendEnv.GEMINI_API_KEY     ? "google"    : null) ||
    (backendEnv.ANTHROPIC_API_KEY  ? "anthropic" : null) ||
    process.env.PI_PROVIDER ||
    (process.env.GEMINI_API_KEY    ? "google"    : null) ||
    (process.env.ANTHROPIC_API_KEY ? "anthropic" : null) ||
    "anthropic"
  );
}

function resolveModelId(provider: string, modelId?: string) {
  if (!modelId) return undefined;
  const prefix = `${provider}.`;
  return modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId;
}

function resolveApiKey(provider: string, apiKey?: string) {
  if (apiKey) return apiKey;
  const envKey = providerEnvMap[provider];
  return (
    (envKey && (backendEnv[envKey] || process.env[envKey])) ||
    backendEnv.PI_API_KEY ||
    process.env.PI_API_KEY ||
    ""
  );
}

function serializeProviders() {
  return getProviders()
    .slice()
    .sort((a, b) => (a === "anthropic" ? -1 : b === "anthropic" ? 1 : a.localeCompare(b)))
    .map((provider) => ({
      provider,
      models: getModels(provider).map((m) => ({ id: m.id, name: m.name ?? m.id })),
    }));
}

// ── workspace file tree ───────────────────────────────────────────────────────
import { readdirSync, statSync } from "fs";

function buildFileTree(dir: string, base = dir): any[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => !f.startsWith(".") && f !== "node_modules")
    .map((name) => {
      const full = resolve(dir, name);
      const rel  = full.replace(base + "/", "");
      const isDir = statSync(full).isDirectory();
      return isDir
        ? { name, path: rel, type: "dir", children: buildFileTree(full, base) }
        : { name, path: rel, type: "file" };
    });
}

// ── pi session cache ──────────────────────────────────────────────────────────
const sessionCache = new Map<string, any>();

async function getSharedSession(provider: string, modelId?: string, apiKey?: string) {
  const key = `${provider}:${modelId ?? ""}:${apiKey ?? ""}`;
  if (sessionCache.has(key)) return sessionCache.get(key)!;

  const authStorage    = AuthStorage.create();
  const resolvedApiKey = resolveApiKey(provider, apiKey);
  if (!resolvedApiKey) throw new Error(`Missing API key for ${provider}`);

  authStorage.setRuntimeApiKey(provider as any, resolvedApiKey);

  const modelRegistry     = ModelRegistry.create(authStorage);
  const sessionManager    = SessionManager.inMemory();
  const normalizedModelId = resolveModelId(provider, modelId);
  const model             = normalizedModelId ? getModel(provider as any, normalizedModelId) : undefined;

  if (normalizedModelId && !model) {
    const available = getModels(provider as any).map((e: any) => e.id).join(", ");
    throw new Error(`Unknown model "${modelId}" for provider "${provider}". Available: ${available}`);
  }

  const { session } = await createAgentSession({
    sessionManager,
    authStorage,
    modelRegistry,
    model,
    cwd: projectRoot,
    tools: ["read", "bash", "edit", "write"],
  });

  sessionCache.set(key, session);
  return session;
}

function extractReply(messages: any[]) {
  const msg = [...messages].reverse().find((m) => m.role === "assistant");
  if (!msg || !Array.isArray(msg.content)) return "";
  return msg.content
    .map((b: any) => (b?.type === "text" && typeof b.text === "string" ? b.text : ""))
    .join("")
    .trim();
}

function formatPiError(err: unknown) {
  const message = String((err as any)?.message || err || "unknown error");
  if (message.includes("API_KEY_INVALID") || message.includes("API key not valid"))
    return { status: 400 as const, error: "Invalid API key. Check your .env file." };
  if (message.includes("Missing API key for"))
    return { status: 500 as const, error: message };
  return { status: 500 as const, error: message };
}

// ── app ───────────────────────────────────────────────────────────────────────
const app = new Elysia()
  .use(cors())
  .use(existsSync(publicDir) ? staticPlugin({ assets: publicDir, prefix: "/" }) : (x: any) => x)

  // health
  .get("/health", () => ({ status: "ok", timestamp: new Date().toISOString() }))

  // providers
  .get("/api/pi-meta", () => ({ providers: serializeProviders() }))

  // chat (existing — keeps working)
  .post("/api/pi-chat", async ({ body, set }: { body: any; set: any }) => {
    const { message } = body ?? {};
    if (!message) { set.status = 400; return { error: "missing message" }; }

    const provider = resolveProvider();
    const modelId  = backendEnv.PI_MODEL || process.env.PI_MODEL;
    const apiKey   = resolveApiKey(provider);

    try {
      const session = await getSharedSession(provider, modelId, apiKey);

      let output = "";
      const isFirstMessage = (session.state?.messages ?? []).length === 0;
      const unsubscribe = session.subscribe((event: any) => {
        if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta")
          output += event.assistantMessageEvent.delta;
      });

      const prompt = isFirstMessage
        ? `You have access to read, write, edit, and bash tools. Use them directly when needed. The project is at ${projectRoot}. Now respond to: ${message}`
        : message;

      await session.prompt(prompt);
      await session.agent.waitForIdle();
      unsubscribe();

      const lastMsg = [...(session.state?.messages ?? [])].reverse().find((m: any) => m.role === "assistant");
      if (lastMsg?.stopReason === "error")
        throw new Error(lastMsg.errorMessage || "assistant returned an error");

      if (!output) output = extractReply(session.state?.messages ?? []);
      return { reply: output };
    } catch (err) {
      console.error(err);
      const { status, error } = formatPiError(err);
      set.status = status;
      return { error };
    }
  })

  // agent (Week 1 — stub that will grow into full generative UI)
  .post("/api/agent", async ({ body }: { body: any }) => {
    const { prompt } = body ?? {};
    if (!prompt) return { error: "missing prompt" };

    const workspaceDir = resolve(projectRoot, "workspace");
    const fileTree     = buildFileTree(workspaceDir);

    // For now: pass prompt through the pi session and return structured response
    const provider = resolveProvider();
    const modelId  = backendEnv.PI_MODEL || process.env.PI_MODEL;
    const apiKey   = resolveApiKey(provider);

    const logs: string[] = [`[agent] received prompt: ${prompt}`];

    try {
      const session = await getSharedSession(provider, modelId, apiKey);

      let output = "";
      const unsubscribe = session.subscribe((event: any) => {
        if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta")
          output += event.assistantMessageEvent.delta;
      });

      await session.prompt(prompt);
      await session.agent.waitForIdle();
      unsubscribe();

      if (!output) output = extractReply(session.state?.messages ?? []);
      logs.push(`[agent] response received`);

      return {
        ui: {
          type: "panel",
          children: [{ type: "text", content: output }],
        },
        fileTree: buildFileTree(workspaceDir),
        logs,
      };
    } catch (err) {
      logs.push(`[agent] error: ${(err as any)?.message}`);
      return { ui: {}, fileTree, logs };
    }
  })

  .listen(process.env.PORT ? Number(process.env.PORT) : 4000);

console.log(`🚀 Server running on http://localhost:${app.server?.port}`);
console.log(`📁 Project root: ${projectRoot}`);