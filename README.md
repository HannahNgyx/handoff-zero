# TraumaLink

Live pre-arrival trauma handoff between **EMS** and the **receiving hospital**.

- **EMS** (`/ems`) — voice or text fills a trauma card; opens an **Incoming** case at call start; **Confirm** when the packet is ready.
- **Hospital** (`/hospital`) — multi-case queue, Accept / Request More Info / live-connect ping, Medplum prep tasks + TraumaLink suggestions.
- **Stack** — Next.js, Medplum (FHIR + WebSocket subscriptions), Deepgram Voice Agent.

**BP** = blood pressure (systolic/diastolic, mmHg). Example: `92/60` with a **LOW** flag when systolic &lt; 90.

## Setup

```bash
cp .env.local.example .env.local
# Fill NEXT_PUBLIC_MEDPLUM_CLIENT_ID and DEEPGRAM_API_KEY
# Deepgram key must be Member permission or higher (for /v1/auth/grant)
npm install
npm run dev -- -H 127.0.0.1 -p 3000
```

Open two windows: [http://127.0.0.1:3000/ems](http://127.0.0.1:3000/ems) and [http://127.0.0.1:3000/hospital](http://127.0.0.1:3000/hospital). Sign in with the same Medplum project account on both.

## Demo script

1. Hospital empty queue + EMS signed in (header shows **WS open**).
2. EMS: **Start voice** or **Open Incoming card** → hospital shows **Incoming** case.
3. Speak / **Load demo handoff** → card fills (age, mechanism, blood pressure, HR, GCS, …); hospital updates live.
4. EMS: **Confirm handoff** → badge **Confirmed**.
5. Hospital: **Accept** → Medplum prep tasks; EMS gets acknowledgment (voice inject if connected).
6. Hospital: **Request More Info** → pick topics → EMS checklist / agent ask → answer updates the card.
7. Optional: **New patient** on EMS for a second concurrent case; **Request live connect** for a bridge ping (demo channel, not WebRTC).

## Screenshots (for submission)

Drop PNG/JPEG files into `docs/screenshots/` using these filenames, then the README preview below will render them.

| # | File | Capture this |
|---|------|----------------|
| 1 | `docs/screenshots/01-ems-incoming.png` | EMS active case with trauma card (blood pressure visible) + voice panel |
| 2 | `docs/screenshots/02-hospital-queue.png` | Hospital case queue with 2+ cases, one selected |
| 3 | `docs/screenshots/03-hospital-accept.png` | After Accept — Medplum prep tasks + labeled TraumaLink suggestions |
| 4 | `docs/screenshots/04-request-info.png` | Request More Info topic picker open |
| 5 | `docs/screenshots/05-dual-browser.png` | Side-by-side EMS + Hospital (or a wide crop of both) |

### Preview slots

<!-- Add files under docs/screenshots/ — leave these markdown lines as-is -->

#### 1. EMS — Incoming trauma card

![EMS Incoming trauma card](docs/screenshots/01-ems-incoming.png)

#### 2. Hospital — Multi-case queue

![Hospital multi-case queue](docs/screenshots/02-hospital-queue.png)

#### 3. Hospital — Accept + prep tasks

![Hospital accept and Medplum prep tasks](docs/screenshots/03-hospital-accept.png)

#### 4. Request More Info picker

![Request More Info topic picker](docs/screenshots/04-request-info.png)

#### 5. Dual-browser demo

![EMS and Hospital side by side](docs/screenshots/05-dual-browser.png)

## Provenance (for judges)

| UI label | Source |
|----------|--------|
| Prep tasks | Medplum `Task` resources created on Accept |
| Suggested next asks | TraumaLink client rules (`getMissingFields` + vital flags) — not Medplum, not voice AI |
| Voice extraction | Deepgram Voice Agent function calling |
| Live updates | Medplum `useSubscription` |

## Project layout

```
src/app/ems/page.tsx          EMS multi-case UI
src/app/hospital/page.tsx     Hospital ops board
src/components/VoiceHandoff.tsx
src/lib/fhir/handoff.ts       FHIR builders + channel helpers
src/lib/trauma.ts             TraumaCard types + BP helpers
src/app/api/deepgram/token    Short-lived Deepgram JWT
docs/screenshots/             Submission screenshots (you add)
```
