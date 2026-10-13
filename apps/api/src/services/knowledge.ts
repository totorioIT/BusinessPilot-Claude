import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { knowledgeItems, tenants } from '../db/schema.js';
import type { LlmProvider } from '../providers/types.js';

// Knowledge Core: one knowledge base that phone, WhatsApp and web chat all ask.
// V1 ranks entries by word overlap; pgvector embeddings replace the ranking later
// without changing callers.

const STOP = new Set(['der', 'die', 'das', 'und', 'ich', 'sie', 'ihr', 'ihre', 'bei', 'mit', 'ein', 'eine', 'ist', 'wie', 'was', 'habt', 'haben', 'für', 'den', 'dem', 'zu', 'am', 'im', 'in', 'an', 'auf', 'es', 'kann', 'man', 'wir', 'uns', 'noch', 'mal']);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

export type KnowledgeHit = { id: string; title: string; content: string; version: number; score: number };

export async function searchKnowledge(db: DbOrTx, tenantId: string, question: string, limit = 3): Promise<KnowledgeHit[]> {
  const items = await db.select().from(knowledgeItems).where(eq(knowledgeItems.tenantId, tenantId));
  const q = new Set(tokens(question));
  if (q.size === 0) return [];
  return items
    .map((item) => {
      const words = tokens(`${item.category} ${item.title} ${item.content}`);
      // Prefix match lets "reifenwechsel" find "reifen" and "öffnungszeiten" find "geöffnet" style stems.
      const score = [...q].filter((t) => words.some((w) => w.startsWith(t.slice(0, 5)) || t.startsWith(w.slice(0, 5)))).length / q.size;
      return { id: item.id, title: item.title, content: item.content, version: item.version, score };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export type KnowledgeAnswer = {
  answer: string;
  confidence: number;
  sources: { type: 'knowledge'; id: string; title: string; version: number }[];
};

export async function answerQuestion(db: DbOrTx, llm: LlmProvider, tenantId: string, question: string): Promise<KnowledgeAnswer> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  const hits = await searchKnowledge(db, tenantId, question);
  const confidence = hits[0]?.score ?? 0;
  const system =
    `Du bist ${tenant.aiSettings.name}, der digitale Mitarbeiter von ${tenant.name}. ` +
    `Antworte freundlich, kurz und nur mit Informationen aus dem WISSEN. Nenne keine Preise, die nicht im WISSEN stehen. ` +
    `Wenn das WISSEN die Frage nicht beantwortet, sage, dass ein Mitarbeiter sich meldet.\nWISSEN:\n` +
    hits.map((h) => h.content).join('\n');
  const answer = await llm.complete({ messages: [{ role: 'system', content: system }, { role: 'user', content: question }] });
  return {
    answer,
    confidence: Math.round(confidence * 100) / 100,
    sources: hits.map((h) => ({ type: 'knowledge', id: h.id, title: h.title, version: h.version })),
  };
}
