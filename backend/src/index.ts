import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { getModel, getModels, getProviders } from "@earendil-works/pi-ai";

// ── env ───────────────────────────────────────────────────────────────────────
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
const projectRoot  = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir    = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
const workspaceDir = resolve(projectRoot, "workspace");

// ── types ─────────────────────────────────────────────────────────────────────
type FileNode =
  | { name: string; path: string; type: "file" }
  | { name: string; path: string; type: "dir"; children: FileNode[] };

type SystemOp = {
  executor: "system";
  program: string;
  args: string[];
  cwd?: string;
};

type Op = SystemOp;

type UiNode =
  | { type: "text"; content: string }
  | { type: "panel"; children: UiNode[] }
  | { type: "log"; lines: string[] }
  | { type: "fileTree"; nodes: FileNode[] };

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

function resolveProvider(): string {
  return (
    backendEnv.PI_PROVIDER ||
    (backendEnv.GEMINI_API_KEY    ? "google"    : "") ||
    (backendEnv.ANTHROPIC_API_KEY ? "anthropic" : "") ||
    process.env.PI_PROVIDER ||
    (process.env.GEMINI_API_KEY    ? "google"    : "") ||
    (process.env.ANTHROPIC_API_KEY ? "anthropic" : "") ||
    "anthropic"
  );
}

function resolveModelId(provider: string, modelId?: string): string | undefined {
  if (!modelId) return undefined;
  const prefix = `${provider}.`;
  return modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId;
}

function resolveApiKey(provider: string, apiKey?: string): string {
  if (apiKey) return apiKey;
  const envKey = providerEnvMap[provider];
  return (
    (envKey && (backendEnv[envKey] || process.env[envKey] || "")) ||
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
      models: getModels(provider as Parameters<typeof getModels>[0]).map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
      })),
    }));
}

// ── file tree ─────────────────────────────────────────────────────────────────
function buildFileTree(dir: string, base = dir): FileNode[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => !f.startsWith(".") && f !== "node_modules")
    .map((name): FileNode => {
      const full  = resolve(dir, name);
      const rel   = full.replace(base + "/", "");
      const isDir = statSync(full).isDirectory();
      return isDir
        ? { name, path: rel, type: "dir", children: buildFileTree(full, base) }
        : { name, path: rel, type: "file" };
    });
}

// ── execution engine ──────────────────────────────────────────────────────────
type ExecResult = { stdout: string; stderr: string; exitCode: number };

function runOp(op: Op): ExecResult {
  if (op.executor === "system") {
    const cwd = op.cwd ? resolve(workspaceDir, op.cwd) : workspaceDir;
    const result = spawnSync(op.program, op.args, {
      cwd,
      encoding: "utf8",
      timeout: 30_000,
    });
    return {
      stdout:   result.stdout ?? "",
      stderr:   result.stderr ?? "",
      exitCode: result.status ?? 1,
    };
  }
  return { stdout: "", stderr: `Unknown executor`, exitCode: 1 };
}

// ── pi session ────────────────────────────────────────────────────────────────
const sessionCache = new Map<string, ReturnType<typeof createAgentSession> extends Promise<infer T> ? T["session"] : never>();

async function getSharedSession(provider: string, modelId?: string, apiKey?: string) {
  const key = `${provider}:${modelId ?? ""}:${apiKey ?? ""}`;
  if (sessionCache.has(key)) return sessionCache.get(key)!;

  const authStorage    = AuthStorage.create();
  const resolvedApiKey = resolveApiKey(provider, apiKey);
  if (!resolvedApiKey) throw new Error(`Missing API key for ${provider}`);

  authStorage.setRuntimeApiKey(provider as Parameters<typeof authStorage.setRuntimeApiKey>[0], resolvedApiKey);

  const modelRegistry     = ModelRegistry.create(authStorage);
  const sessionManager    = SessionManager.inMemory();
  const normalizedModelId = resolveModelId(provider, modelId);
  const model             = normalizedModelId
    ? getModel(provider as Parameters<typeof getModel>[0], normalizedModelId)
    : undefined;

  if (normalizedModelId && !model) {
    const available = getModels(provider as Parameters<typeof getModels>[0]).map((e) => e.id).join(", ");
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

function extractReply(messages: { role: string; content: unknown }[]): string {
  const msg = [...messages].reverse().find((m) => m.role === "assistant");
  if (!msg || !Array.isArray(msg.content)) return "";
  return (msg.content as { type?: string; text?: string }[])
    .map((b) => (b?.type === "text" && typeof b.text === "string" ? b.text : ""))
    .join("")
    .trim();
}

function formatPiError(err: unknown): { status: 400 | 500; error: string } {
  const message = String((err as Error)?.message || err || "unknown error");
  if (message.includes("API_KEY_INVALID") || message.includes("API key not valid"))
    return { status: 400, error: "Invalid API key. Check your .env file." };
  if (message.includes("Missing API key for"))
    return { status: 500, error: message };
  return { status: 500, error: message };
}

// ── app ───────────────────────────────────────────────────────────────────────
const app = new Elysia()
  .use(cors())
  .use(existsSync(publicDir) ? staticPlugin({ assets: publicDir, prefix: "/" }) : (x: Elysia) => x)

  .get("/health", () => ({ status: "ok", timestamp: new Date().toISOString() }))

  .get("/api/pi-meta", () => ({ providers: serializeProviders() }))

  // ── chat ──────────────────────────────────────────────────────────────────
  .post("/api/pi-chat", async ({ body, set }) => {
    const { message } = (body as { message?: string }) ?? {};
    if (!message) { set.status = 400; return { error: "missing message" }; }

    const provider = resolveProvider();
    const modelId  = backendEnv.PI_MODEL || process.env.PI_MODEL;
    const apiKey   = resolveApiKey(provider);

    try {
      const session = await getSharedSession(provider, modelId, apiKey);
      let output = "";
      const isFirst = (session.state?.messages ?? []).length === 0;
      const unsub = session.subscribe((event: { type: string; assistantMessageEvent?: { type: string; delta?: string } }) => {
        if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta")
          output += event.assistantMessageEvent.delta ?? "";
      });

      const prompt = isFirst
        ? `You are a helpful AI assistant. You have access to read, write, edit, and bash tools. Use them directly when needed. The project is at ${projectRoot}. 
        
        GENERATIVE UI: You can render custom UI components by responding with a JSON object:
        {"type": "ui-component", "component": "ComponentName", "props": { ... }}
        Currently available components:
        - Face: { "mood": "happy" | "sad" }
        
        Now respond to: ${message}`
        : message;

      await session.prompt(prompt);
      await (session as { agent: { waitForIdle: () => Promise<void> } }).agent.waitForIdle();
      unsub();

      const lastMsg = [...(session.state?.messages ?? [])].reverse().find((m: { role: string }) => m.role === "assistant") as { stopReason?: string; errorMessage?: string } | undefined;
      if (lastMsg?.stopReason === "error") throw new Error(lastMsg.errorMessage || "assistant error");
      if (!output) output = extractReply(session.state?.messages ?? []);
      return { reply: output };
    } catch (err) {
      console.error(err);
      const { status, error } = formatPiError(err);
      set.status = status;
      return { error };
    }
  })

  // ── agent (Week 1) ────────────────────────────────────────────────────────
  .post("/api/agent", async ({ body, set }) => {
    const { prompt, ops } = (body as { prompt?: string; ops?: Op[] }) ?? {};
    if (!prompt && !ops) { set.status = 400; return { error: "missing prompt or ops" }; }

    const logs: string[] = [];
    const execResults: ExecResult[] = [];

    // 1. run any explicit ops passed from frontend
    if (ops?.length) {
      for (const op of ops) {
        logs.push(`[exec] ${op.executor}: ${op.program} ${op.args.join(" ")}`);
        const result = runOp(op);
        execResults.push(result);
        if (result.stdout) logs.push(`[stdout] ${result.stdout.trim()}`);
        if (result.stderr) logs.push(`[stderr] ${result.stderr.trim()}`);
        logs.push(`[exit] ${result.exitCode}`);
      }
    }

    // 2. call pi if prompt provided
    let piReply = "";
    if (prompt) {
      logs.push(`[agent] prompt: ${prompt}`);
      const provider = resolveProvider();
      const modelId  = backendEnv.PI_MODEL || process.env.PI_MODEL;
      const apiKey   = resolveApiKey(provider);
      try {
        const session = await getSharedSession(provider, modelId, apiKey);
        let output = "";
        const unsub = session.subscribe((event: { type: string; assistantMessageEvent?: { type: string; delta?: string } }) => {
          if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta")
            output += event.assistantMessageEvent.delta ?? "";
        });
        await session.prompt(prompt);
        await (session as { agent: { waitForIdle: () => Promise<void> } }).agent.waitForIdle();
        unsub();
        if (!output) output = extractReply(session.state?.messages ?? []);
        piReply = output;
        logs.push(`[agent] done`);
      } catch (err) {
        logs.push(`[agent] error: ${(err as Error)?.message}`);
      }
    }

    // 3. build UI schema
    const ui: UiNode = {
      type: "panel",
      children: [
        ...(piReply ? [{ type: "text" as const, content: piReply }] : []),
        ...(execResults.length ? [{ type: "log" as const, lines: logs }] : []),
        { type: "fileTree" as const, nodes: buildFileTree(workspaceDir) },
      ],
    };

    return {
      ui,
      fileTree: buildFileTree(workspaceDir),
      logs,
    };
  })

  .listen(process.env.PORT ? Number(process.env.PORT) : 4000);

console.log(`Server running on http://localhost:${app.server?.port}`);
console.log(`Project root: ${projectRoot}`);
console.log(`Workspace:    ${workspaceDir}`);