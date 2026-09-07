"use client";

import {
  calculateShockIndex,
  formatBp,
  flagBp,
  flagGcs,
  flagHr,
  type TraumaCard,
} from "@/lib/trauma";

function Flag({ value }: { value: string | null }) {
  if (!value) return null;
  return (
    <span className="ml-2 text-[10px] font-bold tracking-wider text-rose-400">
      {value}
    </span>
  );
}

function shockClass(flag: "NORMAL" | "ELEVATED" | "CRITICAL"): string {
  if (flag === "CRITICAL") return "text-rose-400";
  if (flag === "ELEVATED") return "text-amber-400";
  return "text-emerald-400";
}

/** Shared clinical rows for EMS and hospital trauma cards. */
export function TraumaCardFields({ card }: { card: TraumaCard }) {
  const si = calculateShockIndex(
    card.vitals.heartRate,
    card.vitals.bpSystolic,
  );

  return (
    <dl className="mt-4 space-y-2.5 font-mono text-sm">
      <div className="flex justify-between gap-4">
        <dt className="text-zinc-500">
          Blood pressure
          <span className="ml-1 text-[10px] text-zinc-600">(BP)</span>
        </dt>
        <dd>
          {formatBp(card)}
          <span className="ml-1 text-[10px] text-zinc-600">mmHg</span>
          <Flag value={flagBp(card.vitals.bpSystolic)} />
        </dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-zinc-500">Heart rate</dt>
        <dd>
          {card.vitals.heartRate ?? "—"}
          <Flag value={flagHr(card.vitals.heartRate)} />
        </dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-zinc-500">GCS</dt>
        <dd>
          {card.vitals.gcs ?? "—"}
          <Flag value={flagGcs(card.vitals.gcs)} />
        </dd>
      </div>
      {si ? (
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Shock Index (HR/SBP)</dt>
          <dd className="font-mono">
            {si.value}
            <span
              className={`ml-2 text-[10px] font-bold tracking-wider ${shockClass(si.flag)}`}
            >
              {si.flag}
            </span>
          </dd>
        </div>
      ) : null}
      <div className="flex justify-between gap-4">
        <dt className="text-zinc-500">Injury</dt>
        <dd className="text-right">{card.injury ?? "—"}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-zinc-500">Allergy</dt>
        <dd className="font-semibold uppercase text-rose-300">
          {card.allergy ?? "—"}
        </dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-zinc-500">Anticoagulants</dt>
        <dd>{card.anticoagulants ?? "—"}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-zinc-500">Blood type</dt>
        <dd className="font-semibold uppercase text-teal-200">
          {card.bloodType ?? "—"}
        </dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-zinc-500">Last oral intake</dt>
        <dd className="text-right">{card.lastOralIntake ?? "—"}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-zinc-500">Emergency contact</dt>
        <dd className="text-right">{card.emergencyContact ?? "—"}</dd>
      </div>
      {card.interventions && card.interventions.length > 0 ? (
        <div className="flex items-start justify-between gap-4 pt-1">
          <dt className="text-zinc-500">Interventions</dt>
          <dd className="flex flex-wrap justify-end gap-1.5 text-right">
            {card.interventions.map((intv) => (
              <span
                key={intv}
                className="inline-block rounded bg-emerald-950/80 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-600/50"
              >
                {intv}
              </span>
            ))}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
