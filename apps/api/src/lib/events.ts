import type { DbOrTx } from '../db/client.js';
import { events } from '../db/schema.js';
import { newId } from './ids.js';

export type Actor = { type: 'user' | 'ai' | 'system' | 'provider'; id?: string | null; name?: string | null };

export type EventInput = {
  tenantId: string;
  type: string;
  actor: Actor;
  summary: string;
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
};

/**
 * Records a domain event. Events feed the activity stream, the audit log, the automation
 * engine and ROI analytics, so every state change that matters to the customer goes through here.
 */
export async function recordEvent(db: DbOrTx, input: EventInput) {
  const row = {
    id: newId('evt'),
    tenantId: input.tenantId,
    type: input.type,
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    actorName: input.actor.name ?? null,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    summary: input.summary,
    data: input.data ?? {},
  };
  await db.insert(events).values(row);
  return row;
}
