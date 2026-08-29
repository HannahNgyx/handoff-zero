/** Shared trauma handoff types for EMS ↔ hospital UI. */

export type VitalFlag = "LOW" | "HIGH" | "CRITICAL" | null;

export interface TraumaVitals {
  bpSystolic: number | null;
  bpDiastolic: number | null;
  heartRate: number | null;
  gcs: number | null;
}

export interface TraumaCard {
  age: number | null;
  sex: "female" | "male" | "other" | "unknown" | null;
  mechanism: string | null;
  vitals: TraumaVitals;
  injury: string | null;
  allergy: string | null;
  anticoagulants: string | null;
  bloodType: string | null;
  lastOralIntake: string | null;
  emergencyContact: string | null;
  /** ETA in whole minutes from now when handoff was captured */
  etaMinutes: number | null;
  etaCapturedAt: string | null;
}

export const EMPTY_TRAUMA_CARD: TraumaCard = {
  age: null,
  sex: null,
  mechanism: null,
  vitals: {
    bpSystolic: null,
    bpDiastolic: null,
    heartRate: null,
    gcs: null,
  },
  injury: null,
  allergy: null,
  anticoagulants: null,
  bloodType: null,
  lastOralIntake: null,
  emergencyContact: null,
  etaMinutes: null,
  etaCapturedAt: null,
};

/** Demo script — motorcycle collision handoff. */
export const DEMO_TRAUMA_CARD: TraumaCard = {
  age: 27,
  sex: "female",
  mechanism: "Motorcycle collision",
  vitals: {
    bpSystolic: 92,
    bpDiastolic: 60,
    heartRate: 128,
    gcs: 13,
  },
  injury: "Suspected left femur fracture",
  allergy: "PENICILLIN",
  anticoagulants: "None reported",
  bloodType: null,
  lastOralIntake: null,
  emergencyContact: null,
  etaMinutes: 6,
  etaCapturedAt: null,
};

export type HandoffStatus = "incoming" | "confirmed";

export type ActiveHandoff = {
  id: string;
  card: TraumaCard;
  transmittedAt: string;
  mode: "medplum";
  /** draft SR = incoming; active SR = confirmed by EMS */
  handoffStatus: HandoffStatus;
  serviceRequestId?: string;
  encounterId?: string;
  patientId?: string;
  communicationId?: string;
};

const MISSING_CHECKS: { key: keyof TraumaCard; label: string }[] = [
  { key: "bloodType", label: "Blood type" },
  { key: "lastOralIntake", label: "Last oral intake" },
  { key: "emergencyContact", label: "Emergency contact" },
];

export function getMissingFields(card: TraumaCard): string[] {
  return MISSING_CHECKS.filter(({ key }) => !card[key]).map(({ label }) => label);
}

export function flagBp(systolic: number | null): VitalFlag {
  if (systolic == null) return null;
  if (systolic < 90) return "LOW";
  if (systolic > 180) return "HIGH";
  return null;
}

export function flagHr(hr: number | null): VitalFlag {
  if (hr == null) return null;
  if (hr < 50) return "LOW";
  if (hr > 100) return "HIGH";
  return null;
}

export function flagGcs(gcs: number | null): VitalFlag {
  if (gcs == null) return null;
  if (gcs <= 8) return "CRITICAL";
  if (gcs <= 12) return "HIGH";
  return null;
}

export function calculateShockIndex(
  hr: number | null,
  sbp: number | null,
): { value: number; flag: "NORMAL" | "ELEVATED" | "CRITICAL" } | null {
  if (hr == null || sbp == null || sbp === 0) return null;
  const val = Number((hr / sbp).toFixed(2));
  const flag = val >= 1.0 ? "CRITICAL" : val >= 0.9 ? "ELEVATED" : "NORMAL";
  return { value: val, flag };
}

export interface TraumaTriageAssessment {
  level: "LEVEL 1 TRAUMA" | "LEVEL 2 TRAUMA" | "ROUTINE";
  reasons: string[];
}

export function getTraumaTriageAssessment(card: TraumaCard): TraumaTriageAssessment {
  const reasons: string[] = [];
  const si = calculateShockIndex(card.vitals.heartRate, card.vitals.bpSystolic);

  // Level 1 Physiological & Anatomical Criteria (CDC / ACS Guidelines)
  if (card.vitals.bpSystolic != null && card.vitals.bpSystolic < 90) {
    reasons.push("Hypotension (SBP < 90)");
  }
  if (card.vitals.gcs != null && card.vitals.gcs <= 13) {
    reasons.push(`Altered Mental Status (GCS ${card.vitals.gcs} ≤ 13)`);
  }
  if (si && si.flag === "CRITICAL") {
    reasons.push(`Critical Shock Index (${si.value} ≥ 1.0)`);
  }
  if (card.injury && /femur|pelvis|pelvic|amputation|penetrating|crush|flail/i.test(card.injury)) {
    reasons.push(`High-acuity anatomical injury: ${card.injury}`);
  }

  if (reasons.length > 0) {
    return { level: "LEVEL 1 TRAUMA", reasons };
  }

  // Level 2 High-Risk Mechanism / Special Criteria
  if (card.mechanism && /motorcycle|pedestrian|ejection|rollover|fall.*(10|15|20|height)/i.test(card.mechanism)) {
    reasons.push(`High-risk mechanism: ${card.mechanism}`);
  }
  if (card.anticoagulants && !/none/i.test(card.anticoagulants)) {
    reasons.push(`Anticoagulation alert: ${card.anticoagulants}`);
  }
  if (card.age != null && card.age >= 65) {
    reasons.push(`Geriatric trauma risk (Age ${card.age} ≥ 65)`);
  }

  if (reasons.length > 0) {
    return { level: "LEVEL 2 TRAUMA", reasons };
  }

  return { level: "ROUTINE", reasons: ["Standard trauma assessment"] };
}

export interface DemoPreset {
  id: string;
  name: string;
  card: TraumaCard;
  reportText: string;
}

export const DEMO_PRESETS: DemoPreset[] = [
  {
    id: "motorcycle",
    name: "Motorcycle Crash (27F · Femur Fx · GCS 13)",
    card: DEMO_TRAUMA_CARD,
    reportText:
      "Incoming 27-year-old female, motorcycle collision. Blood pressure 92 over 60, heart rate 128, GCS 13. Possible left femur fracture. Allergic to penicillin. No known anticoagulants. ETA six minutes.",
  },
  {
    id: "pedestrian",
    name: "Pedestrian vs Auto (45M · Unresponsive · Shock)",
    card: {
      age: 45,
      sex: "male",
      mechanism: "Pedestrian struck by vehicle at 35mph",
      vitals: {
        bpSystolic: 84,
        bpDiastolic: 48,
        heartRate: 138,
        gcs: 8,
      },
      injury: "Suspected unstable pelvic fracture and thoracic trauma",
      allergy: "No known drug allergies",
      anticoagulants: "Warfarin",
      bloodType: "O-",
      lastOralIntake: "Unknown",
      emergencyContact: "Wife at 555-0192",
      etaMinutes: 4,
      etaCapturedAt: null,
    },
    reportText:
      "Incoming 45-year-old male, pedestrian struck by auto. Blood pressure 84 over 48, heart rate 138, GCS 8. Unstable pelvic fracture. Patient on Warfarin. Blood type O negative. ETA 4 minutes.",
  },
  {
    id: "elderly_fall",
    name: "Fall from Roof (68M · Head Strike · Eliquis)",
    card: {
      age: 68,
      sex: "male",
      mechanism: "Fall from 15-foot roof",
      vitals: {
        bpSystolic: 168,
        bpDiastolic: 92,
        heartRate: 82,
        gcs: 14,
      },
      injury: "Right parietal scalp laceration with loss of consciousness",
      allergy: "Sulfa drugs",
      anticoagulants: "Eliquis 5mg BID",
      bloodType: "A+",
      lastOralIntake: "Breakfast at 7:30 AM",
      emergencyContact: "Son: 555-0144",
      etaMinutes: 8,
      etaCapturedAt: null,
    },
    reportText:
      "Incoming 68-year-old male, fall from 15-foot roof with brief LOC. Blood pressure 168 over 92, heart rate 82, GCS 14. Scalp laceration. Allergic to sulfa. On Eliquis. Blood type A positive. ETA eight minutes.",
  },
];

export function formatBp(card: TraumaCard): string {
  const { bpSystolic, bpDiastolic } = card.vitals;
  if (bpSystolic == null && bpDiastolic == null) return "—";
  if (bpSystolic != null && bpDiastolic != null) {
    return `${bpSystolic}/${bpDiastolic}`;
  }
  if (bpSystolic != null) return `${bpSystolic}/—`;
  return `—/${bpDiastolic}`;
}

/** Remaining ms until ETA deadline from etaCapturedAt + etaMinutes. */
export function etaRemainingMs(card: TraumaCard, now = Date.now()): number | null {
  if (card.etaMinutes == null) return null;
  if (!card.etaCapturedAt) return card.etaMinutes * 60_000;
  const deadline =
    new Date(card.etaCapturedAt).getTime() + card.etaMinutes * 60_000;
  return deadline - now;
}

/** Live countdown as MM:SS (or static MM:00 if capture time missing). */
export function formatEtaCountdown(card: TraumaCard, now = Date.now()): string {
  if (card.etaMinutes == null) return "—";
  if (!card.etaCapturedAt) {
    return `${String(card.etaMinutes).padStart(2, "0")}:00`;
  }
  const remaining = etaRemainingMs(card, now) ?? 0;
  if (remaining <= 0) return "00:00";
  const totalSec = Math.ceil(remaining / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function etaIsOverdue(card: TraumaCard, now = Date.now()): boolean {
  const remaining = etaRemainingMs(card, now);
  return remaining != null && !!card.etaCapturedAt && remaining <= 0;
}

export function patientLine(card: TraumaCard): string {
  const age = card.age != null ? String(card.age) : "?";
  const sex =
    card.sex === "female"
      ? "F"
      : card.sex === "male"
        ? "M"
        : card.sex === "other"
          ? "X"
          : "?";
  const mech = card.mechanism ?? "Unknown mechanism";
  return `${age}${sex} · ${mech}`;
}

/** TraumaLink client rules — not Medplum Tasks, not Deepgram voice AI. */
export function getSuggestedAsks(card: TraumaCard): string[] {
  const asks = getMissingFields(card).map((label) => `Ask EMS for ${label.toLowerCase()}`);
  if (flagBp(card.vitals.bpSystolic) === "LOW") {
    asks.unshift("Consider hypotensive protocol — confirm BP trend with EMS");
  }
  if (flagHr(card.vitals.heartRate) === "HIGH") {
    asks.unshift("Tachycardia flagged — ask EMS for latest HR / rhythm notes");
  }
  return asks;
}

export function caseShortId(handoff: Pick<ActiveHandoff, "serviceRequestId" | "id">): string {
  const raw = handoff.serviceRequestId ?? handoff.id;
  return raw.slice(-4).toUpperCase();
}

export function caseTitle(handoff: ActiveHandoff): string {
  const hasClinical =
    handoff.card.age != null ||
    handoff.card.mechanism ||
    handoff.card.vitals.bpSystolic != null ||
    handoff.card.injury;
  return hasClinical ? patientLine(handoff.card) : "Awaiting clinical details…";
}

/** Confirmed first, then soonest ETA, then newest. */
export function sortHandoffs(list: ActiveHandoff[]): ActiveHandoff[] {
  return [...list].sort((a, b) => {
    if (a.handoffStatus !== b.handoffStatus) {
      return a.handoffStatus === "confirmed" ? -1 : 1;
    }
    const etaA = a.card.etaMinutes ?? 999;
    const etaB = b.card.etaMinutes ?? 999;
    if (etaA !== etaB) return etaA - etaB;
    return (b.transmittedAt || "").localeCompare(a.transmittedAt || "");
  });
}

/**
 * Lightweight text fallback when voice/mic fails — extracts common handoff phrases.
 * Prefer Deepgram function calling when the agent is connected.
 */
export function applyHandoffText(card: TraumaCard, text: string): TraumaCard {
  const t = text.trim();
  if (!t) return card;
  const lower = t.toLowerCase();
  const next: TraumaCard = {
    ...card,
    vitals: { ...card.vitals },
    etaCapturedAt: card.etaCapturedAt ?? new Date().toISOString(),
  };

  const ageSex = lower.match(
    /(\d{1,3})[-\s]?(year[-\s]?old|yo)?\s*(female|male|woman|man|girl|boy)/,
  );
  if (ageSex) {
    next.age = Number(ageSex[1]);
    const s = ageSex[3];
    next.sex =
      s === "female" || s === "woman" || s === "girl"
        ? "female"
        : s === "male" || s === "man" || s === "boy"
          ? "male"
          : next.sex;
  }

  if (/motorcycle|mcc|bike/.test(lower)) {
    next.mechanism = "Motorcycle collision";
  } else if (/mvc|motor\s*vehicle|car\s*accident/.test(lower)) {
    next.mechanism = "Motor vehicle collision";
  } else if (/fall/.test(lower)) {
    next.mechanism = "Fall";
  }

  const bp = lower.match(
    /(?:blood\s*pressure|bp)\s*(?:is\s*)?(\d{2,3})\s*(?:over|\/)\s*(\d{2,3})/,
  ) || lower.match(/(\d{2,3})\s*over\s*(\d{2,3})/);
  if (bp) {
    next.vitals.bpSystolic = Number(bp[1]);
    next.vitals.bpDiastolic = Number(bp[2]);
  }

  const hr = lower.match(/(?:heart\s*rate|hr|pulse)\s*(?:is\s*)?(\d{2,3})/);
  if (hr) next.vitals.heartRate = Number(hr[1]);

  const gcs = lower.match(/gcs\s*(?:of\s*)?(\d{1,2})/);
  if (gcs) next.vitals.gcs = Number(gcs[1]);

  if (/femur/.test(lower)) {
    next.injury = "Suspected left femur fracture";
  } else if (/fracture|injury/.test(lower) && !next.injury) {
    next.injury = "Suspected traumatic injury";
  }

  if (/penicillin/.test(lower)) next.allergy = "PENICILLIN";
  if (/no known anticoagulants|not on anticoagulants|no anticoagulants/.test(lower)) {
    next.anticoagulants = "None reported";
  }

  const blood = lower.match(
    /(?:blood\s*type|type)\s*(?:is\s*)?(a|b|ab|o)\s*([\+\-]|positive|negative)?/,
  );
  if (blood) {
    const abo = blood[1].toUpperCase();
    const rhRaw = blood[2] ?? "";
    const rh =
      rhRaw === "+" || rhRaw === "positive"
        ? "+"
        : rhRaw === "-" || rhRaw === "negative"
          ? "-"
          : "";
    next.bloodType = `${abo}${rh}` || abo;
  }

  const eta = lower.match(/eta\s*(?:is\s*)?(\d{1,2})\s*(?:min|minutes)?/);
  if (eta) next.etaMinutes = Number(eta[1]);

  const oral = lower.match(
    /(?:last\s*(?:ate|drank|oral\s*intake)|ate|drank)\s*(?:around\s*|at\s*)?(.+?)(?:\.|$)/,
  );
  if (oral?.[1]) next.lastOralIntake = oral[1].trim().slice(0, 80);

  return next;
}
