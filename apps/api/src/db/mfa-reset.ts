import { eq } from 'drizzle-orm';
import { createDb } from './client.js';
import { sessions, users } from './schema.js';

// Emergency access on the server when a platform admin has lost both the phone and the
// recovery codes: switches two-factor login off for one account and ends its sessions.
// On the server:  docker compose exec app node apps/api/dist/db/mfa-reset.js name@example.de
// At the next login the account has to set up two-factor login again.

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Bitte die E-Mail-Adresse angeben: node apps/api/dist/db/mfa-reset.js name@example.de');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL fehlt.');
  process.exit(1);
}
const { db, pool } = createDb(url);
const [user] = await db
  .update(users)
  .set({ mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryCodes: [] })
  .where(eq(users.email, email))
  .returning({ id: users.id, name: users.name });
if (!user) {
  console.error(`Kein Konto mit ${email} gefunden.`);
} else {
  await db.delete(sessions).where(eq(sessions.userId, user.id));
  console.log(`Zwei-Faktor-Anmeldung für ${user.name} zurückgesetzt. Beim nächsten Login wird sie neu eingerichtet.`);
}
await pool.end();
