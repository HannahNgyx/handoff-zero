"use client";

import { AppChrome } from "@/components/Providers";
import { VoiceHandoff } from "@/components/VoiceHandoff";
import {
  ACCEPTANCE_COMM_CRITERIA,
  confirmHandoff,
  createDraftHandoff,
  INFO_REQUEST_COMM_CRITERIA,
  patchHandoffCard,
  writeOralIntakeObservation,
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
import { useCallback, useEffect, useRef, useState } from "react";

function Flag({ value }: { value: string | null }) {
  if (!value) return null;
  return (
    <span className="ml-2 text-[10px] font-bold tracking-wider text-rose-400">
      {value}
    </span>
  );
}

function TraumaCardView({
  card,
  handoffStatus,
}: {
  card: TraumaCard;
  handoffStatus: ActiveHandoff["handoffStatus"] | null;
}) {
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
          {handoffStatus && (
            <p
              className={`mt-2 text-[10px] font-semibold uppercase tracking-wider ${
                handoffStatus === "confirmed" ? "text-teal-400" : "text-amber-400"
              }`}
            >
              {handoffStatus === "confirmed" ? "Confirmed" : "Incoming (live)"}
            </p>
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
          Start voice to open an Incoming hospital card, then speak the handoff
          (or load the demo). Confirm when the packet looks right.
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
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">Last oral intake</dt>
            <dd>{card.lastOralIntake ?? "—"}</dd>
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
  const [injectMessage, setInjectMessage] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const wroteOralRef = useRef<string | null>(null);
  const handoffRef = useRef<ActiveHandoff | null>(null);
  const patchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  handoffRef.current = lastHandoff;

  const hasData =
    card.age != null || card.mechanism || card.vitals.bpSystolic != null;

  useSubscription(
    ACCEPTANCE_COMM_CRITERIA,
    (bundle: Bundle) => {
      const entry = bundle.entry?.find((e) => e.resource?.resourceType === "Communication");
      const comm = entry?.resource as Communication | undefined;
      const raw = comm?.payload?.[0]?.contentString;
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as { type?: string; message?: string };
        if (parsed.type === "acceptance" && parsed.message) {
          setInjectMessage(parsed.message);
          setBanner(parsed.message);
          setStatus("Hospital accepted — see acknowledgment below.");
        }
      } catch {
        /* ignore */
      }
    },
  );

  useSubscription(
    INFO_REQUEST_COMM_CRITERIA,
    (bundle: Bundle) => {
      const entry = bundle.entry?.find((e) => e.resource?.resourceType === "Communication");
      const comm = entry?.resource as Communication | undefined;
      const raw = comm?.payload?.[0]?.contentString;
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as { type?: string; message?: string };
        if (parsed.type === "info-request" && parsed.message) {
          setInjectMessage(parsed.message);
          setBanner(parsed.message);
          setStatus("Hospital requested more info — agent will ask when voice is connected.");
        }
      } catch {
        /* ignore */
      }
    },
  );

  // Debounced live patch while Incoming (and after Confirm for late field updates).
  useEffect(() => {
    const handoff = handoffRef.current;
    if (!handoff?.communicationId && !handoff?.encounterId) return;
    if (patchTimer.current) clearTimeout(patchTimer.current);
    patchTimer.current = setTimeout(() => {
      const current = handoffRef.current;
      if (!current) return;
      void patchHandoffCard(medplum, current, card)
        .then((next) => {
          setLastHandoff(next);
        })
        .catch((err) => {
          setStatus(err instanceof Error ? err.message : "Live patch failed");
        });
    }, 400);
    return () => {
      if (patchTimer.current) clearTimeout(patchTimer.current);
    };
  }, [card, medplum, lastHandoff?.id]);

  useEffect(() => {
    const value = card.lastOralIntake?.trim();
    if (!value || !lastHandoff?.encounterId || !lastHandoff.patientId) return;
    if (wroteOralRef.current === value) return;
    wroteOralRef.current = value;
    void (async () => {
      try {
        await writeOralIntakeObservation(medplum, lastHandoff, value);
        setStatus(`Oral intake sent to hospital: ${value}`);
      } catch (err) {
        wroteOralRef.current = null;
        setStatus(err instanceof Error ? err.message : "Failed to write oral intake");
      }
    })();
  }, [card.lastOralIntake, lastHandoff, medplum]);

  const onVoiceStarted = useCallback(async () => {
    if (handoffRef.current) {
      setStatus("Voice connected — hospital already has this Incoming card.");
      return;
    }
    try {
      const handoff = await createDraftHandoff(medplum, {
        ...card,
        etaCapturedAt: card.etaCapturedAt ?? new Date().toISOString(),
      });
      setLastHandoff(handoff);
      setStatus(
        `Incoming handoff opened at hospital${
          handoff.serviceRequestId
            ? ` · ServiceRequest/${handoff.serviceRequestId}`
            : ""
        }.`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to open Incoming handoff");
    }
  }, [medplum, card]);

  async function onConfirm() {
    setBusy(true);
    setStatus(null);
    try {
      let handoff = lastHandoff;
      if (!handoff) {
        handoff = await createDraftHandoff(medplum, {
          ...card,
          etaCapturedAt: card.etaCapturedAt ?? new Date().toISOString(),
        });
      }
      const confirmed = await confirmHandoff(medplum, handoff, {
        ...card,
        etaCapturedAt: card.etaCapturedAt ?? new Date().toISOString(),
      });
      setLastHandoff(confirmed);
      setStatus(
        `Handoff confirmed${
          confirmed.serviceRequestId
            ? ` · ServiceRequest/${confirmed.serviceRequestId}`
            : ""
        }.`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setBusy(false);
    }
  }

  const onCardChange = useCallback((next: TraumaCard) => {
    setCard(next);
  }, []);

  return (
    <>
      <TraumaCardView
        card={card}
        handoffStatus={lastHandoff?.handoffStatus ?? null}
      />

      <div className="mt-4">
        <VoiceHandoff
          card={card}
          onCardChange={onCardChange}
          injectMessage={injectMessage}
          onVoiceStarted={onVoiceStarted}
        />
      </div>

      {banner && (
        <div
          className="mt-4 rounded-md border border-teal-700/50 bg-teal-950/40 px-4 py-3 text-sm text-teal-100"
          role="status"
        >
          {banner}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => {
            setCard({ ...DEMO_TRAUMA_CARD, etaCapturedAt: new Date().toISOString() });
            setStatus(null);
            setInjectMessage(null);
            setBanner(null);
            wroteOralRef.current = null;
            // Keep lastHandoff so demo fill patches the open Incoming card.
          }}
          className="rounded-md bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
        >
          Load demo handoff
        </button>
        <button
          type="button"
          disabled={!hasData || busy || lastHandoff?.handoffStatus === "confirmed"}
          onClick={() => void onConfirm()}
          className="rounded-md border border-teal-600/80 bg-teal-700/30 px-4 py-2.5 text-sm font-medium text-teal-100 enabled:hover:bg-teal-700/50 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-transparent disabled:text-zinc-500"
        >
          {busy
            ? "Confirming…"
            : lastHandoff?.handoffStatus === "confirmed"
              ? "Confirmed"
              : "Confirm handoff"}
        </button>
      </div>

      {status && (
        <p className="mt-4 text-sm text-teal-300/90" role="status">
          {status}
        </p>
      )}
      {lastHandoff && (
        <p className="mt-1 font-mono text-xs text-zinc-500">
          {lastHandoff.handoffStatus}
          {lastHandoff.serviceRequestId
            ? ` · ServiceRequest/${lastHandoff.serviceRequestId}`
            : ""}
        </p>
      )}

      <p className="mt-8 text-xs text-zinc-600">
        Start voice → hospital Incoming card. Live patches follow speech. Confirm
        promotes the handoff to Confirmed.
      </p>
    </>
  );
}
