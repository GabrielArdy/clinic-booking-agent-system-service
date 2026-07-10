# Clinic Booking Agent — Backend

Conversational clinic appointment booking backend implementing [SPEC-1](./spec_1_clinic_booking_agent.md).

Node.js + TypeScript, Express, SQLite (better-sqlite3, raw SQL — no ORM), deterministic conversation state machine, optional AI assistance via OpenRouter or AgentRouter (`AI_PROVIDER`).

## Design

- **Deterministic router owns the flow.** The booking path is an explicit state machine (`greeting → select_specialty → select_doctor → select_date → select_slot → collect_patient_name → collect_patient_phone → confirm_booking → booking_complete`). The AI adapter only helps interpret free text; it never decides booking validity.
- **Anti-double-booking** via a partial unique index on `bookings(doctor_id, date, start_time) WHERE status = 'active'`, plus a re-check inside the booking transaction.
- **CMS console** (`/api/cms/*`) is a separate surface from the operational admin console, managing clinic content: Clinic Setting, Theme, Specialties, Doctor & Staff, TimeSlot presets, and Shift scheduling. Singletons (clinic, theme) use a `CHECK (id = 1)` row seeded by migration.
- **AI is optional and pluggable.** Without an API key the system runs fully deterministic (numbered options, keyword matching). With it, free-form messages are classified into a constrained intent taxonomy and schema-validated before use. Provider selected by `AI_PROVIDER` (`openrouter` default, or `agentrouter` — OpenAI-compatible, see https://docs.agentrouter.org/); both implement the same `AIProviderAdapter` interface.
- **Sessions persist in SQLite** — conversation state survives refresh/reconnect.

## Setup

```bash
npm install
cp .env.example .env   # set ADMIN_TOKEN; optionally OPENROUTER_API_KEY
npm run setup          # migrate + seed specialties/doctors/schedules
npm run dev            # start on :3000
```

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/chat` | `{sessionId?, message}` → assistant turn (message, quickReplies, stage, collectedEntities) |
| GET | `/api/chat/:sessionId/history` | Conversation transcript |
| POST | `/api/booking/cancel` | `{reference, phone}` — phone must match booking |
| GET/POST | `/api/admin/doctors` | List / create doctors (header `x-admin-token`). Create body: `{fullName, specialtyId, photoUrl?}`. Doctor objects include `photoUrl` (nullable). |
| GET/POST | `/api/admin/schedules` | List / create weekly schedule rules |
| POST | `/api/admin/schedule-exceptions` | Block a date or time range |
| GET | `/api/admin/bookings?doctorId=&date=` | Bookings by doctor and date |

### CMS console (`/api/cms/*`, header `x-admin-token`)

Separate from the operational admin console; manages clinic content and configuration. Reuses the admin token.

| Method | Path | Description |
|--------|------|-------------|
| GET/PUT | `/api/cms/clinic` | Clinic settings singleton (name, address, lat/lng, phone, email, permission letter, emblem, custom `extra`) |
| GET/PUT | `/api/cms/theme` | Theme singleton (colors, logo, font, darkMode, `extra`) |
| GET/POST, PUT/DELETE `/:id` | `/api/cms/specialties` | Specialty CMS (DELETE = soft deactivate) |
| GET/POST, PUT/DELETE `/:id` | `/api/cms/doctors` | Doctor management (adds email/phone/bio/photoUrl; DELETE = deactivate) |
| GET/POST, PUT/DELETE `/:id` | `/api/cms/staff` | Staff management (non-doctor personnel) |
| GET/POST, PUT/DELETE `/:id` | `/api/cms/slot-presets` | TimeSlot CMS — named slot-duration presets |
| GET/POST, PUT/DELETE `/:id` | `/api/cms/shifts` | Schedule CMS — named shifts (Morning/Afternoon) |
| GET/POST, DELETE `/:id` | `/api/cms/shift-assignments?date=` | On-duty roster: shift → exactly one doctor OR staff, per date |

### Chat example

```bash
# start a session
curl -s -X POST localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"message":"hi"}'
# reply with a quick-reply value or free text
curl -s -X POST localhost:3000/api/chat -H 'Content-Type: application/json' \
  -d '{"sessionId":"<uuid>","message":"General Medicine"}'
```

Quick replies carry a numeric `value` ("1", "2", …) — the UI can send either the value or the label.

## Tests

```bash
npm test        # vitest: slots, phone normalization, booking transactions, conversation flow
npm run typecheck
```

Covered critical scenarios: unavailable slot selection, concurrent slot race (unique-index guarded), session resume, cancellation of unknown reference, handoff after repeated invalid input.

## Layout

```
src/
  index.ts          # wiring + HTTP server
  config.ts         # env config
  api/              # Express routes (chat, booking, admin)
  conversation/     # state machine: types, interpret, router
  services/         # booking domain: slots, phone, references, BookingService
  repositories/     # raw-SQL data access
  ai/               # provider interface, OpenRouter adapter, prompts, schemas
  db/               # connection, migrations, seed
tests/
```
