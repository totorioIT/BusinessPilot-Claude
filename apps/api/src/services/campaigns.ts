import { and, eq, exists, gte, isNotNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { appointments, type CampaignAudience, communicationConsents, customers } from '../db/schema.js';

/**
 * Customers an offer may go to: an email address and a granted marketing consent for email,
 * optionally narrowed to customers who had a certain service or visited recently.
 */
export async function campaignAudience(db: DbOrTx, tenantId: string, audience: CampaignAudience) {
  const visitedSince = audience.visitedWithinDays ? new Date(Date.now() - audience.visitedWithinDays * 86400000) : null;
  const needsVisit = Boolean(audience.serviceTypeId || visitedSince);
  return db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(
      and(
        eq(customers.tenantId, tenantId),
        isNotNull(customers.email),
        sql`${customers.email} <> ''`,
        exists(
          db
            .select({ one: sql`1` })
            .from(communicationConsents)
            .where(
              and(
                eq(communicationConsents.tenantId, tenantId),
                eq(communicationConsents.customerId, customers.id),
                eq(communicationConsents.channel, 'email'),
                eq(communicationConsents.purpose, 'marketing'),
                eq(communicationConsents.status, 'granted'),
              ),
            ),
        ),
        needsVisit
          ? exists(
              db
                .select({ one: sql`1` })
                .from(appointments)
                .where(
                  and(
                    eq(appointments.tenantId, tenantId),
                    eq(appointments.customerId, customers.id),
                    eq(appointments.status, 'completed'),
                    audience.serviceTypeId ? eq(appointments.serviceTypeId, audience.serviceTypeId) : undefined,
                    visitedSince ? gte(appointments.startsAt, visitedSince) : undefined,
                  ),
                ),
            )
          : undefined,
      ),
    );
}
