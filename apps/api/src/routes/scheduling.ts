import type { FastifyInstance } from 'fastify';
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '../db/client.js';
import { appointments, customers, serviceTypes, staffMembers, tenants } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { recordEvent } from '../lib/events.js';
import { auth, dateString, optionalString, parse, userActor } from '../lib/http.js';
import { addMinutes, spokenDateTime, zonedToUtc } from '../lib/time.js';
import { providersFor } from '../providers/registry.js';
import { automationHooks } from '../services/automations.js';
import { bookSlot, searchAvailability } from '../services/scheduling.js';

export async function appointmentsQuery(db: DbOrTx, tenantId: string, opts: { from?: Date; to?: Date; customerId?: string }) {
  return db
    .select({ apt: appointments, customer: customers, staff: staffMembers, serviceType: serviceTypes })
    .from(appointments)
    .leftJoin(customers, eq(customers.id, appointments.customerId))
    .leftJoin(staffMembers, eq(staffMembers.id, appointments.staffId))
    .leftJoin(serviceTypes, eq(serviceTypes.id, appointments.serviceTypeId))
    .where(
      and(
        eq(appointments.tenantId, tenantId),
        opts.from ? gte(appointments.startsAt, opts.from) : undefined,
        opts.to ? lt(appointments.startsAt, opts.to) : undefined,
        opts.customerId ? eq(appointments.customerId, opts.customerId) : undefined,
      ),
    )
    .orderBy(asc(appointments.startsAt));
}

type AptRow = Awaited<ReturnType<typeof appointmentsQuery>>[number];

export function appointmentDto({ apt, customer, staff, serviceType }: AptRow) {
  return {
    id: apt.id,
    title: apt.title,
    startsAt: apt.startsAt,
    endsAt: apt.endsAt,
    status: apt.status,
    channel: apt.channel,
    location: apt.location,
    notes: apt.notes,
    confirmationCode: apt.confirmationCode,
    customer: customer ? { id: customer.id, name: customer.name } : null,
    staff: staff ? { id: staff.id, name: staff.name } : null,
    serviceType: serviceType ? { id: serviceType.id, code: serviceType.code, name: serviceType.name } : null,
  };
}

export async function appointmentById(db: DbOrTx, tenantId: string, id: string) {
  const rows = await db
    .select({ apt: appointments, customer: customers, staff: staffMembers, serviceType: serviceTypes })
    .from(appointments)
    .leftJoin(customers, eq(customers.id, appointments.customerId))
    .leftJoin(staffMembers, eq(staffMembers.id, appointments.staffId))
    .leftJoin(serviceTypes, eq(serviceTypes.id, appointments.serviceTypeId))
    .where(and(eq(appointments.tenantId, tenantId), eq(appointments.id, id)));
  if (!rows[0]) throw notFound('Termin');
  return appointmentDto(rows[0]);
}

const STATUS_LABEL = { booked: 'gebucht', confirmed: 'bestätigt', completed: 'abgeschlossen', cancelled: 'storniert', no_show: 'nicht erschienen' } as const;

export async function schedulingRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/appointments', async (req) => {
    const a = auth(req);
    const q = parse(z.object({ from: dateString.optional(), to: dateString.optional() }), req.query);
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, a.tenantId));
    const from = q.from ? zonedToUtc(q.from, '00:00', tenant.timezone) : undefined;
    const to = q.to ? addMinutes(zonedToUtc(q.to, '00:00', tenant.timezone), 1440) : undefined;
    return (await appointmentsQuery(db, a.tenantId, { from, to })).map(appointmentDto);
  });

  app.get('/service-types', async (req) => {
    const a = auth(req);
    const rows = await db.select().from(serviceTypes).where(and(eq(serviceTypes.tenantId, a.tenantId), eq(serviceTypes.active, true))).orderBy(asc(serviceTypes.name));
    return rows.map((s) => ({ id: s.id, code: s.code, name: s.name, durationMin: s.durationMin, bufferMin: s.bufferMin }));
  });

  app.get('/availability', async (req) => {
    const a = auth(req);
    const q = parse(z.object({ serviceCode: z.string().min(1), date: dateString }), req.query);
    const providers = await providersFor(db, a.tenantId);
    const slots = await searchAvailability(db, { tenantId: a.tenantId, serviceCode: q.serviceCode, date: q.date, calendar: providers.calendar });
    return { slots: slots.map((s) => ({ slotId: s.slotId, startsAt: s.startsAt, endsAt: s.endsAt, staffName: s.staffName })) };
  });

  app.post('/appointments', async (req, reply) => {
    const a = auth(req);
    const body = parse(
      z.object({
        serviceCode: z.string().min(1),
        slotId: z.string().min(1),
        customerId: z.string().optional().nullable(),
        title: optionalString,
        location: optionalString,
        notes: optionalString,
        channel: optionalString,
      }),
      req.body,
    );
    if (body.customerId) {
      const [c] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.tenantId, a.tenantId), eq(customers.id, body.customerId)));
      if (!c) throw notFound('Kunde');
    }
    const providers = await providersFor(db, a.tenantId);
    const result = await bookSlot(db, {
      tenantId: a.tenantId,
      slotId: body.slotId,
      customerId: body.customerId,
      title: body.title ?? undefined,
      location: body.location,
      notes: body.notes,
      channel: body.channel ?? 'manuell',
      calendar: providers.calendar,
    });
    const apt = result.appointment;
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, a.tenantId));
    await recordEvent(db, {
      tenantId: a.tenantId,
      type: 'appointment.created',
      actor: userActor(a),
      summary: `Termin „${apt.title}“ am ${spokenDateTime(apt.startsAt, tenant.timezone)} eingetragen`,
      entityType: 'appointment',
      entityId: apt.id,
    });
    await automationHooks.appointmentBooked(db, a.tenantId, apt.id, apt.startsAt);
    return reply.status(201).send(await appointmentById(db, a.tenantId, apt.id));
  });

  app.patch('/appointments/:id', async (req) => {
    const a = auth(req);
    const { id } = req.params as { id: string };
    const body = parse(
      z.object({ status: z.enum(['booked', 'confirmed', 'completed', 'cancelled', 'no_show']).optional(), notes: optionalString.optional(), location: optionalString.optional() }),
      req.body,
    );
    const [before] = await db.select().from(appointments).where(and(eq(appointments.tenantId, a.tenantId), eq(appointments.id, id)));
    if (!before) throw notFound('Termin');
    await db.update(appointments).set(body).where(eq(appointments.id, id));
    if (body.status && body.status !== before.status) {
      await recordEvent(db, {
        tenantId: a.tenantId,
        type: `appointment.${body.status}`,
        actor: userActor(a),
        summary: `Termin „${before.title}“ ${STATUS_LABEL[body.status]}`,
        entityType: 'appointment',
        entityId: id,
      });
      if (body.status === 'cancelled') {
        await automationHooks.appointmentCancelled(db, a.tenantId, id);
        if (before.externalEventId && before.staffId) {
          const providers = await providersFor(db, a.tenantId);
          await providers.calendar.cancelEvent({ calendarId: before.staffId, eventId: before.externalEventId });
        }
      }
      if (body.status === 'completed') await automationHooks.appointmentCompleted(db, a.tenantId, id);
    }
    return appointmentById(db, a.tenantId, id);
  });
}
