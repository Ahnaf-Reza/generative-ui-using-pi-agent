import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import cors from "cors";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { getModel, getModels, getProviders } from "@earendil-works/pi-ai";

const envFilePath = fileURLToPath(new URL("../.env", import.meta.url));
dotenv.config({ path: envFilePath, override: true });
const backendEnv = (() => {
  try {
    return dotenv.parse(readFileSync(envFilePath));
  } catch {
    return {};
  }
})();

const app = express();
app.use(bodyParser.json());
app.use(cors());

const publicDir = fileURLToPath(new URL("../public", import.meta.url));
const publicIndexFile = fileURLToPath(new URL("../public/index.html", import.meta.url));

app.use(express.static(publicDir));

const providerEnvMap = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  groq: "GROQ_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  xai: "XAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

const sessionCache = new Map();

function resolveProvider() {
  if (backendEnv.PI_PROVIDER) return backendEnv.PI_PROVIDER;
  if (backendEnv.GEMINI_API_KEY) return "google";
  if (backendEnv.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.PI_PROVIDER) return process.env.PI_PROVIDER;
  if (process.env.GEMINI_API_KEY) return "google";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "anthropic";
}

function resolveModelId(provider, modelId) {
  if (!modelId) return undefined;
  const providerPrefix = `${provider}.`;
  if (modelId.startsWith(providerPrefix)) {
    return modelId.slice(providerPrefix.length);
  }
  return modelId;
}

function resolveApiKey(provider, apiKey) {
  if (apiKey) return apiKey;

  const providerEnv = providerEnvMap[provider];
  if (providerEnv && backendEnv[providerEnv]) {
    return backendEnv[providerEnv];
  }

  if (providerEnv && process.env[providerEnv]) {
    return process.env[providerEnv];
  }

  return backendEnv.PI_API_KEY || process.env.PI_API_KEY || "";
}

function serializeProviders() {
  return getProviders()
    .slice()
    .sort((left, right) => {
      if (left === "anthropic") return -1;
      if (right === "anthropic") return 1;
      return left.localeCompare(right);
    })
    .map((provider) => ({
      provider,
      models: getModels(provider).map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
      })),
    }));
}

async function getSharedSession(provider, modelId, apiKey) {
  const key = `${provider}:${modelId || ""}:${apiKey || ""}`;
  if (sessionCache.has(key)) return sessionCache.get(key);

  const authStorage = AuthStorage.create();
  const resolvedApiKey = resolveApiKey(provider, apiKey);
  if (!resolvedApiKey) {
    throw new Error(`Missing API key for ${provider}`);
  }

  authStorage.setRuntimeApiKey(provider, resolvedApiKey);

  const modelRegistry = ModelRegistry.create(authStorage);
  const sessionManager = SessionManager.inMemory();
  const normalizedModelId = resolveModelId(provider, modelId);
  const model = normalizedModelId ? getModel(provider, normalizedModelId) : undefined;

  if (normalizedModelId && !model) {
    const availableModels = getModels(provider).map((entry) => entry.id).join(", ");
    throw new Error(
      `Unknown model "${modelId}" for provider "${provider}". Available models: ${availableModels}`,
    );
  }

  const { session } = await createAgentSession({
    sessionManager,
    authStorage,
    modelRegistry,
    model,
  });

  sessionCache.set(key, session);
  return session;
}

function extractAssistantReply(messages) {
  const assistantMessage = [...messages].reverse().find((message) => message.role === "assistant");
  if (!assistantMessage || !Array.isArray(assistantMessage.content)) return "";

  return assistantMessage.content
    .map((block) => (block && block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .join("")
    .trim();
}

function getLastAssistantMessage(messages) {
  return [...messages].reverse().find((message) => message.role === "assistant") || null;
}

function formatPiError(err) {
  const message = String(err?.message || err || "unknown error");

  if (message.includes("API_KEY_INVALID") || message.includes("API key not valid")) {
    return {
      status: 400,
      error:
        "Google API key is invalid. Replace GEMINI_API_KEY in backend/.env with a valid Gemini API key from Google AI Studio or Google Cloud, then restart the backend.",
    };
  }

  if (message.includes("Missing API key for")) {
    return {
      status: 500,
      error: message,
    };
  }

  return {
    status: 500,
    error: message,
  };
}

app.get("/api/pi-meta", (_req, res) => {
  res.json({ providers: serializeProviders() });
});

app.post("/api/pi-chat", async (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: "missing message" });

  const provider = resolveProvider();
  const modelId = backendEnv.PI_MODEL || process.env.PI_MODEL || undefined;

  const envKeyMap = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GEMINI_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    mistral: process.env.MISTRAL_API_KEY,
    groq: process.env.GROQ_API_KEY,
  };
  const apiKey = envKeyMap[provider] || process.env.PI_API_KEY || "";

  try {
    const session = await getSharedSession(provider, modelId, apiKey);

    let output = "";
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        output += event.assistantMessageEvent.delta;
      }
    });

    await session.prompt(message);
    await session.agent.waitForIdle();
    unsubscribe();

    const lastAssistantMessage = getLastAssistantMessage(session.state?.messages || []);
    if (lastAssistantMessage?.stopReason === "error") {
      throw new Error(lastAssistantMessage.errorMessage || "assistant returned an error");
    }

    if (!output) {
      output = extractAssistantReply(session.state?.messages || []);
    }

    res.json({ reply: output });
  } catch (err) {
    console.error(err);
    const formatted = formatPiError(err);
    res.status(formatted.status).json({ error: formatted.error });
  }
});

app.get("/", (_req, res) => {
  res.sendFile(publicIndexFile);
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Pi proxy running on http://localhost:${port}`));
