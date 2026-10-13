import { and, eq, gt, lt, ne, sql } from 'drizzle-orm';
import type { Db, DbOrTx, Tx } from '../db/client.js';
import { appointmentHolds, appointments, resources, serviceTypes, staffMembers, tenants } from '../db/schema.js';
import { conflict, notFound, badRequest } from '../lib/errors.js';
import { newId, randomCode } from '../lib/ids.js';
import { addMinutes, isoWeekday, localDate, zonedToUtc } from '../lib/time.js';
import type { CalendarProvider } from '../providers/types.js';

// BusinessPilot Scheduling Core. The external calendar only answers "busy or not";
// durations, buffers, skills, resources (e.g. lifts) and daily limits live here.

export type Slot = {
  slotId: string;
  startsAt: Date;
  endsAt: Date;
  staffId: string;
  staffName: string;
  resourceId: string | null;
};

type Interval = { start: number; end: number };

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/** Minimum notice before a slot can be booked. */
const LEAD_TIME_MIN = 60;

export function encodeSlotId(serviceCode: string, start: Date, staffId: string, resourceId: string | null) {
  return Buffer.from(JSON.stringify([serviceCode, start.toISOString(), staffId, resourceId])).toString('base64url');
}

export function decodeSlotId(slotId: string) {
  try {
    const [serviceCode, start, staffId, resourceId] = JSON.parse(Buffer.from(slotId, 'base64url').toString());
    if (typeof serviceCode !== 'string' || typeof staffId !== 'string') throw new Error();
    return { serviceCode, start: new Date(start), staffId, resourceId: (resourceId as string | null) ?? null };
  } catch {
    throw badRequest('Ungültiger Termin-Slot.', 'invalid_slot');
  }
}

export async function findServiceType(db: DbOrTx, tenantId: string, code: string) {
  const [st] = await db
    .select()
    .from(serviceTypes)
    .where(and(eq(serviceTypes.tenantId, tenantId), eq(serviceTypes.code, code), eq(serviceTypes.active, true)));
  if (!st) throw notFound('Leistung');
  return st;
}

export async function searchAvailability(
  db: DbOrTx,
  opts: { tenantId: string; serviceCode: string; date: string; calendar: CalendarProvider; now?: Date; limit?: number },
): Promise<Slot[]> {
  const now = opts.now ?? new Date();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, opts.tenantId));
  if (!tenant) throw notFound('Betrieb');
  const st = await findServiceType(db, opts.tenantId, opts.serviceCode);

  const hours = tenant.businessHours.find((h) => h.day === isoWeekday(opts.date));
  if (!hours) return [];
  const dayOpen = zonedToUtc(opts.date, hours.open, tenant.timezone);
  const dayClose = zonedToUtc(opts.date, hours.close, tenant.timezone);

  const staff = (await db.select().from(staffMembers).where(and(eq(staffMembers.tenantId, opts.tenantId), eq(staffMembers.active, true)))).filter(
    (s) => !st.requiredSkill || s.skills.includes(st.requiredSkill),
  );
  if (staff.length === 0) return [];

  const resList = st.resourceKind
    ? await db
        .select()
        .from(resources)
        .where(and(eq(resources.tenantId, opts.tenantId), eq(resources.kind, st.resourceKind), eq(resources.active, true)))
    : [];
  if (st.resourceKind && resList.length === 0) return [];

  const dayAppointments = await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.tenantId, opts.tenantId),
        ne(appointments.status, 'cancelled'),
        lt(appointments.startsAt, dayClose),
        gt(appointments.endsAt, addMinutes(dayOpen, -240)),
      ),
    );
  const holds = await db
    .select()
    .from(appointmentHolds)
    .where(and(eq(appointmentHolds.tenantId, opts.tenantId), gt(appointmentHolds.expiresAt, now), lt(appointmentHolds.startsAt, dayClose)));

  if (st.maxPerDay != null) {
    const sameService = dayAppointments.filter((a) => a.serviceTypeId === st.id && localDate(a.startsAt, tenant.timezone) === opts.date);
    if (sameService.length >= st.maxPerDay) return [];
  }

  const busy = (a: { startsAt: Date; endsAt: Date; bufferMin?: number }): Interval => ({
    start: a.startsAt.getTime(),
    end: a.endsAt.getTime() + (a.bufferMin ?? 0) * 60000,
  });
  const staffBusy = new Map<string, Interval[]>(staff.map((s) => [s.id, []]));
  const resourceBusy = new Map<string, Interval[]>(resList.map((r) => [r.id, []]));
  for (const a of dayAppointments) {
    if (a.staffId) staffBusy.get(a.staffId)?.push(busy(a));
    if (a.resourceId) resourceBusy.get(a.resourceId)?.push(busy(a));
  }
  for (const h of holds) {
    if (h.staffId) staffBusy.get(h.staffId)?.push(busy(h));
    if (h.resourceId) resourceBusy.get(h.resourceId)?.push(busy(h));
  }
  const external = await opts.calendar.freeBusy({ calendarIds: staff.map((s) => s.id), from: dayOpen, to: dayClose });
  for (const [staffId, list] of Object.entries(external)) {
    for (const b of list) staffBusy.get(staffId)?.push({ start: b.start.getTime(), end: b.end.getTime() });
  }

  const slots: Slot[] = [];
  const earliest = now.getTime() + LEAD_TIME_MIN * 60000;
  for (let t = dayOpen.getTime(); t + st.durationMin * 60000 <= dayClose.getTime(); t += tenant.slotStepMin * 60000) {
    if (t < earliest) continue;
    const need: Interval = { start: t, end: t + (st.durationMin + st.bufferMin) * 60000 };
    const freeStaff = staff.find((s) => !staffBusy.get(s.id)!.some((b) => overlaps(b, need)));
    if (!freeStaff) continue;
    let resourceId: string | null = null;
    if (st.resourceKind) {
      const free = resList.find((r) => !resourceBusy.get(r.id)!.some((b) => overlaps(b, need)));
      if (!free) continue;
      resourceId = free.id;
    }
    const start = new Date(t);
    slots.push({
      slotId: encodeSlotId(st.code, start, freeStaff.id, resourceId),
      startsAt: start,
      endsAt: addMinutes(start, st.durationMin),
      staffId: freeStaff.id,
      staffName: freeStaff.name,
      resourceId,
    });
    if (opts.limit && slots.length >= opts.limit) break;
  }
  return slots;
}

export type BookInput = {
  tenantId: string;
  slotId: string;
  customerId?: string | null;
  assetId?: string | null;
  title?: string;
  location?: string | null;
  notes?: string | null;
  channel?: string | null;
  idempotencyKey?: string | null;
  calendar: CalendarProvider;
};

/**
 * Books a slot. A per-tenant advisory lock serialises bookings, and the slot is re-validated
 * inside the lock, so two parallel callers can never get the same slot.
 */
export async function bookSlot(db: Db, input: BookInput) {
  const slot = decodeSlotId(input.slotId);
  return db.transaction(async (tx: Tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.tenantId}))`);

    if (input.idempotencyKey) {
      const [existing] = await tx
        .select()
        .from(appointments)
        .where(and(eq(appointments.tenantId, input.tenantId), eq(appointments.idempotencyKey, input.idempotencyKey)));
      if (existing) return { appointment: existing, created: false };
    }

    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, input.tenantId));
    const st = await findServiceType(tx, input.tenantId, slot.serviceCode);
    const date = localDate(slot.start, tenant.timezone);
    const available = await searchAvailability(tx, { tenantId: input.tenantId, serviceCode: st.code, date, calendar: input.calendar });
    const match =
      available.find((s) => s.startsAt.getTime() === slot.start.getTime() && s.staffId === slot.staffId && s.resourceId === slot.resourceId) ??
      available.find((s) => s.startsAt.getTime() === slot.start.getTime());
    if (!match) throw conflict('slot_taken', 'Dieser Termin ist leider nicht mehr frei. Bitte wählen Sie einen anderen.');

    const row = {
      id: newId('apt'),
      tenantId: input.tenantId,
      customerId: input.customerId ?? null,
      assetId: input.assetId ?? null,
      serviceTypeId: st.id,
      staffId: match.staffId,
      resourceId: match.resourceId,
      title: input.title?.trim() || st.name,
      startsAt: match.startsAt,
      endsAt: match.endsAt,
      bufferMin: st.bufferMin,
      status: 'booked' as const,
      channel: input.channel ?? null,
      location: input.location ?? null,
      notes: input.notes ?? null,
      confirmationCode: `BP-${randomCode(5)}`,
      idempotencyKey: input.idempotencyKey ?? null,
      externalEventId: null as string | null,
    };
    const ext = await input.calendar.createEvent({ calendarId: match.staffId, title: row.title, start: row.startsAt, end: row.endsAt });
    row.externalEventId = ext.eventId;
    const [created] = await tx.insert(appointments).values(row).returning();
    return { appointment: created, created: true, serviceType: st, staffName: match.staffName };
  });
}
