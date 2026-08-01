import {
  buildHandoffTransaction,
  cardFromCommunicationPayload,
  ensureServerLogin,
  getServerMedplum,
  listLocalHandoffs,
  saveLocalHandoff,
  TAG_HANDOFF,
  TAG_SYSTEM,
  type ActiveHandoff,
} from "@/lib/fhir/handoff";
import type { TraumaCard } from "@/lib/trauma";
import type { Bundle, Communication, ServiceRequest } from "@medplum/fhirtypes";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function parseCard(body: unknown): TraumaCard | null {
  if (!body || typeof body !== "object") return null;
  const card = (body as { card?: TraumaCard }).card;
  if (!card || typeof card !== "object") return null;
  return card;
}

export async function GET() {
  const medplum = getServerMedplum();

  if (!medplum) {
    return NextResponse.json({
      mode: "local" as const,
      handoffs: listLocalHandoffs(),
      warning:
        "No MEDPLUM_CLIENT_SECRET — serving in-memory handoffs. Add client credentials for live FHIR.",
    });
  }

  try {
    await ensureServerLogin(medplum);
    const requests = await medplum.searchResources("ServiceRequest", {
      status: "active",
      _tag: `${TAG_SYSTEM}|${TAG_HANDOFF}`,
      _sort: "-_lastUpdated",
      _count: "10",
    });

    const handoffs: ActiveHandoff[] = [];

    for (const sr of requests) {
      const encounterRef = sr.encounter?.reference;
      let card: TraumaCard | null = null;

      if (encounterRef) {
        const comms = await medplum.searchResources("Communication", {
          encounter: encounterRef,
          _tag: `${TAG_SYSTEM}|${TAG_HANDOFF}`,
          _count: "1",
        });
        const payload = (comms[0] as Communication | undefined)?.payload?.[0]
          ?.contentString;
        if (payload) card = cardFromCommunicationPayload(payload);
      }

      if (!card) continue;

      handoffs.push({
        id: sr.id ?? crypto.randomUUID(),
        card,
        transmittedAt: sr.meta?.lastUpdated ?? sr.authoredOn ?? new Date().toISOString(),
        mode: "medplum",
        serviceRequestId: sr.id,
        encounterId: encounterRef?.replace("Encounter/", ""),
        patientId: sr.subject?.reference?.replace("Patient/", ""),
      });
    }

    return NextResponse.json({ mode: "medplum" as const, handoffs });
  } catch (err) {
    return NextResponse.json(
      {
        mode: "local" as const,
        handoffs: listLocalHandoffs(),
        warning: err instanceof Error ? err.message : "Medplum search failed",
      },
      { status: 200 },
    );
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const card = parseCard(body);
  if (!card) {
    return NextResponse.json({ error: "Expected { card: TraumaCard }" }, { status: 400 });
  }

  const medplum = getServerMedplum();
  const transmittedAt = new Date().toISOString();
  const bundle = buildHandoffTransaction({
    ...card,
    etaCapturedAt: card.etaCapturedAt ?? transmittedAt,
  });

  if (!medplum) {
    const handoff: ActiveHandoff = {
      id: crypto.randomUUID(),
      card,
      transmittedAt,
      mode: "local",
    };
    saveLocalHandoff(handoff);
    return NextResponse.json({
      ok: true,
      mode: "local" as const,
      handoff,
      warning:
        "Stored locally — set MEDPLUM_CLIENT_ID and MEDPLUM_CLIENT_SECRET for FHIR writes.",
    });
  }

  try {
    await ensureServerLogin(medplum);
    const result = (await medplum.executeBatch(bundle)) as Bundle;

    let serviceRequestId: string | undefined;
    let encounterId: string | undefined;
    let patientId: string | undefined;

    for (const entry of result.entry ?? []) {
      const res = entry.resource;
      if (!res || !("resourceType" in res)) continue;
      if (res.resourceType === "ServiceRequest") {
        serviceRequestId = (res as ServiceRequest).id;
      }
      if (res.resourceType === "Encounter") {
        encounterId = res.id;
      }
      if (res.resourceType === "Patient") {
        patientId = res.id;
      }
    }

    // Location headers are also on entry.response — prefer those if resource body omitted
    for (const entry of result.entry ?? []) {
      const loc = entry.response?.location;
      if (!loc) continue;
      if (loc.startsWith("ServiceRequest/") && !serviceRequestId) {
        serviceRequestId = loc.split("/")[1]?.split("/_")[0];
      }
      if (loc.startsWith("Encounter/") && !encounterId) {
        encounterId = loc.split("/")[1]?.split("/_")[0];
      }
      if (loc.startsWith("Patient/") && !patientId) {
        patientId = loc.split("/")[1]?.split("/_")[0];
      }
    }

    const handoff: ActiveHandoff = {
      id: serviceRequestId ?? crypto.randomUUID(),
      card,
      transmittedAt,
      mode: "medplum",
      serviceRequestId,
      encounterId,
      patientId,
    };

    // Keep a local copy so hospital polling works even before search indexes catch up
    saveLocalHandoff(handoff);

    return NextResponse.json({ ok: true, mode: "medplum" as const, handoff, bundle: result });
  } catch (err) {
    const handoff: ActiveHandoff = {
      id: crypto.randomUUID(),
      card,
      transmittedAt,
      mode: "local",
    };
    saveLocalHandoff(handoff);
    return NextResponse.json({
      ok: true,
      mode: "local" as const,
      handoff,
      warning: err instanceof Error ? err.message : "Medplum transmit failed; stored locally",
    });
  }
}
