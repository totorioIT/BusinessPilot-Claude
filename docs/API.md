# BusinessPilot API (v1)

Base path `/api`. JSON in and out. Session auth via httpOnly cookie `bp_session`
(set by `POST /api/auth/login`). Every endpoint except login and the voice
webhooks requires a session; all data is scoped to the session's tenant.

Conventions
- Money is integer cents (`valueCents`, `totalCents`). Format as EUR in the UI.
- Timestamps are ISO 8601 UTC strings. The UI formats them in the tenant timezone
  (`tenant.timezone`, default `Europe/Berlin`). Dates without time are `YYYY-MM-DD`.
- Errors: HTTP 4xx/5xx with `{ "error": "code", "message": "German text for the UI" }`.
- 401 means not logged in; the UI redirects to `/login`.

## Auth
| Method | Path | Body | Response |
|---|---|---|---|
| POST | /auth/login | `{email, password}` | `Me` |
| POST | /auth/logout | – | `{ok:true}` |
| GET | /auth/me | – | `Me` |

`Me = { user:{id,name,email,isPlatformAdmin}, tenant:{id,name,industry,timezone}, role:'owner'|'admin'|'staff', ai:{name} }`

## Dashboard
`GET /dashboard?days=30` →
```
{ hero:{ interactions, minutesSaved, valueCents },
  kpis:{ calls, whatsappChats, appointmentsBooked, leadsCreated, activeAutomations,
         quotesInitiated, reviewRequests, handoffs },
  activity: Event[] }   // latest 15
```
`Event = { id, type, actorType:'user'|'ai'|'system'|'provider', actorName, summary, entityType, entityId, createdAt }`

`GET /events?limit=50` → `Event[]`

## Inbox
`GET /conversations?channel=phone|whatsapp&status=…` →
`{ stats:{calls, whatsapp, missed, needsStaff}, items: ConversationListItem[] }`

`ConversationListItem = { id, channel:'phone'|'whatsapp'|'webchat', status:'ai_handling'|'needs_staff'|'missed'|'closed', contactName, customerId, subject, preview, unreadCount, lastMessageAt }`

`GET /conversations/:id` →
`{ conversation, customer:{id,name,phone}|null, messages: Message[], call: Call|null }`
- `Message = { id, direction:'inbound'|'outbound', author:'customer'|'ai'|'staff'|'system', authorName, text, createdAt, deliveryStatus }`
- `Call = { id, fromNumber, startedAt, durationSec, outcome, intent, summary, sentiment, transcript:[{speaker:'ai'|'customer'|'staff', text}], actions:string[] }`

`PATCH /conversations/:id` `{status}` → conversation
`POST /conversations/:id/messages` `{text}` → `Message` (staff reply, sent via the messaging provider)
`POST /conversations/:id/suggest-reply` → `{ text, sources:[{id,title}] }` (from the knowledge base; staff reviews before sending)
`POST /conversations/:id/read` → `{ok:true}`

## Customers
`GET /customers?q=` → `Customer[]` with `Customer = { id, number, name, company, phone, email, address, notes, createdAt }`
`POST /customers` `{name, company?, phone?, email?, address?, notes?}` → `Customer`
`GET /customers/:id` → `{ customer, assets: Asset[], appointments: Appointment[], conversations: ConversationListItem[], leads: Lead[], quotes: Quote[] }`
`PATCH /customers/:id` partial → `Customer`
`POST /customers/:id/assets` `{kind, label, identifier?, attributes?}` → `Asset`
`Asset = { id, kind, label, identifier, attributes:{[k]:string} }`

## Leads (pipeline)
`GET /leads` → `{ stages:[{key,label,count,valueCents}], items: Lead[] }`
Stages in order: `new` Neue Anfrage, `qualified` Qualifiziert, `appointment` Termin,
`quote_in_progress` Angebot in Arbeit, `quote_sent` Angebot versendet, `won` Gewonnen, `lost` Verloren.
`Lead = { id, title, valueCents, stage, nextAction, channel, customer:{id,name}|null, createdAt }`
`POST /leads` `{title, valueCents?, customerId?, channel?, nextAction?}` · `PATCH /leads/:id` partial

## Appointments and scheduling
`GET /appointments?from=YYYY-MM-DD&to=YYYY-MM-DD` → `Appointment[]`
`Appointment = { id, title, startsAt, endsAt, status:'booked'|'confirmed'|'completed'|'cancelled'|'no_show', channel, location, notes, confirmationCode, customer:{id,name}|null, staff:{id,name}|null, serviceType:{id,code,name}|null }`
`GET /service-types` → `[{id, code, name, durationMin, bufferMin}]`
`GET /staff` → `[{id, name, skills}]`
`GET /availability?serviceCode=&date=YYYY-MM-DD` → `{ slots:[{slotId, startsAt, endsAt, staffName}] }`
`POST /appointments` `{serviceCode, slotId, customerId?, title?, location?, notes?, channel?}` → `Appointment` (409 `slot_taken` if gone)
`PATCH /appointments/:id` `{status}` → `Appointment`

## Quotes
`GET /quotes` → `Quote[]`
`Quote = { id, number, title, status:'draft'|'missing_info'|'sent'|'accepted'|'rejected', items:[{description, quantity, unitPriceCents}], totalCents, aiNote, customer:{id,name}|null, leadId, sentAt, createdAt }`
`POST /quotes` `{title, customerId?, leadId?, items?}` · `PATCH /quotes/:id` partial (`totalCents` is computed from items)

## Tasks
`GET /tasks` → `Task[]` with `Task = { id, title, dueDate, priority:'low'|'normal'|'high'|'urgent', status:'open'|'done', source:'manual'|'ai'|'automation', assignee:{id,name}|null, createdAt }`
`POST /tasks` `{title, assigneeId?, dueDate?, priority?}` · `PATCH /tasks/:id` partial

## Automations
`GET /automations` → `{ items: Automation[], templates: [{key, name, description, steps, active}] }`
`Automation = { id, templateKey, name, description, enabled, runCount, steps:[{type:'trigger'|'wait'|'condition'|'action', label}] }`
`POST /automations` `{templateKey}` → `Automation` (idempotent, one per template)
`PATCH /automations/:id` `{enabled}`

## Reviews
`GET /reviews` → `{ stats:{planned, sent, clicked}, reviewUrlConfigured:boolean, items:[{id, customer:{id,name}|null, channel, status:'planned'|'sent'|'clicked'|'failed', scheduledFor, sentAt, clickedAt}] }`

Google reviews (live, from the Business Profile API): `GET /reviews/google` → `{connected:false}` | `{connected:true, location:null}` (location not chosen yet) | `{connected:true, location, averageRating, total, nextPageToken, reviews:[{id, author, rating 1-5, text (original language), createdAt, reply:{text, updatedAt}|null}]}`; `?pageToken=` for more. `PUT /reviews/google/:reviewId/reply {text}` posts or replaces the public reply; `DELETE` the same path removes it. `POST /reviews/google/suggest {author, rating, text}` → `{text}`, an AI draft that is never posted automatically.

## Knowledge
`GET /knowledge` → `[{id, category, title, content, version, updatedAt}]`
`POST /knowledge` `{category, title, content}` · `PATCH /knowledge/:id` · `DELETE /knowledge/:id`

## Analytics / ROI
`GET /analytics?days=30` →
```
{ interactions, minutesSaved, valueCents, hourlyRateCents,
  byChannel:[{key, label, count, minutes}],
  weekly:[{week:'KW 41', interactions}],
  summary }
```
All numbers come from the same event set, so tiles, bars and summary always agree.

## Settings
`GET /settings/company` / `PUT` `{name, industry, address, phone, googleReviewUrl, timezone}`
`GET /settings/hours` / `PUT` `[{day:1..7, open:'HH:MM', close:'HH:MM'}]`
`GET /settings/ai` / `PUT` `{name, language, tone, greeting, autonomy:'assist'|'semi'|'autopilot', escalation}`
`GET /settings/team` → `{ users:[{id,name,email,role}], staff:[{id,name,skills,active}] }`

## Integrations
`GET /integrations` → `[{provider, name, description, category, mode:'sandbox'|'live', status:'connected'|'disconnected'|'error', lastError, webhookUrl|null, detail|null}]`. `openai` is managed by the platform admin and shows as connected once a model is saved.
`POST /integrations/:provider/connect` `{apiKey?, testAccount?}` → integration item, plus `apiKey` (string) for `fonio` only: the webhook bearer key, returned exactly once. The UI must show it with a copy button and a warning that it will not be shown again.
`POST /integrations/:provider/disconnect` → integration item
WhatsApp goes live with `POST /integrations/whatsapp_360dialog/connect {apiKey, testAccount}`: the server registers `/api/webhooks/whatsapp_360dialog/<secret>` with 360dialog (400 `provider_rejected` if 360dialog refuses the key), stores the key encrypted and from then on sends through 360dialog. Incoming messages land in the inbox; the AI answers per the autonomy setting (assist: hand to staff; semi: answer when the knowledge clearly matches, otherwise a holding reply and hand-off; autopilot: always answer). The first AI message in a conversation says that an AI is writing.
Google Business Profile connects the same way with `POST /integrations/google_business/start` (scope `business.manage`). With one location it is selected automatically; otherwise `GET /integrations/google_business/locations` → `{locations:[{id,title,address}], selected}` and `PUT /integrations/google_business/location {locationId}`. Needs the APIs "My Business Account Management", "My Business Business Information" and the v4 reviews API enabled in the Cloud project, plus approved GBP API access.
Google Calendar connects through OAuth: `POST /integrations/google_calendar/start` → `{url}` (Google consent screen; 400 `google_not_configured` until a platform admin saved the OAuth client). Google redirects to `GET /integrations/google/callback`, which stores the refresh token encrypted and redirects to `/integrations?google=connected` or `/integrations?google_error=<text>`. `GET /integrations/google_calendar/calendars` → `{account, calendars:[{id,name,primary}], staff:[{id,name,calendarId|null}]}`; `PUT` the same path with `{staffCalendars: {staffId: calendarId|null}}`. Linked staff: their Google busy times block slots and their bookings land in that calendar; unlinked staff book into the primary calendar. Google errors never fail a booking; they appear as `lastError` on the integration.
Providers: `fonio`, `whatsapp_360dialog`, `google_calendar`, `microsoft_365`, `google_business`, `brevo`, `openai`.

## Platform admin (users with isPlatformAdmin)
`GET /admin/google` → `{configured, clientId, secretHint, redirectUri, updatedAt, canStoreSecrets}`; `PUT /admin/google {clientId, clientSecret?}`; `DELETE /admin/google`. The OAuth client of the operator's Google Cloud project, shared by all tenants for Google Calendar (and later Google reviews).
`GET /admin/tenants` → `{ stats:{tenants, users, active}, items:[{id, name, industry, plan, status, users, calls, chats, createdAt}] }`

LLM account shared by all tenants (OpenAI-compatible, default IONOS AI Model Hub). The token is write-only; responses carry only `tokenHint` (last four characters).
| Method | Path | Body → Response |
|---|---|---|
| GET | /admin/ai | → `{configured, baseUrl, model, tokenHint, updatedAt, canStoreSecrets}` |
| POST | /admin/ai/models | `{baseUrl?, token?}` (stored token if omitted) → `{models:[id]}` |
| PUT | /admin/ai | `{baseUrl?, token?, model}`; test call first, 400 `llm_error` if it fails, 400 `no_secret` without APP_SECRET |
| DELETE | /admin/ai | back to answers from the knowledge base |
| POST | /admin/ai/test | `{question, model?}` → `{model, answer, ms, sources}` against the admin's own tenant knowledge |

## Voice webhooks (fonio)
Authenticated with `Authorization: Bearer <tenant api key>`; no cookie.
Tools identify the call by `session_token` (from inbound) or, when fonio skipped the inbound webhook (browser test calls), by `call_id` (fonio's conversation id); the first request with a new `call_id` opens the conversation. `availability/search` needs neither. Services may be given by code or spoken name; dates as `YYYY-MM-DD`, `24.10.`, `morgen` or a weekday; booking accepts `service_code` + `date` + `time` instead of `slot_id`.
| Method | Path | Purpose |
|---|---|---|
| POST | /voice/fonio/inbound | `{fromNumber,toNumber}` → caller context + `bp_session_token` |
| POST | /voice/tools/customer/lookup | find customer / asset |
| POST | /voice/tools/availability/search | free slots |
| POST | /voice/tools/appointments/book | book with idempotency |
| POST | /voice/tools/service-request | create task / lead |
| POST | /voice/tools/callback | callback task |
| POST | /voice/tools/knowledge/query | answer from knowledge base |
| POST | /voice/fonio/post-call | transcript, outcome, summary; without a valid `session_token` it goes to the newest call of the last 2 h that has no call record yet (matching `fromNumber` first) |

`GET /integrations/fonio/log` (owner/admin, cookie) lists the last 20 fonio calls since the server started: path, status, field previews, error message. Calls with a missing or wrong key are included for platform admins.
