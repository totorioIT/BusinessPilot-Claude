// Fetch-Wrapper und Typen gemäß docs/API.md (Basis /api, Cookie-Session, Cent-Beträge, ISO-UTC).

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Query = Record<string, string | number | undefined | null>;

function qs(params?: Query): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export async function request<T>(method: string, path: string, body?: unknown, params?: Query): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}${qs(params)}`, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Der Server ist nicht erreichbar. Bitte prüfen Sie Ihre Verbindung.');
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string };
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
    throw new ApiError(
      res.status,
      d.error ?? 'error',
      d.message ?? 'Es ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.',
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, params?: Query) => request<T>('GET', path, undefined, params),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

// ---------- Typen ----------

export type Role = 'owner' | 'admin' | 'staff';
export interface Me {
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean };
  tenant: { id: string; name: string; industry: string; timezone: string };
  role: Role;
  ai: { name: string };
}

export type ActorType = 'user' | 'ai' | 'system' | 'provider';
export interface AppEvent {
  id: string;
  type: string;
  actorType: ActorType;
  actorName: string | null;
  summary: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}

export interface DashboardData {
  hero: { interactions: number; minutesSaved: number; valueCents: number };
  kpis: {
    calls: number;
    whatsappChats: number;
    appointmentsBooked: number;
    leadsCreated: number;
    activeAutomations: number;
    quotesInitiated: number;
    reviewRequests: number;
    handoffs: number;
  };
  activity: AppEvent[];
}

export type Channel = 'phone' | 'whatsapp' | 'webchat';
export type ConversationStatus = 'ai_handling' | 'needs_staff' | 'missed' | 'closed';
export interface ConversationListItem {
  id: string;
  channel: Channel;
  status: ConversationStatus;
  contactName: string | null;
  customerId: string | null;
  subject: string | null;
  preview: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
}
export interface ConversationList {
  stats: { calls: number; whatsapp: number; missed: number; needsStaff: number };
  items: ConversationListItem[];
}
export interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  author: 'customer' | 'ai' | 'staff' | 'system';
  authorName: string | null;
  text: string;
  createdAt: string;
  deliveryStatus: string | null;
}
export interface Call {
  id: string;
  fromNumber: string | null;
  startedAt: string;
  durationSec: number | null;
  outcome: string | null;
  intent: string | null;
  summary: string | null;
  sentiment: string | null;
  transcript: { speaker: 'ai' | 'customer' | 'staff'; text: string }[];
  actions: string[];
}
export interface ConversationDetail {
  conversation: ConversationListItem;
  customer: { id: string; name: string; phone: string | null } | null;
  messages: Message[];
  call: Call | null;
}

export interface Customer {
  id: string;
  number: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
}
export interface Asset {
  id: string;
  kind: string;
  label: string;
  identifier: string | null;
  attributes: Record<string, string> | null;
}
export interface Ref {
  id: string;
  name: string;
}
export interface CustomerDetail {
  customer: Customer;
  assets: Asset[];
  appointments: Appointment[];
  conversations: ConversationListItem[];
  leads: Lead[];
  quotes: Quote[];
}

export type LeadStage = 'new' | 'qualified' | 'appointment' | 'quote_in_progress' | 'quote_sent' | 'won' | 'lost';
export interface Lead {
  id: string;
  title: string;
  valueCents: number | null;
  stage: LeadStage;
  nextAction: string | null;
  channel: string | null;
  customer: Ref | null;
  createdAt: string;
}
export interface LeadsData {
  stages: { key: LeadStage; label: string; count: number; valueCents: number }[];
  items: Lead[];
}

export type AppointmentStatus = 'booked' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
export interface Appointment {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  channel: string | null;
  location: string | null;
  notes: string | null;
  confirmationCode: string | null;
  customer: Ref | null;
  staff: Ref | null;
  serviceType: { id: string; code: string; name: string } | null;
}
export interface ServiceType {
  id: string;
  code: string;
  name: string;
  durationMin: number;
  bufferMin: number;
}
export interface Staff {
  id: string;
  name: string;
  skills: string[] | null;
}
export interface Slot {
  slotId: string;
  startsAt: string;
  endsAt: string;
  staffName: string | null;
}

export type QuoteStatus = 'draft' | 'missing_info' | 'sent' | 'accepted' | 'rejected';
export interface QuoteItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
}
export interface Quote {
  id: string;
  number: string;
  title: string;
  status: QuoteStatus;
  items: QuoteItem[];
  totalCents: number;
  aiNote: string | null;
  customer: Ref | null;
  leadId: string | null;
  sentAt: string | null;
  createdAt: string;
}

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export interface Task {
  id: string;
  title: string;
  dueDate: string | null;
  priority: TaskPriority;
  status: 'open' | 'done';
  source: 'manual' | 'ai' | 'automation';
  assignee: Ref | null;
  createdAt: string;
}

export type StepType = 'trigger' | 'wait' | 'condition' | 'action';
export interface Step {
  type: StepType;
  label: string;
}
export interface Automation {
  id: string;
  templateKey: string;
  name: string;
  description: string | null;
  enabled: boolean;
  runCount: number;
  steps: Step[];
}
export interface AutomationTemplate {
  key: string;
  name: string;
  description: string;
  steps: Step[];
  active: boolean;
}
export interface AutomationsData {
  items: Automation[];
  templates: AutomationTemplate[];
}

export interface ReviewItem {
  id: string;
  customer: Ref | null;
  channel: string | null;
  status: 'planned' | 'sent' | 'clicked' | 'failed';
  scheduledFor: string | null;
  sentAt: string | null;
  clickedAt: string | null;
}
export interface ReviewsData {
  stats: { planned: number; sent: number; clicked: number };
  reviewUrlConfigured: boolean;
  items: ReviewItem[];
}

export interface KnowledgeEntry {
  id: string;
  category: string;
  title: string;
  content: string;
  version: number;
  updatedAt: string;
}

export interface AnalyticsData {
  interactions: number;
  minutesSaved: number;
  valueCents: number;
  hourlyRateCents: number;
  byChannel: { key: string; label: string; count: number; minutes: number }[];
  weekly: { week: string; interactions: number }[];
  summary: string;
}

export interface CompanySettings {
  name: string;
  industry: string | null;
  address: string | null;
  phone: string | null;
  googleReviewUrl: string | null;
  timezone: string;
}
export interface HoursEntry {
  day: number;
  open: string;
  close: string;
}
export type Autonomy = 'assist' | 'semi' | 'autopilot';
export interface AiSettings {
  name: string;
  language: string;
  tone: string;
  greeting: string;
  autonomy: Autonomy;
  escalation: string;
}
export interface TeamData {
  users: { id: string; name: string; email: string; role: Role }[];
  staff: { id: string; name: string; skills: string[] | null; active: boolean }[];
}

export interface Integration {
  provider: string;
  name: string;
  description: string;
  category: string;
  mode: 'sandbox' | 'live';
  status: 'connected' | 'disconnected' | 'error';
  lastError: string | null;
  webhookUrl: string | null;
}

export interface WebhookLogEntry {
  at: string;
  path: string;
  status: number;
  fields: Record<string, string>;
  note: string | null;
}

export interface AdminTenants {
  stats: { tenants: number; users: number; active: number };
  items: {
    id: string;
    name: string;
    industry: string | null;
    plan: string | null;
    status: string;
    users: number;
    calls: number;
    chats: number;
    createdAt: string;
  }[];
}

export interface AiSettings {
  configured: boolean;
  baseUrl: string;
  model: string | null;
  tokenHint: string | null;
  updatedAt: string | null;
  canStoreSecrets: boolean;
}

export interface AiTestResult {
  model: string;
  answer: string;
  ms: number;
  sources: { id: string; title: string }[];
}
