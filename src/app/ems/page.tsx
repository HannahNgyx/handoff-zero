"use client";

import { AppChrome } from "@/components/Providers";
import {
  EMPTY_TRAUMA_CARD,
  formatBp,
  flagBp,
  flagHr,
  getMissingFields,
  type TraumaCard,
} from "@/lib/trauma";
import { useState } from "react";

function Flag({ value }: { value: string | null }) {
  if (!value) return null;
  return (
    <span className="ml-2 text-[10px] font-bold tracking-wider text-rose-400">
      {value}
    </span>
  );
}

function TraumaCardView({ card }: { card: TraumaCard }) {
  const missing = getMissingFields(card);
  const hasAny =
    card.age != null ||
    card.mechanism ||
    card.vitals.bpSystolic != null ||
    card.injury;

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-amber-400/95">
          Incoming trauma
        </h2>
        <p className="font-mono text-sm text-zinc-300">
          ETA {card.etaMinutes != null ? `${String(card.etaMinutes).padStart(2, "0")}:00` : "—"}
        </p>
      </div>

      {!hasAny ? (
        <p className="mt-6 text-sm text-zinc-500">
          Waiting for voice handoff… Speak a trauma report to populate this card
          (Deepgram in Phase 4).
        </p>
      ) : (
        <dl className="mt-4 space-y-2.5 font-mono text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">BP</dt>
            <dd>
              {formatBp(card)}
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
            <dd>{card.vitals.gcs ?? "—"}</dd>
          </div>
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
        </dl>
      )}

      {missing.length > 0 && (
        <div className="mt-6 border-t border-zinc-800 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Missing
          </p>
          <ul className="mt-2 space-y-1 text-sm text-zinc-400">
            {missing.map((m) => (
              <li key={m}>• {m}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function EmsPage() {
  const [card] = useState<TraumaCard>(EMPTY_TRAUMA_CARD);

  return (
    <AppChrome role="EMS">
      <TraumaCardView card={card} />

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-md bg-teal-700/40 px-4 py-2.5 text-sm font-medium text-teal-200/60"
          title="Phase 4"
        >
          Start voice handoff
        </button>
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-md border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-500"
          title="Phase 2"
        >
          Transmit to Central Hospital
        </button>
      </div>

      <p className="mt-8 text-xs text-zinc-600">
        Phase 1 shell — Medplum connection badge above. Voice + Transmit come next.
      </p>
    </AppChrome>
  );
}
