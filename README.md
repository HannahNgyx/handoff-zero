# TraumaLink

Live pre-arrival trauma handoff between **EMS** and the **receiving hospital**, automatically updated to MedPlum

- **EMS** (`/ems`) — voice or text fills a trauma card; opens an **Incoming** case at call start; **Confirm** when the packet is ready.
- **Hospital** (`/hospital`) — multi-case queue, Accept / Request More Info / live-connect ping, Medplum prep tasks + TraumaLink suggestions.
- **Stack** — Next.js, Medplum (FHIR + WebSocket subscriptions), Deepgram Voice Agent.

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

## Screenshots 
#### 1. EMS - new patient card


#### 2. Hospital — Multi-case queue


#### 3. Hospital — Accept + prep tasks


## Provenance

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
src/app/api/deepgram/token    Short-lived Deepgram JW
```
