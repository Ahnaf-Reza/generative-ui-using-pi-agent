Pi agent integration (minimal)

Setup

- Copy `.env.example` to `.env` and set `PI_API_KEY` for your provider (e.g. Anthropic).
- Install dependencies:

  # Prefer setting a provider-specific key and backend provider/model
  # Example for Google Gemini (set your own key locally; do NOT paste it into chat):
  # GEMINI_API_KEY=AIza... (put this in backend/.env)
  # PI_PROVIDER=google
  # PI_MODEL=google.gemma-4-31b-it

  # For Anthropic replace with ANTHROPIC_API_KEY and PI_PROVIDER=anthropic

  # Copy .env example and edit
  # cp .env.example .env

  # Then install dependencies:

```
cd backend
npm install
```

- Start the server:

```
npm start
```

Usage

- POST to `/api/pi-chat` with JSON body:

```
{
  "message": "Hello Pi, tell me a joke",
  "provider": "anthropic",        // optional
  "modelId": "claude-opus-4-5"   // optional
}
```

- Example curl:

```
curl -X POST http://localhost:4000/api/pi-chat -H "Content-Type: application/json" -d '{"message":"Hello"}'
```

Notes

- This creates a fresh AgentSession per request. For production, consider reusing sessions and adding caching, rate limiting, and robust error handling.
