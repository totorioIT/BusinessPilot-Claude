import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  date,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

// Every business table carries tenant_id. Queries always filter by the tenant
// from the authenticated session (see lib/tenant.ts), never by a client value.

const id = () => text('id').primaryKey();
const tenantId = () =>
  text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export type AiSettings = {
  name: string;
  language: string;
  tone: string;
  greeting: string;
  autonomy: 'assist' | 'semi' | 'autopilot';
  escalation: string;
};

/** Weekday 1 = Monday … 7 = Sunday, times as "HH:MM" in the tenant's timezone. */
export type BusinessHours = { day: number; open: string; close: string }[];

export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  industry: text('industry').notNull(),
  address: text('address'),
  phone: text('phone'),
  googleReviewUrl: text('google_review_url'),
  timezone: text('timezone').notNull().default('Europe/Berlin'),
  plan: text('plan').notNull().default('start'),
  status: text('status').notNull().default('trial'),
  aiSettings: jsonb('ai_settings').$type<AiSettings>().notNull(),
  businessHours: jsonb('business_hours').$type<BusinessHours>().notNull(),
  slotStepMin: integer('slot_step_min').notNull().default(15),
  createdAt: createdAt(),
});

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  'memberships',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    role: text('role').$type<'owner' | 'admin' | 'staff'>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.tenantId] })],
);

export const sessions = pgTable('sessions', {
  id: id(), // sha256 of the cookie token
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tenantId: tenantId(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const staffMembers = pgTable('staff_members', {
  id: id(),
  tenantId: tenantId(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  skills: jsonb('skills').$type<string[]>().notNull().default([]),
  active: boolean('active').notNull().default(true),
});

export const customers = pgTable(
  'customers',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    name: text('name').notNull(),
    company: text('company'),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('customers_tenant_number').on(t.tenantId, t.number), index('customers_tenant_phone').on(t.tenantId, t.phone)],
);

/** Vehicles for workshops, heating systems for SHK, etc. */
export const customerAssets = pgTable('customer_assets', {
  id: id(),
  tenantId: tenantId(),
  customerId: text('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  label: text('label').notNull(),
  identifier: text('identifier'),
  attributes: jsonb('attributes').$type<Record<string, string>>().notNull().default({}),
  createdAt: createdAt(),
});

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    tenantId: tenantId(),
    customerId: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    channel: text('channel').$type<'phone' | 'whatsapp' | 'webchat'>().notNull(),
    status: text('status').$type<'ai_handling' | 'needs_staff' | 'missed' | 'closed'>().notNull(),
    contactName: text('contact_name'),
    contactAddress: text('contact_address'),
    subject: text('subject'),
    summary: text('summary'),
    sentiment: text('sentiment'),
    unreadCount: integer('unread_count').notNull().default(0),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index('conversations_tenant_last').on(t.tenantId, t.lastMessageAt)],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    tenantId: tenantId(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    direction: text('direction').$type<'inbound' | 'outbound'>().notNull(),
    author: text('author').$type<'customer' | 'ai' | 'staff' | 'system'>().notNull(),
    authorName: text('author_name'),
    type: text('type').notNull().default('text'),
    text: text('text').notNull(),
    providerMessageId: text('provider_message_id'),
    deliveryStatus: text('delivery_status'),
    createdAt: createdAt(),
  },
  (t) => [index('messages_conversation').on(t.conversationId, t.createdAt)],
);

export type TranscriptLine = { speaker: 'ai' | 'customer' | 'staff'; text: string };

export const calls = pgTable('calls', {
  id: id(),
  tenantId: tenantId(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  fromNumber: text('from_number'),
  toNumber: text('to_number'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  durationSec: integer('duration_sec').notNull().default(0),
  outcome: text('outcome'),
  intent: text('intent'),
  summary: text('summary'),
  transcript: jsonb('transcript').$type<TranscriptLine[]>().notNull().default([]),
  actions: jsonb('actions').$type<string[]>().notNull().default([]),
  providerCallId: text('provider_call_id'),
});

export const serviceTypes = pgTable(
  'service_types',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    durationMin: integer('duration_min').notNull(),
    bufferMin: integer('buffer_min').notNull().default(0),
    resourceKind: text('resource_kind'),
    requiredSkill: text('required_skill'),
    maxPerDay: integer('max_per_day'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [uniqueIndex('service_types_tenant_code').on(t.tenantId, t.code)],
);

/** Bookable capacity such as a lift (Hebebühne), treatment room or a vehicle. */
export const resources = pgTable('resources', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  active: boolean('active').notNull().default(true),
});

export const appointments = pgTable(
  'appointments',
  {
    id: id(),
    tenantId: tenantId(),
    customerId: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    assetId: text('asset_id').references(() => customerAssets.id, { onDelete: 'set null' }),
    serviceTypeId: text('service_type_id').references(() => serviceTypes.id),
    staffId: text('staff_id').references(() => staffMembers.id, { onDelete: 'set null' }),
    resourceId: text('resource_id').references(() => resources.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    bufferMin: integer('buffer_min').notNull().default(0),
    status: text('status').$type<'booked' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'>().notNull(),
    channel: text('channel'),
    location: text('location'),
    notes: text('notes'),
    confirmationCode: text('confirmation_code').notNull(),
    idempotencyKey: text('idempotency_key'),
    externalEventId: text('external_event_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('appointments_tenant_start').on(t.tenantId, t.startsAt),
    uniqueIndex('appointments_tenant_idem').on(t.tenantId, t.idempotencyKey),
  ],
);

export const appointmentHolds = pgTable('appointment_holds', {
  id: id(),
  tenantId: tenantId(),
  serviceTypeId: text('service_type_id')
    .notNull()
    .references(() => serviceTypes.id, { onDelete: 'cascade' }),
  staffId: text('staff_id').references(() => staffMembers.id, { onDelete: 'cascade' }),
  resourceId: text('resource_id').references(() => resources.id, { onDelete: 'cascade' }),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const leads = pgTable('leads', {
  id: id(),
  tenantId: tenantId(),
  customerId: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  valueCents: integer('value_cents').notNull().default(0),
  stage: text('stage')
    .$type<'new' | 'qualified' | 'appointment' | 'quote_in_progress' | 'quote_sent' | 'won' | 'lost'>()
    .notNull(),
  nextAction: text('next_action'),
  channel: text('channel'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type QuoteItem = { description: string; quantity: number; unitPriceCents: number };

export const quotes = pgTable(
  'quotes',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    customerId: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    status: text('status').$type<'draft' | 'missing_info' | 'sent' | 'accepted' | 'rejected'>().notNull(),
    items: jsonb('items').$type<QuoteItem[]>().notNull().default([]),
    // Prices come from items entered by staff or a pricing system, never from the LLM.
    totalCents: integer('total_cents').notNull().default(0),
    aiNote: text('ai_note'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('quotes_tenant_number').on(t.tenantId, t.number)],
);

export const tasks = pgTable('tasks', {
  id: id(),
  tenantId: tenantId(),
  title: text('title').notNull(),
  assigneeId: text('assignee_id').references(() => staffMembers.id, { onDelete: 'set null' }),
  dueDate: date('due_date'),
  priority: text('priority').$type<'low' | 'normal' | 'high' | 'urgent'>().notNull().default('normal'),
  status: text('status').$type<'open' | 'done'>().notNull().default('open'),
  source: text('source').$type<'manual' | 'ai' | 'automation'>().notNull().default('manual'),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  createdAt: createdAt(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export type AutomationStep = {
  type: 'trigger' | 'wait' | 'condition' | 'action';
  label: string;
  config?: Record<string, unknown>;
};

export const automations = pgTable(
  'automations',
  {
    id: id(),
    tenantId: tenantId(),
    templateKey: text('template_key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    enabled: boolean('enabled').notNull().default(false),
    steps: jsonb('steps').$type<AutomationStep[]>().notNull(),
    runCount: integer('run_count').notNull().default(0),
    createdAt: createdAt(),
  },
  // One instance per template and tenant, so templates can't be activated twice.
  (t) => [uniqueIndex('automations_tenant_template').on(t.tenantId, t.templateKey)],
);

export const reviewRequests = pgTable('review_requests', {
  id: id(),
  tenantId: tenantId(),
  customerId: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  appointmentId: text('appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
  channel: text('channel').notNull(),
  status: text('status').$type<'planned' | 'sent' | 'clicked' | 'failed'>().notNull(),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  clickedAt: timestamp('clicked_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const knowledgeItems = pgTable('knowledge_items', {
  id: id(),
  tenantId: tenantId(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const integrations = pgTable(
  'integrations',
  {
    id: id(),
    tenantId: tenantId(),
    provider: text('provider').notNull(),
    mode: text('mode').$type<'sandbox' | 'live'>().notNull().default('sandbox'),
    status: text('status').$type<'connected' | 'disconnected' | 'error'>().notNull().default('disconnected'),
    config: jsonb('config').$type<Record<string, string>>().notNull().default({}),
    lastError: text('last_error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('integrations_tenant_provider').on(t.tenantId, t.provider)],
);

/** Inbound webhook credentials (e.g. the bearer token fonio sends). Only the hash is stored. */
export const apiKeys = pgTable('api_keys', {
  id: id(), // sha256 of the key
  tenantId: tenantId(),
  provider: text('provider').notNull(),
  label: text('label').notNull(),
  createdAt: createdAt(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const voiceSessions = pgTable('voice_sessions', {
  id: id(), // sha256 of bp_session_token
  tenantId: tenantId(),
  conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  customerId: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  fromNumber: text('from_number'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const communicationConsents = pgTable('communication_consents', {
  id: id(),
  tenantId: tenantId(),
  customerId: text('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  purpose: text('purpose').notNull(),
  status: text('status').$type<'granted' | 'revoked'>().notNull(),
  source: text('source').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

/** Domain events: activity feed, audit log and the input for automations and ROI. */
export const events = pgTable(
  'events',
  {
    id: id(),
    tenantId: tenantId(),
    type: text('type').notNull(),
    actorType: text('actor_type').$type<'user' | 'ai' | 'system' | 'provider'>().notNull(),
    actorId: text('actor_id'),
    actorName: text('actor_name'),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    summary: text('summary').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('events_tenant_created').on(t.tenantId, t.createdAt)],
);

/** Durable background jobs (reminders, review requests, follow-ups). Polled with SKIP LOCKED. */
export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    tenantId: tenantId(),
    type: text('type').notNull(),
    runAt: timestamp('run_at', { withTimezone: true }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').$type<'pending' | 'running' | 'done' | 'failed' | 'cancelled'>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    dedupeKey: text('dedupe_key'),
    createdAt: createdAt(),
  },
  (t) => [index('jobs_due').on(t.status, t.runAt), uniqueIndex('jobs_tenant_dedupe').on(t.tenantId, t.dedupeKey)],
);
