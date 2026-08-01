"use client";

import { AppChrome } from "@/components/Providers";

export default function HospitalPage() {
  return (
    <AppChrome role="Hospital">
      <section className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700/80 bg-zinc-900/20 px-6 py-16 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Incoming transfer request
        </p>
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-zinc-200">
          No active handoffs
        </h2>
        <p className="mt-2 max-w-sm text-sm text-zinc-500">
          Open the EMS screen in another tab. When a handoff is transmitted, it
          will appear here in real time.
        </p>
      </section>

      <div className="mt-8 opacity-40">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          FHIR event log
        </p>
        <p className="mt-2 font-mono text-xs text-zinc-600">Waiting for events…</p>
      </div>

      <p className="mt-8 text-xs text-zinc-600">
        Phase 1 shell — confirm Medplum connected in the header, then open{" "}
        <a href="/ems" className="text-teal-500/80 underline-offset-2 hover:underline">
          /ems
        </a>
        .
      </p>
    </AppChrome>
  );
}
