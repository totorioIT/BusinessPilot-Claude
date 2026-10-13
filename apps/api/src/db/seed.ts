import { eq, inArray } from 'drizzle-orm';
import { env } from '../env.js';
import { hashPassword, sha256 } from '../lib/crypto.js';
import { newId } from '../lib/ids.js';
import { addMinutes, localDate, zonedToUtc } from '../lib/time.js';
import { AUTOMATION_TEMPLATES } from '../services/automation-templates.js';
import { createDb, type Db } from './client.js';
import * as s from './schema.js';

// Demo data for a car workshop (the blueprint's first vertical). Dates are relative to "now"
// so the dashboard always looks current. Re-running replaces the demo tenants.

export const DEMO_EMAIL = 'demo@businesspilot.de';
export const DEMO_PASSWORD = 'Demo2026!';
export const DEMO_FONIO_KEY = 'bp_test_fonio_demo_key';
const TZ = 'Europe/Berlin';

const daysAgo = (d: number, time = '10:00') => zonedToUtc(localDate(new Date(Date.now() - d * 86400000), TZ), time, TZ);
const daysAhead = (d: number, time: string) => {
  // Skip weekends for future appointments.
  let date = new Date(Date.now() + d * 86400000);
  while ([0, 6].includes(new Date(localDate(date, TZ) + 'T12:00:00Z').getUTCDay())) date = new Date(date.getTime() + 86400000);
  return zonedToUtc(localDate(date, TZ), time, TZ);
};

export async function seed(db: Db) {
  const old = await db.select({ id: s.tenants.id }).from(s.tenants).where(inArray(s.tenants.name, ['Kfz-Werkstatt Muster GmbH', 'Beauty Lounge Lena']));
  if (old.length) await db.delete(s.tenants).where(inArray(s.tenants.id, old.map((t) => t.id)));
  await db.delete(s.users).where(inArray(s.users.email, [DEMO_EMAIL, 'lena@example.de']));

  const tenantId = newId('wrk');
  await db.insert(s.tenants).values({
    id: tenantId,
    name: 'Kfz-Werkstatt Muster GmbH',
    industry: 'Kfz-Werkstatt',
    address: 'Industriestraße 12, 80939 München',
    phone: '+49 89 1234567',
    googleReviewUrl: 'https://g.page/r/kfz-werkstatt-muster/review',
    plan: 'business',
    status: 'active',
    aiSettings: {
      name: 'Anna',
      language: 'Deutsch',
      tone: 'Freundlich',
      greeting: 'Wie kann ich Ihnen helfen?',
      autonomy: 'semi',
      escalation: 'Bei Notfällen, Beschwerden oder Preisverhandlungen an einen Mitarbeiter übergeben.',
    },
    businessHours: [1, 2, 3, 4, 5].map((day) => ({ day, open: '07:30', close: '17:00' })).concat([{ day: 6, open: '08:00', close: '12:00' }]),
  });

  const userId = newId('usr');
  await db.insert(s.users).values({ id: userId, email: DEMO_EMAIL, name: 'Philipp Wiedamann', passwordHash: await hashPassword(DEMO_PASSWORD), isPlatformAdmin: true });
  await db.insert(s.memberships).values({ userId, tenantId, role: 'owner' });

  const staff = {
    thomas: newId('stf'),
    sabine: newId('stf'),
    lukas: newId('stf'),
  };
  await db.insert(s.staffMembers).values([
    { id: staff.thomas, tenantId, name: 'Thomas Klein', skills: ['reifen', 'inspektion', 'bremsen'] },
    { id: staff.sabine, tenantId, name: 'Sabine Berger', skills: ['reifen', 'inspektion'] },
    { id: staff.lukas, tenantId, name: 'Lukas Wagner', skills: ['hu', 'diagnose', 'bremsen'] },
  ]);
  const lift1 = newId('res');
  const lift2 = newId('res');
  await db.insert(s.resources).values([
    { id: lift1, tenantId, name: 'Hebebühne 1', kind: 'lift' },
    { id: lift2, tenantId, name: 'Hebebühne 2', kind: 'lift' },
  ]);
  const st = {
    reifen: newId('srv'),
    inspektion: newId('srv'),
    hu: newId('srv'),
    bremsen: newId('srv'),
    diagnose: newId('srv'),
  };
  await db.insert(s.serviceTypes).values([
    { id: st.reifen, tenantId, code: 'reifenwechsel', name: 'Reifenwechsel', durationMin: 45, bufferMin: 10, resourceKind: 'lift', requiredSkill: 'reifen', maxPerDay: 12 },
    { id: st.inspektion, tenantId, code: 'inspektion', name: 'Inspektion', durationMin: 120, bufferMin: 15, resourceKind: 'lift', requiredSkill: 'inspektion' },
    { id: st.hu, tenantId, code: 'hu', name: 'HU/AU', durationMin: 60, bufferMin: 10, resourceKind: 'lift', requiredSkill: 'hu' },
    { id: st.bremsen, tenantId, code: 'bremsen', name: 'Bremsenservice', durationMin: 90, bufferMin: 15, resourceKind: 'lift', requiredSkill: 'bremsen' },
    { id: st.diagnose, tenantId, code: 'diagnose', name: 'Fehlerdiagnose', durationMin: 30, bufferMin: 0, requiredSkill: 'diagnose' },
  ]);

  const people = [
    { key: 'mueller', name: 'Max Müller', company: null, phone: '+49 170 1234567', email: 'max.mueller@example.de', car: ['VW Golf VII', 'M-MM 1234', { Baujahr: '2017', Kilometer: '98.400' }] },
    { key: 'schmidt', name: 'Julia Schmidt', company: 'Schmidt Immobilien', phone: '+49 171 9876543', email: 'j.schmidt@example.de', car: ['BMW 320d Touring', 'M-JS 5521', { Baujahr: '2020' }] },
    { key: 'wagner', name: 'Peter Wagner', company: null, phone: '+49 160 5556677', email: 'p.wagner@example.de', car: ['Skoda Octavia Combi', 'FS-PW 88', { Baujahr: '2019' }] },
    { key: 'bauer', name: 'Andrea Bauer', company: 'Bauer & Co KG', phone: '+49 175 3334455', email: 'a.bauer@example.de', car: ['Mercedes Vito', 'M-BC 2045', { Baujahr: '2021', Hinweis: 'Firmenfahrzeug, 3 weitere im Fuhrpark' }] },
    { key: 'hoffmann', name: 'Stefan Hoffmann', company: null, phone: '+49 152 7778899', email: 's.hoffmann@example.de', car: ['Audi A4 Avant', 'DAH-SH 404', { Baujahr: '2015' }] },
    { key: 'yilmaz', name: 'Aylin Yılmaz', company: null, phone: '+49 176 2223344', email: 'a.yilmaz@example.de', car: ['Toyota Yaris Hybrid', 'M-AY 77', { Baujahr: '2022' }] },
  ] as const;
  const cus: Record<string, string> = {};
  const car: Record<string, string> = {};
  let n = 0;
  for (const p of people) {
    cus[p.key] = newId('cus');
    car[p.key] = newId('ast');
    await db.insert(s.customers).values({
      id: cus[p.key],
      tenantId,
      number: `K-${(10421 + n++).toString()}`,
      name: p.name,
      company: p.company,
      phone: p.phone,
      email: p.email,
      createdAt: daysAgo(60 + n * 7),
    });
    await db.insert(s.customerAssets).values({ id: car[p.key], tenantId, customerId: cus[p.key], kind: 'vehicle', label: p.car[0], identifier: p.car[1], attributes: { ...p.car[2] } });
    await db.insert(s.communicationConsents).values({
      id: newId('con'),
      tenantId,
      customerId: cus[p.key],
      channel: 'whatsapp',
      purpose: 'service',
      status: 'granted',
      source: 'Werkstattauftrag',
      grantedAt: daysAgo(60),
    });
  }

  const events: (typeof s.events.$inferInsert)[] = [];
  const ev = (type: string, summary: string, at: Date, actorType: 'ai' | 'user' | 'system' = 'ai', entity?: [string, string]) =>
    events.push({
      id: newId('evt'),
      tenantId,
      type,
      actorType,
      actorName: actorType === 'user' ? 'Philipp Wiedamann' : null,
      summary,
      entityType: entity?.[0] ?? null,
      entityId: entity?.[1] ?? null,
      createdAt: at,
    });

  // Calls with transcripts
  const call = async (
    key: string | null,
    at: Date,
    o: { intent: string; summary: string; status: 'closed' | 'missed' | 'needs_staff'; sentiment?: string; actions: string[]; duration: number; transcript: [string, string][] },
  ) => {
    const convId = newId('conv');
    const p = key ? people.find((x) => x.key === key)! : null;
    await db.insert(s.conversations).values({
      id: convId,
      tenantId,
      customerId: key ? cus[key] : null,
      channel: 'phone',
      status: o.status,
      contactName: p?.name ?? null,
      contactAddress: p?.phone ?? '+49 151 9988776',
      subject: o.intent,
      summary: o.summary,
      sentiment: o.sentiment ?? null,
      lastMessageAt: addMinutes(at, Math.ceil(o.duration / 60)),
      createdAt: at,
    });
    await db.insert(s.calls).values({
      id: newId('call'),
      tenantId,
      conversationId: convId,
      fromNumber: p?.phone ?? '+49 151 9988776',
      toNumber: '+49 89 1234567',
      startedAt: at,
      durationSec: o.duration,
      outcome: o.status === 'missed' ? 'missed' : 'completed',
      intent: o.intent,
      summary: o.summary,
      transcript: o.transcript.map(([who, text]) => ({ speaker: who === 'A' ? 'ai' : 'customer', text })),
      actions: o.actions,
    });
    if (o.status === 'missed') ev('call.missed', `Verpasster Anruf von ${p?.phone ?? '+49 151 9988776'}`, at, 'system', ['conversation', convId]);
    else ev('call.handled', `Anna hat einen Anruf bearbeitet: ${o.intent}`, addMinutes(at, 4), 'ai', ['conversation', convId]);
    return convId;
  };

  await call('mueller', daysAgo(2, '08:12'), {
    intent: 'Reifenwechsel',
    summary: 'Max Müller möchte Sommerreifen auf Winterreifen wechseln lassen. Die Räder sind bei uns eingelagert. Anna hat einen Termin gebucht und eine WhatsApp-Bestätigung gesendet.',
    status: 'closed',
    sentiment: 'Positiv',
    actions: ['Kontakt erkannt', 'Termin gebucht', 'WhatsApp-Bestätigung'],
    duration: 164,
    transcript: [
      ['A', 'Hallo, ich bin Anna, die KI-Assistentin der Kfz-Werkstatt Muster. Wie kann ich Ihnen helfen?'],
      ['K', 'Hallo, ich bräuchte einen Termin für den Reifenwechsel.'],
      ['A', 'Gern, Herr Müller. Geht es um Ihren Golf mit dem Kennzeichen M-MM 1234?'],
      ['K', 'Ja, genau.'],
      ['A', 'Ihre Winterräder sind bei uns eingelagert. Am Donnerstag wäre um 9:00 Uhr oder um 14:30 Uhr etwas frei. Was passt Ihnen besser?'],
      ['K', '14:30 Uhr passt gut.'],
      ['A', 'Der Termin am Donnerstag um 14:30 Uhr ist verbindlich gebucht. Sie bekommen gleich eine Bestätigung per WhatsApp.'],
    ],
  });
  await call('wagner', daysAgo(5, '16:40'), {
    intent: 'Bremsen quietschen',
    summary: 'Peter Wagner meldet quietschende Bremsen vorne. Anna hat eine Anfrage angelegt; das Team erstellt einen Kostenvoranschlag.',
    status: 'closed',
    sentiment: 'Neutral',
    actions: ['Kontakt erkannt', 'Anfrage angelegt'],
    duration: 201,
    transcript: [
      ['A', 'Hallo, ich bin Anna, die KI-Assistentin der Kfz-Werkstatt Muster. Wie kann ich Ihnen helfen?'],
      ['K', 'Meine Bremsen vorne quietschen seit ein paar Tagen. Was kostet das ungefähr?'],
      ['A', 'Das kann ich Ihnen am Telefon nicht verbindlich sagen, weil es vom Verschleiß abhängt. Ich lege eine Anfrage an, und ein Kollege meldet sich mit einem Kostenvoranschlag.'],
      ['K', 'Okay, danke.'],
    ],
  });
  await call('bauer', daysAgo(9, '11:05'), {
    intent: 'Fuhrpark-Wartung',
    summary: 'Andrea Bauer fragt nach einem Wartungspaket für vier Firmenfahrzeuge. An Thomas Klein für ein Angebot übergeben.',
    status: 'closed',
    sentiment: 'Positiv',
    actions: ['Kontakt erkannt', 'An Mitarbeiter übergeben'],
    duration: 245,
    transcript: [
      ['A', 'Hallo, ich bin Anna, die KI-Assistentin der Kfz-Werkstatt Muster. Wie kann ich Ihnen helfen?'],
      ['K', 'Wir haben vier Transporter und suchen eine Werkstatt für die regelmäßige Wartung.'],
      ['A', 'Sehr gern. Ich gebe das an Herrn Klein weiter, er erstellt Ihnen ein Angebot für den Fuhrpark.'],
    ],
  });
  const missedConv = await call(null, daysAgo(1, '12:47'), {
    intent: 'Verpasster Anruf',
    summary: 'Verpasster Anruf außerhalb der Erreichbarkeit. Anna hat automatisch eine WhatsApp gesendet.',
    status: 'missed',
    actions: ['WhatsApp gesendet', 'Rückruf-Aufgabe'],
    duration: 0,
    transcript: [],
  });

  // WhatsApp chats
  const chat = async (key: string, status: 's' | 'n' | 'a', at: Date, lines: [string, string, number][], unread = 0) => {
    const convId = newId('conv');
    const p = people.find((x) => x.key === key)!;
    const last = lines[lines.length - 1];
    await db.insert(s.conversations).values({
      id: convId,
      tenantId,
      customerId: cus[key],
      channel: 'whatsapp',
      status: status === 's' ? 'closed' : status === 'n' ? 'needs_staff' : 'ai_handling',
      contactName: p.name,
      contactAddress: p.phone,
      unreadCount: unread,
      lastMessageAt: addMinutes(at, last[2]),
      createdAt: at,
    });
    for (const [who, text, min] of lines) {
      await db.insert(s.messages).values({
        id: newId('msg'),
        tenantId,
        conversationId: convId,
        direction: who === 'K' ? 'inbound' : 'outbound',
        author: who === 'K' ? 'customer' : who === 'A' ? 'ai' : 'staff',
        authorName: who === 'M' ? 'Thomas Klein' : null,
        text,
        deliveryStatus: who === 'K' ? null : 'read',
        createdAt: addMinutes(at, min),
      });
      if (who === 'A') ev('message.ai_replied', `Anna hat ${p.name} per WhatsApp geantwortet`, addMinutes(at, min), 'ai', ['conversation', convId]);
    }
    return convId;
  };
  await chat('hoffmann', 'n', daysAgo(0, '07:55'), [
    ['K', 'Hallo, meine Motorkontrollleuchte ist an. Kann ich noch fahren?', 0],
    ['A', 'Guten Morgen Herr Hoffmann! Leuchtet die Lampe dauerhaft gelb oder blinkt sie?', 1],
    ['K', 'Sie blinkt manchmal.', 6],
    ['A', 'Bei blinkender Leuchte sollten Sie vorsichtig fahren und das Auto bald prüfen lassen. Ich gebe Sie an einen Kollegen weiter, der Ihnen gleich einen Termin zur Fehlerdiagnose anbietet.', 7],
  ], 1);
  await chat('schmidt', 'a', daysAgo(1, '18:20'), [
    ['K', 'Habt ihr nächste Woche Zeit für eine Inspektion? Am liebsten vormittags.', 0],
    ['A', 'Gern! Für die Inspektion Ihres BMW 320d hätte ich Dienstag um 8:00 Uhr oder Mittwoch um 9:30 Uhr frei. Was passt Ihnen?', 1],
  ]);
  await chat('mueller', 's', daysAgo(2, '08:20'), [
    ['A', 'Ihr Termin: Reifenwechsel am Donnerstag um 14:30 Uhr. Bestätigungscode BP-7Q2KD. Bis dann!', 0],
    ['K', 'Perfekt, danke!', 12],
  ]);
  await chat('yilmaz', 's', daysAgo(12, '10:00'), [
    ['K', 'Wie lange habt ihr samstags offen?', 0],
    ['A', 'Samstags sind wir von 8:00 bis 12:00 Uhr für Sie da.', 1],
    ['K', 'Super, danke.', 3],
  ]);
  void missedConv;

  // Appointments
  const apt = async (key: string, service: keyof typeof st, start: Date, durationMin: number, status: 'booked' | 'confirmed' | 'completed', staffId: string, liftId: string | null, channel: string, title: string) => {
    const id = newId('apt');
    await db.insert(s.appointments).values({
      id,
      tenantId,
      customerId: cus[key],
      assetId: car[key],
      serviceTypeId: st[service],
      staffId,
      resourceId: liftId,
      title,
      startsAt: start,
      endsAt: addMinutes(start, durationMin),
      status,
      channel,
      location: 'Werkstatt',
      confirmationCode: `BP-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      createdAt: start < new Date() ? addMinutes(start, -4320) : daysAgo(2),
    });
    return id;
  };
  const doneBauer = await apt('bauer', 'inspektion', daysAgo(6, '08:00'), 120, 'completed', staff.thomas, lift1, 'Telefon', 'Inspektion Mercedes Vito');
  const doneYilmaz = await apt('yilmaz', 'reifen', daysAgo(10, '09:00'), 45, 'completed', staff.sabine, lift2, 'WhatsApp', 'Reifenwechsel Toyota Yaris');
  const doneSchmidt = await apt('schmidt', 'hu', daysAgo(20, '10:00'), 60, 'completed', staff.lukas, lift1, 'Telefon', 'HU/AU BMW 320d');
  ev('appointment.booked', 'Anna hat „Reifenwechsel Toyota Yaris“ gebucht', daysAgo(13, '10:02'));
  ev('appointment.booked', 'Anna hat „HU/AU BMW 320d“ gebucht', daysAgo(23, '15:10'));
  const muellerApt = await apt('mueller', 'reifen', daysAhead(2, '14:30'), 45, 'confirmed', staff.sabine, lift2, 'Telefon', 'Reifenwechsel VW Golf');
  ev('appointment.booked', 'Anna hat „Reifenwechsel VW Golf“ gebucht', daysAgo(2, '08:15'), 'ai', ['appointment', muellerApt]);
  await apt('wagner', 'bremsen', daysAhead(4, '08:00'), 90, 'booked', staff.thomas, lift1, 'manuell', 'Bremsen vorne prüfen');
  await apt('bauer', 'inspektion', daysAhead(7, '07:30'), 120, 'booked', staff.thomas, lift2, 'Telefon', 'Inspektion Fuhrpark Fahrzeug 2');

  // Reviews: sent to every completed customer, no satisfaction filter
  for (const [key, aptId, d] of [['bauer', doneBauer, 6], ['yilmaz', doneYilmaz, 10], ['schmidt', doneSchmidt, 20]] as const) {
    await db.insert(s.reviewRequests).values({
      id: newId('rr'),
      tenantId,
      customerId: cus[key],
      appointmentId: aptId,
      channel: 'whatsapp',
      status: key === 'yilmaz' ? 'clicked' : 'sent',
      sentAt: daysAgo(d, '14:00'),
      clickedAt: key === 'yilmaz' ? daysAgo(d, '15:12') : null,
    });
    ev('review.requested', `Bewertungsanfrage an ${people.find((p) => p.key === key)!.name} gesendet`, daysAgo(d, '14:00'));
  }

  // Leads and quotes with matching values
  const lead = async (key: string, title: string, valueCents: number, stage: typeof s.leads.$inferInsert.stage, nextAction: string | null, channel: string, d: number) => {
    const id = newId('led');
    await db.insert(s.leads).values({ id, tenantId, customerId: cus[key], title, valueCents, stage, nextAction, channel, createdAt: daysAgo(d), updatedAt: daysAgo(Math.max(0, d - 2)) });
    ev('lead.created', `Neue Anfrage: ${title}`, daysAgo(d), 'ai', ['lead', id]);
    return id;
  };
  const leadHoffmann = await lead('hoffmann', 'Fehlerdiagnose Motorkontrollleuchte', 0, 'new', 'Diagnosetermin anbieten', 'WhatsApp', 0);
  const leadWagner = await lead('wagner', 'Bremsen vorne erneuern', 38900, 'quote_in_progress', 'Kostenvoranschlag erstellen und senden', 'Telefon', 5);
  const leadBauer = await lead('bauer', 'Fuhrpark-Wartung 4 Transporter', 186000, 'quote_sent', 'Nachfassen, Angebot seit 4 Tagen offen', 'Telefon', 9);
  const leadSchmidt = await lead('schmidt', 'Inspektion BMW 320d', 42000, 'appointment', 'Terminbestätigung abwarten', 'WhatsApp', 1);
  await lead('mueller', 'Reifenwechsel mit Einlagerung', 8900, 'won', null, 'Telefon', 2);
  void leadHoffmann;
  void leadSchmidt;

  const quote = async (number: string, key: string, leadId: string, title: string, status: typeof s.quotes.$inferInsert.status, items: s.QuoteItem[], aiNote: string, d: number, sent?: number) => {
    const id = newId('quo');
    await db.insert(s.quotes).values({
      id,
      tenantId,
      number,
      customerId: cus[key],
      leadId,
      title,
      status,
      items,
      totalCents: items.reduce((sum, i) => sum + i.quantity * i.unitPriceCents, 0),
      aiNote,
      sentAt: sent != null ? daysAgo(sent) : null,
      createdAt: daysAgo(d),
    });
    ev('quote.prepared', `Anna hat Angebot ${number} vorbereitet`, daysAgo(d), 'ai', ['quote', id]);
    return id;
  };
  await quote('AN-1024', 'wagner', leadWagner, 'Bremsen vorne: Scheiben und Beläge', 'draft', [
    { description: 'Bremsscheiben vorne (Paar)', quantity: 1, unitPriceCents: 16500 },
    { description: 'Bremsbeläge vorne (Satz)', quantity: 1, unitPriceCents: 7400 },
    { description: 'Arbeitszeit (AW)', quantity: 1.5, unitPriceCents: 10000 },
  ], 'Aus dem Anruf vorbereitet. Preise bitte prüfen und freigeben.', 4);
  await quote('AN-1023', 'bauer', leadBauer, 'Wartungspaket Fuhrpark (4 Fahrzeuge, jährlich)', 'sent', [
    { description: 'Inspektion Transporter', quantity: 4, unitPriceCents: 39500 },
    { description: 'HU/AU', quantity: 4, unitPriceCents: 7000 },
  ], 'Wird automatisch nach 3 Tagen nachgefasst.', 8, 4);

  // Tasks
  const today = localDate(new Date(), TZ);
  const offsetDate = (d: number) => localDate(new Date(Date.now() + d * 86400000), TZ);
  await db.insert(s.tasks).values([
    { id: newId('tsk'), tenantId, title: 'Stefan Hoffmann zurückrufen: Motorkontrollleuchte', assigneeId: staff.lukas, dueDate: today, priority: 'high', source: 'ai', entityType: 'customer', entityId: cus.hoffmann, createdAt: daysAgo(0, '08:03') },
    { id: newId('tsk'), tenantId, title: 'Kostenvoranschlag Bremsen Wagner freigeben', assigneeId: staff.thomas, dueDate: offsetDate(-1), priority: 'normal', source: 'ai', createdAt: daysAgo(4) },
    { id: newId('tsk'), tenantId, title: 'Rückruf: verpasster Anruf +49 151 9988776', assigneeId: null, dueDate: offsetDate(-1), priority: 'high', source: 'automation', createdAt: daysAgo(1, '12:50') },
    { id: newId('tsk'), tenantId, title: 'Bremsscheiben für Wagner bestellen', assigneeId: staff.thomas, dueDate: offsetDate(2), priority: 'normal', source: 'manual', createdAt: daysAgo(1) },
    { id: newId('tsk'), tenantId, title: 'Fuhrpark-Angebot Bauer nachfassen', assigneeId: staff.thomas, dueDate: offsetDate(-3), priority: 'urgent', source: 'automation', status: 'done', completedAt: daysAgo(1), createdAt: daysAgo(4) },
  ]);

  // Knowledge
  await db.insert(s.knowledgeItems).values([
    { id: newId('kno'), tenantId, category: 'Öffnungszeiten', title: 'Geschäftszeiten', content: 'Wir sind Montag bis Freitag von 7:30 bis 17:00 Uhr und samstags von 8:00 bis 12:00 Uhr für Sie da.' },
    { id: newId('kno'), tenantId, category: 'Unternehmen', title: 'Über uns', content: 'Die Kfz-Werkstatt Muster ist eine freie Meisterwerkstatt in München-Freimann. Wir reparieren und warten alle Marken, seit 1998.' },
    { id: newId('kno'), tenantId, category: 'Leistungen', title: 'Unsere Leistungen', content: 'Inspektion nach Herstellervorgaben, Reifenwechsel und Reifeneinlagerung, HU/AU im Haus, Bremsenservice, Fehlerdiagnose und Klimaservice.' },
    { id: newId('kno'), tenantId, category: 'Leistungen', title: 'Reifenwechsel', content: 'Ein Reifenwechsel dauert bei uns in der Regel etwa 45 Minuten. Eingelagerte Räder holen wir vorher aus dem Lager.' },
    { id: newId('kno'), tenantId, category: 'Preise', title: 'Richtpreise', content: 'Reifenwechsel ab 39 €, Reifeneinlagerung 59 € pro Saison, HU/AU 139 €. Reparaturpreise nennen wir erst nach Prüfung des Fahrzeugs.' },
    { id: newId('kno'), tenantId, category: 'Service', title: 'Ersatzwagen', content: 'Für längere Reparaturen stellen wir nach Verfügbarkeit einen Ersatzwagen für 19 € pro Tag.' },
  ]);

  // Automations
  for (const t of AUTOMATION_TEMPLATES.filter((x) => ['missed_call', 'appointment_reminder', 'review_request', 'quote_followup'].includes(x.key))) {
    await db.insert(s.automations).values({
      id: newId('aut'),
      tenantId,
      templateKey: t.key,
      name: t.name,
      description: t.description,
      steps: t.steps,
      enabled: true,
      runCount: { missed_call: 1, appointment_reminder: 6, review_request: 3, quote_followup: 1 }[t.key] ?? 0,
    });
  }

  // Older calls and chats so the ROI chart shows a trend. Real records, so every count agrees.
  const historyTopics = ['Öffnungszeiten', 'Terminverschiebung', 'Reifeneinlagerung', 'Abholzeit Fahrzeug', 'HU-Termin', 'Ersatzwagen'];
  for (let d = 14; d <= 40; d += 1) {
    const key = people[d % people.length].key;
    const topic = historyTopics[d % historyTopics.length];
    if (d % 2 === 0) {
      await call(key, daysAgo(d, '09:30'), {
        intent: topic,
        summary: `Anfrage zu ${topic}. Anna hat die Frage beantwortet.`,
        status: 'closed',
        sentiment: 'Positiv',
        actions: ['Kontakt erkannt'],
        duration: 70 + d,
        transcript: [['K', `Ich habe eine Frage zu ${topic}.`], ['A', 'Gern, das kann ich Ihnen direkt beantworten.']],
      });
    }
    if (d % 3 === 0) await chat(key, 's', daysAgo(d, '11:15'), [['K', `Kurze Frage zu ${topic}`, 0], ['A', 'Gern, hier die Antwort aus unserem Werkstatt-Wissen.', 1]]);
    if (d % 5 === 0) ev('appointment.reminder_sent', 'Terminerinnerung gesendet', daysAgo(d, '17:00'));
  }
  ev('conversation.handoff', 'Unterhaltung mit Stefan Hoffmann an Mitarbeiter übergeben', daysAgo(0, '08:02'), 'ai');
  ev('quote.sent', 'Angebot AN-1023 → versendet', daysAgo(4), 'user');
  await db.insert(s.events).values(events);

  // Integrations: fonio in sandbox with a fixed demo key, for local testing of the voice endpoints.
  await db.insert(s.integrations).values({ id: newId('int'), tenantId, provider: 'fonio', mode: 'sandbox', status: 'connected' });
  await db.insert(s.apiKeys).values({ id: sha256(DEMO_FONIO_KEY), tenantId, provider: 'fonio', label: 'Demo-Schlüssel' }).onConflictDoNothing();

  // A second tenant so the platform admin view has more than one row.
  const t2 = newId('wrk');
  await db.insert(s.tenants).values({
    id: t2,
    name: 'Beauty Lounge Lena',
    industry: 'Beauty & Kosmetik',
    status: 'trial',
    plan: 'start',
    aiSettings: { name: 'Mia', language: 'Deutsch', tone: 'Herzlich', greeting: 'Wie kann ich Ihnen helfen?', autonomy: 'assist', escalation: '' },
    businessHours: [2, 3, 4, 5].map((day) => ({ day, open: '09:00', close: '18:00' })),
  });
  const u2 = newId('usr');
  await db.insert(s.users).values({ id: u2, email: 'lena@example.de', name: 'Lena Hartmann', passwordHash: await hashPassword(newId('pw')) });
  await db.insert(s.memberships).values({ userId: u2, tenantId: t2, role: 'owner' });

  return { tenantId };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { db, pool } = createDb(env.DATABASE_URL);
  const { tenantId } = await seed(db);
  const [t] = await db.select().from(s.tenants).where(eq(s.tenants.id, tenantId));
  console.log(`Demo-Betrieb „${t.name}“ angelegt. Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  await pool.end();
}
