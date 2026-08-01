"use client";

import { AppChrome } from "@/components/Providers";
import {
  acceptHandoff,
  HANDOFF_SR_CRITERIA,
  loadActiveHandoffs,
  loadPrepTasks,
} from "@/lib/fhir/handoff";
import {
  formatBp,
  flagBp,
  flagHr,
  patientLine,
  type ActiveHandoff,
} from "@/lib/trauma";
import type { Bundle, Task } from "@medplum/fhirtypes";
import { useMedplum, useSubscription } from "@medplum/react-hooks";
import { useCallback, useEffect, useState } from "react";

function Flag({ value }: { value: string | null }) {
  if (!value) return null;
  return (
    <span className="ml-2 text-[10px] font-bold tracking-wider text-rose-400">
      {value}
    </span>
  );
}

function nowStamp() {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function IncomingCard({
  handoff,
  busy,
  onAccept,
}: {
  handoff: ActiveHandoff;
  busy: boolean;
  onAccept: () => void;
}) {
  const { card } = handoff;
  return (
    <section className="rounded-lg border border-amber-700/40 bg-zinc-900/50 p-5">
      <div className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-400/90">
            Incoming transfer request
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-zinc-50">
            {patientLine(card)}
          </h2>
        </div>
        <p className="font-mono text-sm text-zinc-300">
          ETA{" "}
          {card.etaMinutes != null
            ? `${String(card.etaMinutes).padStart(2, "0")}:00`
            : "—"}
        </p>
      </div>

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
          <dt className="text-zinc-500">Injury</dt>
          <dd className="text-right">{card.injury ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Allergy</dt>
          <dd className="font-semibold uppercase text-rose-300">
            {card.allergy ?? "—"}
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onAccept}
          className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Accepting…" : "Accept Patient"}
        </button>
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-500"
          title="Phase 5"
        >
          Request More Info
        </button>
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-500"
        >
          Cannot Accept
        </button>
      </div>
    </section>
  );
}

export default function HospitalPage() {
  return (
    <AppChrome role="Hospital">
      <HospitalContent />
    </AppChrome>
  );
}

function HospitalContent() {
  const medplum = useMedplum();
  const [handoffs, setHandoffs] = useState<ActiveHandoff[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [accepted, setAccepted] = useState<ActiveHandoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());

  const pushEvent = useCallback((line: string) => {
    setEvents((e) => [`${nowStamp()}  ${line}`, ...e].slice(0, 40));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await loadActiveHandoffs(medplum);
      setHandoffs(list);
      setError(null);

      setSeenIds((prev) => {
        const next = new Set(prev);
        for (const h of list) {
          if (!next.has(h.id)) {
            next.add(h.id);
            const t = nowStamp();
            setEvents((e) =>
              [
                `${t}  Handoff transmitted`,
                `${t}  Encounter created at receiving hospital`,
                `${t}  Observations / AllergyIntolerance received`,
                ...e,
              ].slice(0, 40),
            );
          }
        }
        return next;
      });

      if (accepted?.encounterId) {
        const prep = await loadPrepTasks(medplum, accepted.encounterId);
        setTasks(prep);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load handoffs");
    }
  }, [medplum, accepted?.encounterId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useSubscription(HANDOFF_SR_CRITERIA, (_bundle: Bundle) => {
    void refresh();
  });

  useSubscription(`Task?_tag=https://traumatink.app/fhir/tag|prearrival-handoff`, () => {
    void refresh();
  });

  async function onAccept(handoff: ActiveHandoff) {
    setBusy(true);
    setError(null);
    try {
      const { tasks: created } = await acceptHandoff(medplum, handoff);
      setAccepted(handoff);
      setTasks(created);
      setHandoffs((h) => h.filter((x) => x.id !== handoff.id));
      pushEvent("Transfer accepted");
      pushEvent("Trauma preparation Task created");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Accept failed");
    } finally {
      setBusy(false);
    }
  }

  const latest = handoffs[0];

  return (
    <>
      {!latest && !accepted ? (
        <section className="flex min-h-[280px] flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700/80 bg-zinc-900/20 px-6 py-16 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Incoming transfer request
          </p>
          <h2 className="mt-3 text-xl font-semibold tracking-tight text-zinc-200">
            No active handoffs
          </h2>
          <p className="mt-2 max-w-sm text-sm text-zinc-500">
            Listening on Medplum WebSocket for new ServiceRequests…
          </p>
        </section>
      ) : latest ? (
        <IncomingCard
          handoff={latest}
          busy={busy}
          onAccept={() => void onAccept(latest)}
        />
      ) : (
        <section className="rounded-lg border border-teal-800/50 bg-zinc-900/40 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-400">
            Transfer accepted
          </p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-50">
            {accepted ? patientLine(accepted.card) : "Patient"}
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            Trauma Bay 2 is being prepared. Acknowledgment sent to EMS.
          </p>
        </section>
      )}

      {tasks.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Preparation tasks
          </p>
          <ul className="mt-2 space-y-2">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="rounded-md border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-sm"
              >
                <span className="text-zinc-200">{task.description}</span>
                <span className="ml-2 text-xs text-zinc-500">
                  {task.note?.[0]?.text ?? "requested"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className="mt-4 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          FHIR event log
        </p>
        {events.length === 0 ? (
          <p className="mt-2 font-mono text-xs text-zinc-600">Waiting for events…</p>
        ) : (
          <ul className="mt-2 space-y-1 font-mono text-xs text-zinc-400">
            {events.map((line, i) => (
              <li key={`${line}-${i}`}>{line}</li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-8 text-xs text-zinc-600">
        Phase 3 — <code className="text-zinc-500">useSubscription</code> + Accept →
        3 Tasks + EMS acknowledgment Communication.
      </p>
    </>
  );
}
