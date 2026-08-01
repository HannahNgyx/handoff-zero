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
} from "@medplum/fhirtypes";
import type { ActiveHandoff, TraumaCard } from "@/lib/trauma";

export type { ActiveHandoff };

export const TAG_SYSTEM = "https://traumatink.app/fhir/tag";
export const TAG_HANDOFF = "prearrival-handoff";
export const SR_CODE_SYSTEM = "https://traumatink.app/fhir/CodeSystem/handoff";
export const SR_CODE_TRANSFER = "hospital-transfer-request";

/** In-memory fallback when Medplum client credentials are missing. */
const localHandoffs = new Map<string, ActiveHandoff>();

export function listLocalHandoffs(): ActiveHandoff[] {
  return [...localHandoffs.values()].sort((a, b) =>
    b.transmittedAt.localeCompare(a.transmittedAt),
  );
}

export function saveLocalHandoff(handoff: ActiveHandoff): void {
  localHandoffs.set(handoff.id, handoff);
}

export function getServerMedplum(): MedplumClient | null {
  const baseUrl =
    process.env.NEXT_PUBLIC_MEDPLUM_BASE_URL || "https://api.medplum.com/";
  const clientId =
    process.env.MEDPLUM_CLIENT_ID || process.env.NEXT_PUBLIC_MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return new MedplumClient({ baseUrl, clientId, clientSecret });
}

export async function ensureServerLogin(medplum: MedplumClient): Promise<void> {
  const clientId =
    process.env.MEDPLUM_CLIENT_ID || process.env.NEXT_PUBLIC_MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET");
  }
  await medplum.startClientLogin(clientId, clientSecret);
}

function metaTag() {
  return [{ system: TAG_SYSTEM, code: TAG_HANDOFF, display: "TraumaLink handoff" }];
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
    reasonCode: card.mechanism
      ? [{ text: card.mechanism }]
      : undefined,
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
    Patient | Encounter | Observation | Condition | AllergyIntolerance | Communication | ServiceRequest
  > = [patient, encounter, ...observations];

  if (card.injury) {
    const condition: Condition = {
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
    };
    resources.push(condition);
  }

  if (card.allergy) {
    const allergy: AllergyIntolerance = {
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
    };
    resources.push(allergy);
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

  const communication: Communication = {
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
  };
  resources.push(communication);

  const serviceRequest: ServiceRequest = {
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
  };
  resources.push(serviceRequest);

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

/** Reconstruct a TraumaCard from Communication payload or extension-ish fields. */
export function cardFromCommunicationPayload(raw: string): TraumaCard | null {
  try {
    const parsed = JSON.parse(raw) as { card?: TraumaCard };
    return parsed.card ?? null;
  } catch {
    return null;
  }
}
