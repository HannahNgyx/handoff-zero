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
import type { ActiveHandoff, TraumaCard } from "@/lib/trauma";

export type { ActiveHandoff };

export const TAG_SYSTEM = "https://traumatink.app/fhir/tag";
export const TAG_HANDOFF = "prearrival-handoff";
export const TAG_ACCEPTANCE = "acceptance-ack";
export const SR_CODE_SYSTEM = "https://traumatink.app/fhir/CodeSystem/handoff";
export const SR_CODE_TRANSFER = "hospital-transfer-request";

export const HANDOFF_SR_CRITERIA = `ServiceRequest?status=active&_tag=${TAG_SYSTEM}|${TAG_HANDOFF}`;
export const ACCEPTANCE_COMM_CRITERIA = `Communication?_tag=${TAG_SYSTEM}|${TAG_ACCEPTANCE}`;

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

export function handoffFromBatchResult(card: TraumaCard, result: Bundle): ActiveHandoff {
  let serviceRequestId: string | undefined;
  let encounterId: string | undefined;
  let patientId: string | undefined;

  for (const entry of result.entry ?? []) {
    const res = entry.resource;
    if (res && "resourceType" in res) {
      if (res.resourceType === "ServiceRequest" && res.id) serviceRequestId = res.id;
      if (res.resourceType === "Encounter" && res.id) encounterId = res.id;
      if (res.resourceType === "Patient" && res.id) patientId = res.id;
    }
    const loc = entry.response?.location;
    serviceRequestId ??= parseLocationId(loc, "ServiceRequest");
    encounterId ??= parseLocationId(loc, "Encounter");
    patientId ??= parseLocationId(loc, "Patient");
  }

  const transmittedAt = new Date().toISOString();
  return {
    id: serviceRequestId ?? crypto.randomUUID(),
    card,
    transmittedAt,
    mode: "medplum",
    serviceRequestId,
    encounterId,
    patientId,
  };
}

export async function loadActiveHandoffs(medplum: MedplumClient): Promise<ActiveHandoff[]> {
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
        _count: "5",
      });
      for (const c of comms) {
        const payload = c.payload?.[0]?.contentString;
        if (!payload) continue;
        card = cardFromCommunicationPayload(payload);
        if (card) break;
      }
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

  return handoffs;
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

export function buildHandoffTransaction(card: TraumaCard): Bundle {
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

  const summaryParts = [
    card.age != null && card.sex ? `${card.age}${card.sex === "female" ? "F" : "M"}` : null,
    card.mechanism,
    card.vitals.bpSystolic != null
      ? `BP ${card.vitals.bpSystolic}/${card.vitals.bpDiastolic}`
      : null,
    card.vitals.heartRate != null ? `HR ${card.vitals.heartRate}` : null,
    card.injury,
    card.allergy ? `Allergy ${card.allergy}` : null,
    card.etaMinutes != null ? `ETA ${card.etaMinutes} min` : null,
  ].filter(Boolean);

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
          summary: summaryParts.join(". "),
          card,
        }),
      },
    ],
  });

  resources.push({
    resourceType: "ServiceRequest",
    meta: { tag: metaTag() },
    status: "active",
    intent: "order",
    code: {
      coding: [
        {
          system: SR_CODE_SYSTEM,
          code: SR_CODE_TRANSFER,
          display: "Hospital transfer acceptance request",
        },
      ],
      text: "Request hospital acceptance",
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
