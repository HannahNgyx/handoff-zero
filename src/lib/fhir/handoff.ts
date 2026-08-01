import { MedplumClient } from "@medplum/core";
import type {
  AllergyIntolerance,
  Bundle,
  Communication,
  Condition,
  Encounter,
  Observation,
  Patient,
  ServiceRequest,
  Task,
} from "@medplum/fhirtypes";
import { EMPTY_TRAUMA_CARD, type ActiveHandoff, type TraumaCard } from "@/lib/trauma";

export type { ActiveHandoff };

export const TAG_SYSTEM = "https://traumatink.app/fhir/tag";
export const TAG_HANDOFF = "prearrival-handoff";
export const TAG_ACCEPTANCE = "acceptance-ack";
export const TAG_INFO_REQUEST = "info-request";
export const TAG_ORAL_INTAKE = "oral-intake";
export const SR_CODE_SYSTEM = "https://traumatink.app/fhir/CodeSystem/handoff";
export const SR_CODE_TRANSFER = "hospital-transfer-request";

export const ORAL_INTAKE_CODING = {
  system: "http://loinc.org",
  code: "11370-4",
  display: "History of food and drink intake",
} as const;

/** Incoming (draft) + confirmed (active) pre-arrival ServiceRequests. */
export const HANDOFF_SR_CRITERIA = `ServiceRequest?status=draft,active&_tag=${TAG_SYSTEM}|${TAG_HANDOFF}`;
export const ACCEPTANCE_COMM_CRITERIA = `Communication?_tag=${TAG_SYSTEM}|${TAG_ACCEPTANCE}`;
export const INFO_REQUEST_COMM_CRITERIA = `Communication?_tag=${TAG_SYSTEM}|${TAG_INFO_REQUEST}`;
export const ORAL_INTAKE_OBS_CRITERIA = `Observation?_tag=${TAG_SYSTEM}|${TAG_ORAL_INTAKE}`;
export const HANDOFF_COMM_CRITERIA = `Communication?_tag=${TAG_SYSTEM}|${TAG_HANDOFF}`;

export const INFO_REQUEST_ORAL_INTAKE_MESSAGE =
  "The hospital needs the patient's last known oral intake. Please ask the paramedic now.";

export const PREP_TASKS = [
  { description: "Prepare trauma bay", assignee: "Charge nurse" },
  { description: "Create temporary incoming encounter", assignee: "Registration" },
  { description: "Review EMS handoff", assignee: "Clinical team" },
] as const;

function metaTag(extra?: { code: string; display: string }) {
  const tags = [
    { system: TAG_SYSTEM, code: TAG_HANDOFF, display: "TraumaLink handoff" },
  ];
  if (extra) {
    tags.push({ system: TAG_SYSTEM, code: extra.code, display: extra.display });
  }
  return tags;
}

function parseLocationId(location: string | undefined, resourceType: string): string | undefined {
  if (!location?.startsWith(`${resourceType}/`)) return undefined;
  return location.split("/")[1]?.split("/_")[0];
}

export function handoffFromBatchResult(
  card: TraumaCard,
  result: Bundle,
  handoffStatus: ActiveHandoff["handoffStatus"] = "incoming",
): ActiveHandoff {
  let serviceRequestId: string | undefined;
  let encounterId: string | undefined;
  let patientId: string | undefined;
  let communicationId: string | undefined;

  for (const entry of result.entry ?? []) {
    const res = entry.resource;
    if (res && "resourceType" in res) {
      if (res.resourceType === "ServiceRequest" && res.id) serviceRequestId = res.id;
      if (res.resourceType === "Encounter" && res.id) encounterId = res.id;
      if (res.resourceType === "Patient" && res.id) patientId = res.id;
      if (res.resourceType === "Communication" && res.id) communicationId = res.id;
    }
    const loc = entry.response?.location;
    serviceRequestId ??= parseLocationId(loc, "ServiceRequest");
    encounterId ??= parseLocationId(loc, "Encounter");
    patientId ??= parseLocationId(loc, "Patient");
    communicationId ??= parseLocationId(loc, "Communication");
  }

  const transmittedAt = new Date().toISOString();
  return {
    id: serviceRequestId ?? crypto.randomUUID(),
    card,
    transmittedAt,
    mode: "medplum",
    handoffStatus,
    serviceRequestId,
    encounterId,
    patientId,
    communicationId,
  };
}

function summaryFromCard(card: TraumaCard): string {
  return [
    card.age != null && card.sex ? `${card.age}${card.sex === "female" ? "F" : "M"}` : null,
    card.mechanism,
    card.vitals.bpSystolic != null
      ? `BP ${card.vitals.bpSystolic}/${card.vitals.bpDiastolic}`
      : null,
    card.vitals.heartRate != null ? `HR ${card.vitals.heartRate}` : null,
    card.injury,
    card.allergy ? `Allergy ${card.allergy}` : null,
    card.etaMinutes != null ? `ETA ${card.etaMinutes} min` : null,
  ]
    .filter(Boolean)
    .join(". ");
}

export async function loadActiveHandoffs(medplum: MedplumClient): Promise<ActiveHandoff[]> {
  const requests = await medplum.searchResources("ServiceRequest", {
    status: "draft,active",
    _tag: `${TAG_SYSTEM}|${TAG_HANDOFF}`,
    _sort: "-_lastUpdated",
    _count: "10",
  });

  const handoffs: ActiveHandoff[] = [];

  for (const sr of requests) {
    const encounterRef = sr.encounter?.reference;
    let card: TraumaCard | null = null;
    let communicationId: string | undefined;

    if (encounterRef) {
      const comms = await medplum.searchResources("Communication", {
        encounter: encounterRef,
        _tag: `${TAG_SYSTEM}|${TAG_HANDOFF}`,
        _count: "5",
      });
      for (const c of comms) {
        const payload = c.payload?.[0]?.contentString;
        if (!payload) continue;
        card = cardFromCommunicationPayload(payload);
        if (card) {
          communicationId = c.id;
          break;
        }
      }
    }

    // Allow empty draft shells so hospital sees Incoming at call start.
    if (!card) {
      card = { ...EMPTY_TRAUMA_CARD };
    }

    const encounterId = encounterRef?.replace("Encounter/", "");
    const oral = await loadOralIntake(medplum, encounterId);
    if (oral) card = { ...card, lastOralIntake: oral };

    handoffs.push({
      id: sr.id ?? crypto.randomUUID(),
      card,
      transmittedAt: sr.meta?.lastUpdated ?? sr.authoredOn ?? new Date().toISOString(),
      mode: "medplum",
      handoffStatus: sr.status === "active" ? "confirmed" : "incoming",
      serviceRequestId: sr.id,
      encounterId,
      patientId: sr.subject?.reference?.replace("Patient/", ""),
      communicationId,
    });
  }

  return handoffs;
}

/** Call start: create Patient/Encounter/Communication + draft ServiceRequest. */
export async function createDraftHandoff(
  medplum: MedplumClient,
  card: TraumaCard,
): Promise<ActiveHandoff> {
  const bundle = buildHandoffTransaction(card, "draft");
  const result = (await medplum.executeBatch(bundle)) as Bundle;
  return handoffFromBatchResult(card, result, "incoming");
}

/** Live-sync card JSON on the handoff Communication while Incoming. */
export async function patchHandoffCard(
  medplum: MedplumClient,
  handoff: ActiveHandoff,
  card: TraumaCard,
): Promise<ActiveHandoff> {
  let communicationId = handoff.communicationId;

  if (!communicationId && handoff.encounterId) {
    const comms = await medplum.searchResources("Communication", {
      encounter: `Encounter/${handoff.encounterId}`,
      _tag: `${TAG_SYSTEM}|${TAG_HANDOFF}`,
      _count: "1",
    });
    communicationId = comms[0]?.id;
  }

  if (!communicationId) {
    throw new Error("Missing Communication id for handoff patch");
  }

  const existing = await medplum.readResource("Communication", communicationId);
  await medplum.updateResource<Communication>({
    ...existing,
    payload: [
      {
        contentString: JSON.stringify({
          summary: summaryFromCard(card),
          card,
        }),
      },
    ],
  });

  return {
    ...handoff,
    card,
    communicationId,
    transmittedAt: new Date().toISOString(),
  };
}

/** EMS Confirm: final card patch + promote ServiceRequest draft → active. */
export async function confirmHandoff(
  medplum: MedplumClient,
  handoff: ActiveHandoff,
  card: TraumaCard,
): Promise<ActiveHandoff> {
  if (!handoff.serviceRequestId) {
    throw new Error("Missing ServiceRequest id");
  }

  const patched = await patchHandoffCard(medplum, handoff, card);
  const sr = await medplum.readResource("ServiceRequest", handoff.serviceRequestId);
  await medplum.updateResource<ServiceRequest>({
    ...sr,
    status: "active",
    note:
      card.etaMinutes != null
        ? [{ text: `ETA ${card.etaMinutes} minutes · confirmed` }]
        : [{ text: "Handoff confirmed by EMS" }],
  });

  return {
    ...patched,
    handoffStatus: "confirmed",
    transmittedAt: new Date().toISOString(),
  };
}

export async function loadOralIntake(
  medplum: MedplumClient,
  encounterId: string | undefined,
): Promise<string | null> {
  if (!encounterId) return null;
  const obs = await medplum.searchResources("Observation", {
    encounter: `Encounter/${encounterId}`,
    _tag: `${TAG_SYSTEM}|${TAG_ORAL_INTAKE}`,
    _sort: "-_lastUpdated",
    _count: "1",
  });
  return obs[0]?.valueString ?? null;
}

/** Hospital → EMS: ask for last oral intake via tagged Communication. */
export async function requestMoreInfo(
  medplum: MedplumClient,
  handoff: ActiveHandoff,
): Promise<Communication> {
  const patientRef = handoff.patientId
    ? { reference: `Patient/${handoff.patientId}` }
    : undefined;
  const encounterRef = handoff.encounterId
    ? { reference: `Encounter/${handoff.encounterId}` }
    : undefined;

  return medplum.createResource<Communication>({
    resourceType: "Communication",
    meta: {
      tag: metaTag({ code: TAG_INFO_REQUEST, display: "Info request" }),
    },
    status: "in-progress",
    category: [{ text: "Request more information" }],
    subject: patientRef as Communication["subject"],
    encounter: encounterRef,
    payload: [
      {
        contentString: JSON.stringify({
          type: "info-request",
          topic: "last-oral-intake",
          message: INFO_REQUEST_ORAL_INTAKE_MESSAGE,
          serviceRequestId: handoff.serviceRequestId,
          encounterId: handoff.encounterId,
        }),
      },
    ],
  });
}

/** EMS → hospital: write last oral intake as Observation after voice update_field. */
export async function writeOralIntakeObservation(
  medplum: MedplumClient,
  handoff: ActiveHandoff,
  value: string,
): Promise<Observation> {
  if (!handoff.patientId || !handoff.encounterId) {
    throw new Error("Missing patient/encounter for oral intake Observation");
  }

  return medplum.createResource<Observation>({
    resourceType: "Observation",
    meta: {
      tag: metaTag({ code: TAG_ORAL_INTAKE, display: "Last oral intake" }),
    },
    status: "final",
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/observation-category",
            code: "survey",
          },
        ],
      },
    ],
    code: {
      coding: [{ ...ORAL_INTAKE_CODING }],
      text: "Last oral intake",
    },
    subject: { reference: `Patient/${handoff.patientId}` },
    encounter: { reference: `Encounter/${handoff.encounterId}` },
    effectiveDateTime: new Date().toISOString(),
    valueString: value,
  });
}

export async function loadPrepTasks(
  medplum: MedplumClient,
  encounterId: string | undefined,
): Promise<Task[]> {
  if (!encounterId) return [];
  return medplum.searchResources("Task", {
    encounter: `Encounter/${encounterId}`,
    _tag: `${TAG_SYSTEM}|${TAG_HANDOFF}`,
    _sort: "-_lastUpdated",
    _count: "10",
  });
}

export async function acceptHandoff(
  medplum: MedplumClient,
  handoff: ActiveHandoff,
): Promise<{ tasks: Task[]; communication: Communication }> {
  if (!handoff.serviceRequestId) {
    throw new Error("Missing ServiceRequest id");
  }

  const sr = await medplum.readResource("ServiceRequest", handoff.serviceRequestId);
  await medplum.updateResource({
    ...sr,
    status: "completed",
  });

  const patientRef = sr.subject;
  const encounterRef = sr.encounter;

  const tasks: Task[] = [];
  for (const def of PREP_TASKS) {
    const task = await medplum.createResource<Task>({
      resourceType: "Task",
      meta: { tag: metaTag() },
      status: "requested",
      intent: "order",
      description: def.description,
      code: { text: def.description },
      for: patientRef,
      encounter: encounterRef,
      authoredOn: new Date().toISOString(),
      note: [{ text: `Assigned: ${def.assignee}` }],
      input: [
        {
          type: { text: "trauma-bay" },
          valueString: "2",
        },
      ],
    });
    tasks.push(task);
  }

  const communication = await medplum.createResource<Communication>({
    resourceType: "Communication",
    meta: {
      tag: metaTag({ code: TAG_ACCEPTANCE, display: "Acceptance acknowledgment" }),
    },
    status: "completed",
    category: [{ text: "Transfer acceptance" }],
    subject: patientRef as Communication["subject"],
    encounter: encounterRef,
    payload: [
      {
        contentString: JSON.stringify({
          type: "acceptance",
          message:
            "Central Hospital accepted the patient. Trauma Bay 2 is being prepared.",
          traumaBay: "2",
          serviceRequestId: handoff.serviceRequestId,
        }),
      },
    ],
  });

  return { tasks, communication };
}

export function buildHandoffTransaction(
  card: TraumaCard,
  serviceRequestStatus: "draft" | "active" = "draft",
): Bundle {
  const patientUrn = `urn:uuid:${crypto.randomUUID()}`;
  const encounterUrn = `urn:uuid:${crypto.randomUUID()}`;

  const sexCode =
    card.sex === "female"
      ? "female"
      : card.sex === "male"
        ? "male"
        : card.sex === "other"
          ? "other"
          : "unknown";

  const patient: Patient = {
    resourceType: "Patient",
    meta: { tag: metaTag() },
    gender: sexCode,
    ...(card.age != null
      ? {
          extension: [
            {
              url: "https://traumatink.app/fhir/StructureDefinition/estimated-age",
              valueInteger: card.age,
            },
          ],
        }
      : {}),
  };

  const encounter: Encounter = {
    resourceType: "Encounter",
    meta: { tag: metaTag() },
    status: "arrived",
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "EMER",
      display: "emergency",
    },
    subject: { reference: patientUrn },
    period: { start: new Date().toISOString() },
    reasonCode: card.mechanism ? [{ text: card.mechanism }] : undefined,
  };

  const observations: Observation[] = [];

  if (card.vitals.bpSystolic != null && card.vitals.bpDiastolic != null) {
    observations.push({
      resourceType: "Observation",
      meta: { tag: metaTag() },
      status: "final",
      category: [
        {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "vital-signs",
            },
          ],
        },
      ],
      code: {
        coding: [
          {
            system: "http://loinc.org",
            code: "85354-9",
            display: "Blood pressure panel",
          },
        ],
        text: "Blood pressure",
      },
      subject: { reference: patientUrn },
      encounter: { reference: encounterUrn },
      component: [
        {
          code: {
            coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic" }],
          },
          valueQuantity: {
            value: card.vitals.bpSystolic,
            unit: "mmHg",
            system: "http://unitsofmeasure.org",
            code: "mm[Hg]",
          },
        },
        {
          code: {
            coding: [{ system: "http://loinc.org", code: "8462-4", display: "Diastolic" }],
          },
          valueQuantity: {
            value: card.vitals.bpDiastolic,
            unit: "mmHg",
            system: "http://unitsofmeasure.org",
            code: "mm[Hg]",
          },
        },
      ],
    });
  }

  if (card.vitals.heartRate != null) {
    observations.push({
      resourceType: "Observation",
      meta: { tag: metaTag() },
      status: "final",
      category: [
        {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "vital-signs",
            },
          ],
        },
      ],
      code: {
        coding: [
          { system: "http://loinc.org", code: "8867-4", display: "Heart rate" },
        ],
        text: "Heart rate",
      },
      subject: { reference: patientUrn },
      encounter: { reference: encounterUrn },
      valueQuantity: {
        value: card.vitals.heartRate,
        unit: "/min",
        system: "http://unitsofmeasure.org",
        code: "/min",
      },
    });
  }

  if (card.vitals.gcs != null) {
    observations.push({
      resourceType: "Observation",
      meta: { tag: metaTag() },
      status: "final",
      code: {
        coding: [
          {
            system: "http://loinc.org",
            code: "9269-2",
            display: "Glasgow coma score total",
          },
        ],
        text: "GCS",
      },
      subject: { reference: patientUrn },
      encounter: { reference: encounterUrn },
      valueInteger: card.vitals.gcs,
    });
  }

  const resources: Array<
    | Patient
    | Encounter
    | Observation
    | Condition
    | AllergyIntolerance
    | Communication
    | ServiceRequest
  > = [patient, encounter, ...observations];

  if (card.injury) {
    resources.push({
      resourceType: "Condition",
      meta: { tag: metaTag() },
      clinicalStatus: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
            code: "active",
          },
        ],
      },
      verificationStatus: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
            code: "provisional",
          },
        ],
      },
      code: { text: card.injury },
      subject: { reference: patientUrn },
      encounter: { reference: encounterUrn },
    });
  }

  if (card.allergy) {
    resources.push({
      resourceType: "AllergyIntolerance",
      meta: { tag: metaTag() },
      clinicalStatus: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
            code: "active",
          },
        ],
      },
      verificationStatus: {
        coding: [
          {
            system:
              "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
            code: "confirmed",
          },
        ],
      },
      type: "allergy",
      category: ["medication"],
      criticality: "high",
      code: { text: card.allergy },
      patient: { reference: patientUrn },
      encounter: { reference: encounterUrn },
    });
  }

  resources.push({
    resourceType: "Communication",
    meta: { tag: metaTag() },
    status: "completed",
    category: [{ text: "EMS trauma handoff" }],
    subject: { reference: patientUrn },
    encounter: { reference: encounterUrn },
    payload: [
      {
        contentString: JSON.stringify({
          summary: summaryFromCard(card),
          card,
        }),
      },
    ],
  });

  resources.push({
    resourceType: "ServiceRequest",
    meta: { tag: metaTag() },
    status: serviceRequestStatus,
    intent: "order",
    code: {
      coding: [
        {
          system: SR_CODE_SYSTEM,
          code: SR_CODE_TRANSFER,
          display: "Hospital transfer acceptance request",
        },
      ],
      text:
        serviceRequestStatus === "draft"
          ? "Incoming pre-arrival handoff (unconfirmed)"
          : "Request hospital acceptance",
    },
    subject: { reference: patientUrn },
    encounter: { reference: encounterUrn },
    authoredOn: new Date().toISOString(),
    note: card.etaMinutes != null ? [{ text: `ETA ${card.etaMinutes} minutes` }] : undefined,
  });

  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: resources.map((resource) => {
      const isPatient = resource.resourceType === "Patient";
      const isEncounter = resource.resourceType === "Encounter";
      const fullUrl = isPatient
        ? patientUrn
        : isEncounter
          ? encounterUrn
          : `urn:uuid:${crypto.randomUUID()}`;
      return {
        fullUrl,
        resource,
        request: {
          method: "POST" as const,
          url: resource.resourceType,
        },
      };
    }),
  };
}

export function cardFromCommunicationPayload(raw: string): TraumaCard | null {
  try {
    const parsed = JSON.parse(raw) as { card?: TraumaCard };
    return parsed.card ?? null;
  } catch {
    return null;
  }
}

export function acceptanceMessageFromPayload(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { type?: string; message?: string };
    if (parsed.type === "acceptance" && parsed.message) return parsed.message;
    return null;
  } catch {
    return null;
  }
}

export function infoRequestMessageFromPayload(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { type?: string; message?: string };
    if (parsed.type === "info-request" && parsed.message) return parsed.message;
    return null;
  } catch {
    return null;
  }
}
