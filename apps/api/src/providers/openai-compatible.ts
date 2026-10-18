import type { LlmProvider } from './types.js';

// Chat completions over the OpenAI wire format. IONOS AI Model Hub speaks it, and so do most
// other hosts, so switching vendor means changing the base URL and model, not the code.

export const IONOS_BASE_URL = 'https://openai.inference.de-txl.ionos.com/v1';

export type OpenAiCompatibleConfig = { baseUrl: string; token: string; model: string; timeoutMs?: number };

async function call(cfg: Pick<OpenAiCompatibleConfig, 'baseUrl' | 'token' | 'timeoutMs'>, path: string, body?: unknown) {
  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 30_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    if (res.status === 401 || res.status === 403) throw new Error('Der Token wurde abgelehnt. Ist er abgelaufen oder falsch kopiert?');
    throw new Error(`KI-Anbieter antwortet mit ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res.json() as Promise<unknown>;
}

export async function listModels(cfg: Pick<OpenAiCompatibleConfig, 'baseUrl' | 'token'>): Promise<string[]> {
  const body = (await call({ ...cfg, timeoutMs: 15_000 }, '/models')) as { data?: { id: string }[] };
  return (body.data ?? []).map((m) => m.id).sort();
}

export function openAiCompatibleLlm(cfg: OpenAiCompatibleConfig): LlmProvider {
  return {
    async complete({ messages, maxTokens }) {
      const body = (await call(cfg, '/chat/completions', {
        model: cfg.model,
        messages,
        max_tokens: maxTokens ?? 500,
        temperature: 0.3,
        // Qwen 3.x reasons by default and the reasoning counts toward max_tokens; short customer
        // answers don't need it and it would only add delay.
        ...(/qwen3/i.test(cfg.model) ? { reasoning_effort: 'none' } : {}),
      })) as { choices?: { message?: { content?: string } }[] };
      const text = body.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error('Der KI-Anbieter hat eine leere Antwort geliefert.');
      return text;
    },
  };
}
