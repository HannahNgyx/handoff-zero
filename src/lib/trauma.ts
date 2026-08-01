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

export function formatBp(card: TraumaCard): string {
  const { bpSystolic, bpDiastolic } = card.vitals;
  if (bpSystolic == null || bpDiastolic == null) return "—";
  return `${bpSystolic}/${bpDiastolic}`;
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
