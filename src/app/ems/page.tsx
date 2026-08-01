"use client";

import { AppChrome } from "@/components/Providers";
import {
  ACCEPTANCE_COMM_CRITERIA,
  buildHandoffTransaction,
  handoffFromBatchResult,
} from "@/lib/fhir/handoff";
import {
  DEMO_TRAUMA_CARD,
  EMPTY_TRAUMA_CARD,
  formatBp,
  flagBp,
  flagHr,
  getMissingFields,
  patientLine,
  type ActiveHandoff,
  type TraumaCard,
} from "@/lib/trauma";
import type { Bundle, Communication } from "@medplum/fhirtypes";
import { useMedplum, useSubscription } from "@medplum/react-hooks";
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
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-amber-400/95">
            Incoming trauma
          </h2>
          {hasAny && (
            <p className="mt-1 text-sm text-zinc-400">{patientLine(card)}</p>
          )}
        </div>
        <p className="font-mono text-sm text-zinc-300">
          ETA{" "}
          {card.etaMinutes != null
            ? `${String(card.etaMinutes).padStart(2, "0")}:00`
            : "—"}
        </p>
      </div>

      {!hasAny ? (
        <p className="mt-6 text-sm text-zinc-500">
          Load the demo handoff (or use voice in Phase 4), then Transmit.
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

      {hasAny && missing.length > 0 && (
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
  return (
    <AppChrome role="EMS">
      <EmsContent />
    </AppChrome>
  );
}

function EmsContent() {
  const medplum = useMedplum();
  const [card, setCard] = useState<TraumaCard>(EMPTY_TRAUMA_CARD);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [lastHandoff, setLastHandoff] = useState<ActiveHandoff | null>(null);
  const [acceptance, setAcceptance] = useState<string | null>(null);

  const hasData =
    card.age != null || card.mechanism || card.vitals.bpSystolic != null;

  useSubscription(ACCEPTANCE_COMM_CRITERIA, (bundle: Bundle) => {
    const entry = bundle.entry?.find((e) => e.resource?.resourceType === "Communication");
    const comm = entry?.resource as Communication | undefined;
    const raw = comm?.payload?.[0]?.contentString;
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { type?: string; message?: string };
      if (parsed.type === "acceptance" && parsed.message) {
        setAcceptance(parsed.message);
        setStatus("Hospital accepted — see acknowledgment below.");
      }
    } catch {
      /* ignore */
    }
  });

  async function transmit() {
    setBusy(true);
    setStatus(null);
    setAcceptance(null);
    try {
      const bundle = buildHandoffTransaction({
        ...card,
        etaCapturedAt: card.etaCapturedAt ?? new Date().toISOString(),
      });
      const result = (await medplum.executeBatch(bundle)) as Bundle;
      const handoff = handoffFromBatchResult(card, result);
      setLastHandoff(handoff);
      setStatus(
        `Transmitted to Central Hospital${
          handoff.serviceRequestId
            ? ` · ServiceRequest/${handoff.serviceRequestId}`
            : ""
        }.`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Transmit failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TraumaCardView card={card} />

      {acceptance && (
        <div
          className="mt-4 rounded-md border border-teal-700/50 bg-teal-950/40 px-4 py-3 text-sm text-teal-100"
          role="status"
        >
          {acceptance}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => {
            setCard({ ...DEMO_TRAUMA_CARD, etaCapturedAt: new Date().toISOString() });
            setStatus(null);
            setLastHandoff(null);
            setAcceptance(null);
          }}
          className="rounded-md bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
        >
          Load demo handoff
        </button>
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
          disabled={!hasData || busy}
          onClick={() => void transmit()}
          className="rounded-md border border-teal-600/80 bg-teal-700/30 px-4 py-2.5 text-sm font-medium text-teal-100 enabled:hover:bg-teal-700/50 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-transparent disabled:text-zinc-500"
        >
          {busy ? "Transmitting…" : "Transmit to Central Hospital"}
        </button>
      </div>

      {status && (
        <p className="mt-4 text-sm text-teal-300/90" role="status">
          {status}
        </p>
      )}
      {lastHandoff && (
        <p className="mt-1 font-mono text-xs text-zinc-500">
          id {lastHandoff.id}
          {lastHandoff.serviceRequestId
            ? ` · ServiceRequest/${lastHandoff.serviceRequestId}`
            : ""}
        </p>
      )}

      <p className="mt-8 text-xs text-zinc-600">
        Phase 3 — Transmit writes FHIR via your signed-in Medplum session. Hospital
        Accept pushes an acknowledgment over WebSocket.
      </p>
    </>
  );
}
