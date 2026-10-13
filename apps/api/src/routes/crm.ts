import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '../db/client.js';
import { customerAssets, customers, leads, quotes, staffMembers, tasks } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { recordEvent } from '../lib/events.js';
import { auth, optionalString, parse, userActor, dateString } from '../lib/http.js';
import { newId, randomCode } from '../lib/ids.js';
import { automationHooks } from '../services/automations.js';
import { appointmentDto, appointmentsQuery } from './scheduling.js';
import { conversationListItems } from './inbox.js';

export const LEAD_STAGES = [
  { key: 'new', label: 'Neue Anfrage' },
  { key: 'qualified', label: 'Qualifiziert' },
  { key: 'appointment', label: 'Termin' },
  { key: 'quote_in_progress', label: 'Angebot in Arbeit' },
  { key: 'quote_sent', label: 'Angebot versendet' },
  { key: 'won', label: 'Gewonnen' },
  { key: 'lost', label: 'Verloren' },
] as const;
const stageKeys = LEAD_STAGES.map((s) => s.key) as [string, ...string[]];

const customerBody = z.object({
  name: z.string().trim().min(1).max(200),
  company: optionalString,
  phone: optionalString,
  email: z.string().trim().email().optional().nullable().or(z.literal('')).transform((v) => v || null),
  address: optionalString,
  notes: optionalString,
});

const quoteItem = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive().max(100000),
  unitPriceCents: z.number().int().min(0).max(100_000_000),
});
const quoteTotal = (items: z.infer<typeof quoteItem>[]) => Math.round(items.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0));

export async function nextCustomerNumber(db: DbOrTx, tenantId: string) {
  // Short random numbers like K-7E5E5B; retry is practically never needed at SMB volumes.
  for (;;) {
    const number = `K-${randomCode(6)}`;
    const [hit] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.number, number)));
    if (!hit) return number;
  }
}

async function nextQuoteNumber(db: DbOrTx, tenantId: string) {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max((regexp_replace(${quotes.number}, '\\D', '', 'g'))::int), 1000)` })
    .from(quotes)
    .where(eq(quotes.tenantId, tenantId));
  return `AN-${Number(row.max) + 1}`;
}

const nameOf = (c: { id: string; name: string } | null) => (c ? { id: c.id, name: c.name } : null);

export async function leadDtos(db: DbOrTx, tenantId: string, customerId?: string) {
  const rows = await db
    .select({ lead: leads, customer: customers })
    .from(leads)
    .leftJoin(customers, eq(customers.id, leads.customerId))
    .where(and(eq(leads.tenantId, tenantId), customerId ? eq(leads.customerId, customerId) : undefined))
    .orderBy(desc(leads.updatedAt));
  return rows.map(({ lead, customer }) => ({
    id: lead.id,
    title: lead.title,
    valueCents: lead.valueCents,
    stage: lead.stage,
    nextAction: lead.nextAction,
    channel: lead.channel,
    customer: nameOf(customer),
    createdAt: lead.createdAt,
  }));
}

export async function quoteDtos(db: DbOrTx, tenantId: string, customerId?: string) {
  const rows = await db
    .select({ quote: quotes, customer: customers })
    .from(quotes)
    .leftJoin(customers, eq(customers.id, quotes.customerId))
    .where(and(eq(quotes.tenantId, tenantId), customerId ? eq(quotes.customerId, customerId) : undefined))
    .orderBy(desc(quotes.createdAt));
  return rows.map(({ quote, customer }) => ({
    id: quote.id,
    number: quote.number,
    title: quote.title,
    status: quote.status,
    items: quote.items,
    totalCents: quote.totalCents,
    aiNote: quote.aiNote,
    customer: nameOf(customer),
    leadId: quote.leadId,
    sentAt: quote.sentAt,
    createdAt: quote.createdAt,
  }));
}

async function ensureCustomer(db: DbOrTx, tenantId: string, customerId: string | null | undefined) {
  if (!customerId) return;
  const [c] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));
  if (!c) throw notFound('Kunde');
}

export async function crmRoutes(app: FastifyInstance) {
  const db = app.db;

  // Customers
  app.get('/customers', async (req) => {
    const a = auth(req);
    const { q } = parse(z.object({ q: z.string().trim().max(100).optional() }), req.query);
    const term = q ? `%${q.replace(/[%_]/g, '')}%` : null;
    return db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.tenantId, a.tenantId),
          term ? or(ilike(customers.name, term), ilike(customers.company, term), ilike(customers.phone, term), ilike(customers.email, term), ilike(customers.number, term)) : undefined,
        ),
      )
      .orderBy(asc(customers.name))
      .limit(500)
      .then((rows) => rows.map(({ tenantId: _t, ...c }) => c));
  });

  app.post('/customers', async (req, reply) => {
    const a = auth(req);
    const body = parse(customerBody, req.body);
    const [c] = await db
      .insert(customers)
      .values({ id: newId('cus'), tenantId: a.tenantId, number: await nextCustomerNumber(db, a.tenantId), ...body })
      .returning();
    await recordEvent(db, { tenantId: a.tenantId, type: 'customer.created', actor: userActor(a), summary: `Kunde ${c.name} angelegt`, entityType: 'customer', entityId: c.id });
    const { tenantId: _t, ...dto } = c;
    return reply.status(201).send(dto);
  });

  app.get('/customers/:id', async (req) => {
    const a = auth(req);
    const { id } = req.params as { id: string };
    const [c] = await db.select().from(customers).where(and(eq(customers.tenantId, a.tenantId), eq(customers.id, id)));
    if (!c) throw notFound('Kunde');
    const [assets, apts, convs, leadList, quoteList] = await Promise.all([
      db.select().from(customerAssets).where(and(eq(customerAssets.tenantId, a.tenantId), eq(customerAssets.customerId, id))).orderBy(asc(customerAssets.createdAt)),
      appointmentsQuery(db, a.tenantId, { customerId: id }),
      conversationListItems(db, a.tenantId, { customerId: id }),
      leadDtos(db, a.tenantId, id),
      quoteDtos(db, a.tenantId, id),
    ]);
    const { tenantId: _t, ...customer } = c;
    return {
      customer,
      assets: assets.map((x) => ({ id: x.id, kind: x.kind, label: x.label, identifier: x.identifier, attributes: x.attributes })),
      appointments: apts.map(appointmentDto),
      conversations: convs,
      leads: leadList,
      quotes: quoteList,
    };
  });

  app.patch('/customers/:id', async (req) => {
    const a = auth(req);
    const { id } = req.params as { id: string };
    const body = parse(customerBody.partial(), req.body);
    const [c] = await db.update(customers).set(body).where(and(eq(customers.tenantId, a.tenantId), eq(customers.id, id))).returning();
    if (!c) throw notFound('Kunde');
    await recordEvent(db, { tenantId: a.tenantId, type: 'customer.updated', actor: userActor(a), summary: `Kunde ${c.name} bearbeitet`, entityType: 'customer', entityId: c.id });
    const { tenantId: _t, ...dto } = c;
    return dto;
  });

  app.post('/customers/:id/assets', async (req, reply) => {
    const a = auth(req);
    const { id } = req.params as { id: string };
    await ensureCustomer(db, a.tenantId, id);
    const body = parse(
      z.object({
        kind: z.string().trim().min(1).max(50),
        label: z.string().trim().min(1).max(200),
        identifier: optionalString,
        attributes: z.record(z.string(), z.string().max(500)).optional(),
      }),
      req.body,
    );
    const [asset] = await db
      .insert(customerAssets)
      .values({ id: newId('ast'), tenantId: a.tenantId, customerId: id, kind: body.kind, label: body.label, identifier: body.identifier, attributes: body.attributes ?? {} })
      .returning();
    return reply.status(201).send({ id: asset.id, kind: asset.kind, label: asset.label, identifier: asset.identifier, attributes: asset.attributes });
  });

  // Leads
  app.get('/leads', async (req) => {
    const a = auth(req);
    const items = await leadDtos(db, a.tenantId);
    const stages = LEAD_STAGES.map((s) => {
      const inStage = items.filter((l) => l.stage === s.key);
      return { ...s, count: inStage.length, valueCents: inStage.reduce((sum, l) => sum + l.valueCents, 0) };
    });
    return { stages, items };
  });

  const leadBody = z.object({
    title: z.string().trim().min(1).max(200),
    valueCents: z.number().int().min(0).max(1_000_000_000).optional(),
    customerId: z.string().optional().nullable(),
    channel: optionalString,
    nextAction: optionalString,
    stage: z.enum(stageKeys).optional(),
  });

  app.post('/leads', async (req, reply) => {
    const a = auth(req);
    const body = parse(leadBody, req.body);
    await ensureCustomer(db, a.tenantId, body.customerId);
    const [lead] = await db
      .insert(leads)
      .values({
        id: newId('led'),
        tenantId: a.tenantId,
        title: body.title,
        valueCents: body.valueCents ?? 0,
        customerId: body.customerId ?? null,
        channel: body.channel,
        nextAction: body.nextAction,
        stage: (body.stage ?? 'new') as 'new',
      })
      .returning();
    await recordEvent(db, { tenantId: a.tenantId, type: 'lead.created', actor: userActor(a), summary: `Lead „${lead.title}“ angelegt`, entityType: 'lead', entityId: lead.id });
    return reply.status(201).send((await leadDtos(db, a.tenantId)).find((l) => l.id === lead.id));
  });

  app.patch('/leads/:id', async (req) => {
    const a = auth(req);
    const { id } = req.params as { id: string };
    const body = parse(leadBody.partial(), req.body);
    await ensureCustomer(db, a.tenantId, body.customerId);
    const [before] = await db.select().from(leads).where(and(eq(leads.tenantId, a.tenantId), eq(leads.id, id)));
    if (!before) throw notFound('Lead');
    const [lead] = await db
      .update(leads)
      .set({ ...body, stage: body.stage as 'new' | undefined, updatedAt: new Date() })
      .where(eq(leads.id, id))
      .returning();
    if (body.stage && body.stage !== before.stage) {
      const label = LEAD_STAGES.find((s) => s.key === body.stage)!.label;
      await recordEvent(db, { tenantId: a.tenantId, type: 'lead.stage_changed', actor: userActor(a), summary: `Lead „${lead.title}“ → ${label}`, entityType: 'lead', entityId: id, data: { from: before.stage, to: body.stage } });
    }
    return (await leadDtos(db, a.tenantId)).find((l) => l.id === id);
  });

  // Quotes
  app.get('/quotes', async (req) => quoteDtos(db, auth(req).tenantId));

  const quoteBody = z.object({
    title: z.string().trim().min(1).max(200),
    customerId: z.string().optional().nullable(),
    leadId: z.string().optional().nullable(),
    items: z.array(quoteItem).max(100).optional(),
    status: z.enum(['draft', 'missing_info', 'sent', 'accepted', 'rejected']).optional(),
    aiNote: optionalString,
  });

  app.post('/quotes', async (req, reply) => {
    const a = auth(req);
    const body = parse(quoteBody, req.body);
    await ensureCustomer(db, a.tenantId, body.customerId);
    const items = body.items ?? [];
    const [q] = await db
      .insert(quotes)
      .values({
        id: newId('quo'),
        tenantId: a.tenantId,
        number: await nextQuoteNumber(db, a.tenantId),
        title: body.title,
        customerId: body.customerId ?? null,
        leadId: body.leadId ?? null,
        status: body.status ?? 'draft',
        items,
        totalCents: quoteTotal(items),
        aiNote: body.aiNote,
      })
      .returning();
    await recordEvent(db, { tenantId: a.tenantId, type: 'quote.created', actor: userActor(a), summary: `Angebot ${q.number} erstellt`, entityType: 'quote', entityId: q.id });
    return reply.status(201).send((await quoteDtos(db, a.tenantId)).find((x) => x.id === q.id));
  });

  app.patch('/quotes/:id', async (req) => {
    const a = auth(req);
    const { id } = req.params as { id: string };
    const body = parse(quoteBody.partial(), req.body);
    await ensureCustomer(db, a.tenantId, body.customerId);
    const [before] = await db.select().from(quotes).where(and(eq(quotes.tenantId, a.tenantId), eq(quotes.id, id)));
    if (!before) throw notFound('Angebot');
    const patch: Partial<typeof quotes.$inferInsert> = { ...body };
    if (body.items) patch.totalCents = quoteTotal(body.items);
    if (body.status === 'sent' && before.status !== 'sent') patch.sentAt = new Date();
    await db.update(quotes).set(patch).where(eq(quotes.id, id));
    if (body.status && body.status !== before.status) {
      const labels = { draft: 'Entwurf', missing_info: 'Infos fehlen', sent: 'versendet', accepted: 'angenommen', rejected: 'abgelehnt' };
      await recordEvent(db, { tenantId: a.tenantId, type: `quote.${body.status}`, actor: userActor(a), summary: `Angebot ${before.number} → ${labels[body.status]}`, entityType: 'quote', entityId: id });
      if (body.status === 'sent') await automationHooks.quoteSent(db, a.tenantId, id);
    }
    return (await quoteDtos(db, a.tenantId)).find((x) => x.id === id);
  });

  // Tasks
  const taskDtos = async (tenantId: string) => {
    const rows = await db
      .select({ task: tasks, staff: staffMembers })
      .from(tasks)
      .leftJoin(staffMembers, eq(staffMembers.id, tasks.assigneeId))
      .where(eq(tasks.tenantId, tenantId))
      .orderBy(asc(tasks.status), asc(tasks.dueDate), desc(tasks.createdAt));
    return rows.map(({ task, staff }) => ({
      id: task.id,
      title: task.title,
      dueDate: task.dueDate,
      priority: task.priority,
      status: task.status,
      source: task.source,
      assignee: nameOf(staff),
      entityType: task.entityType,
      entityId: task.entityId,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
    }));
  };

  app.get('/tasks', async (req) => taskDtos(auth(req).tenantId));

  const taskBody = z.object({
    title: z.string().trim().min(1).max(300),
    assigneeId: z.string().optional().nullable(),
    dueDate: dateString.optional().nullable(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    status: z.enum(['open', 'done']).optional(),
  });

  const ensureStaff = async (tenantId: string, staffId: string | null | undefined) => {
    if (!staffId) return;
    const [s] = await db.select({ id: staffMembers.id }).from(staffMembers).where(and(eq(staffMembers.tenantId, tenantId), eq(staffMembers.id, staffId)));
    if (!s) throw notFound('Mitarbeiter');
  };

  app.post('/tasks', async (req, reply) => {
    const a = auth(req);
    const body = parse(taskBody, req.body);
    await ensureStaff(a.tenantId, body.assigneeId);
    const [t] = await db
      .insert(tasks)
      .values({ id: newId('tsk'), tenantId: a.tenantId, title: body.title, assigneeId: body.assigneeId ?? null, dueDate: body.dueDate ?? null, priority: body.priority ?? 'normal' })
      .returning();
    await recordEvent(db, { tenantId: a.tenantId, type: 'task.created', actor: userActor(a), summary: `Aufgabe „${t.title}“ erstellt`, entityType: 'task', entityId: t.id });
    return reply.status(201).send((await taskDtos(a.tenantId)).find((x) => x.id === t.id));
  });

  app.patch('/tasks/:id', async (req) => {
    const a = auth(req);
    const { id } = req.params as { id: string };
    const body = parse(taskBody.partial(), req.body);
    await ensureStaff(a.tenantId, body.assigneeId);
    const patch: Partial<typeof tasks.$inferInsert> = { ...body };
    if (body.status) patch.completedAt = body.status === 'done' ? new Date() : null;
    const [t] = await db.update(tasks).set(patch).where(and(eq(tasks.tenantId, a.tenantId), eq(tasks.id, id))).returning();
    if (!t) throw notFound('Aufgabe');
    if (body.status === 'done') {
      await recordEvent(db, { tenantId: a.tenantId, type: 'task.completed', actor: userActor(a), summary: `Aufgabe „${t.title}“ erledigt`, entityType: 'task', entityId: id });
    }
    return (await taskDtos(a.tenantId)).find((x) => x.id === id);
  });

  app.get('/staff', async (req) => {
    const a = auth(req);
    const rows = await db.select().from(staffMembers).where(and(eq(staffMembers.tenantId, a.tenantId), eq(staffMembers.active, true))).orderBy(asc(staffMembers.name));
    return rows.map((s) => ({ id: s.id, name: s.name, skills: s.skills }));
  });

}
