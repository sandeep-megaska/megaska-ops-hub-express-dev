// Minimal, dependency-free OpenAI chat client (REST via fetch) for
// platform-owned AI features. Feature-flagged on OPENAI_API_KEY — every caller
// must treat a null return as "AI unavailable" and degrade gracefully.
//
// Provider-agnostic by design: the model + base URL are env-overridable, so an
// OpenAI-compatible endpoint (or an Anthropic-compatible shim) can be swapped in
// without touching callers.

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 20_000;

export function isAiConfigured(): boolean {
  return Boolean(String(process.env.OPENAI_API_KEY || "").trim());
}

export function aiModel(): string {
  return String(process.env.OPENAI_ANALYTICS_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL).trim();
}

/**
 * Runs a JSON-mode chat completion and returns the parsed object, or null if AI
 * is not configured. Throws on transport/parse failure so callers can decide
 * whether to surface a soft error.
 */
export async function openaiChatJson(input: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<Record<string, unknown> | null> {
  const key = String(process.env.OPENAI_API_KEY || "").trim();
  if (!key) return null;

  const baseUrl = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: input.model || aiModel(),
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        response_format: { type: "json_object" },
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxTokens ?? 900,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`OpenAI request failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(content) as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}
