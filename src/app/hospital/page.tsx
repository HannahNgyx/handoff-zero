"use client";

import { AppChrome } from "@/components/Providers";
import {
  formatBp,
  flagBp,
  flagHr,
  patientLine,
  type ActiveHandoff,
} from "@/lib/trauma";
import { useCallback, useEffect, useState } from "react";

function Flag({ value }: { value: string | null }) {
  if (!value) return null;
  return (
    <span className="ml-2 text-[10px] font-bold tracking-wider text-rose-400">
      {value}
    </span>
  );
}

function IncomingCard({ handoff }: { handoff: ActiveHandoff }) {
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
          disabled
          className="cursor-not-allowed rounded-md bg-teal-800/40 px-3 py-2 text-sm text-teal-200/50"
          title="Phase 3"
        >
          Accept Patient
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
  const [handoffs, setHandoffs] = useState<ActiveHandoff[]>([]);
  const [mode, setMode] = useState<string>("…");
  const [warning, setWarning] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/handoff", { cache: "no-store" });
      const data = (await res.json()) as {
        mode: string;
        handoffs: ActiveHandoff[];
        warning?: string;
      };
      setMode(data.mode);
      setWarning(data.warning ?? null);
      setHandoffs(data.handoffs ?? []);

      setSeenIds((prev) => {
        const next = new Set(prev);
        const newEvents: string[] = [];
        for (const h of data.handoffs ?? []) {
          if (!next.has(h.id)) {
            next.add(h.id);
            const t = new Date(h.transmittedAt).toLocaleTimeString("en-US", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
            newEvents.push(`${t}  Handoff transmitted`);
            if (h.mode === "medplum") {
              newEvents.push(`${t}  Encounter created at receiving hospital`);
              newEvents.push(`${t}  Observations / AllergyIntolerance received`);
            }
          }
        }
        if (newEvents.length) {
          setEvents((e) => [...newEvents, ...e].slice(0, 40));
        }
        return next;
      });
    } catch (err) {
      setWarning(err instanceof Error ? err.message : "Poll failed");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 2000);
    return () => clearInterval(id);
  }, [refresh]);

  const latest = handoffs[0];

  return (
    <AppChrome role="Hospital">
      {!latest ? (
        <section className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700/80 bg-zinc-900/20 px-6 py-16 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Incoming transfer request
          </p>
          <h2 className="mt-3 text-xl font-semibold tracking-tight text-zinc-200">
            No active handoffs
          </h2>
          <p className="mt-2 max-w-sm text-sm text-zinc-500">
            Waiting for EMS Transmit… polling every 2s ({mode}).
          </p>
        </section>
      ) : (
        <IncomingCard handoff={latest} />
      )}

      {warning && (
        <p className="mt-4 text-xs text-amber-500/90" role="status">
          {warning}
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
        Phase 2 — hospital loads handoffs via{" "}
        <code className="text-zinc-500">GET /api/handoff</code>. Realtime
        subscriptions in Phase 3.
      </p>
    </AppChrome>
  );
}
