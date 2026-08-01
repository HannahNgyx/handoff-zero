"use client";

import { MedplumClient } from "@medplum/core";
import { MedplumProvider, useMedplum } from "@medplum/react-hooks";
import { useEffect, useMemo, useState, type ReactNode } from "react";

function createClient(): MedplumClient {
  return new MedplumClient({
    baseUrl: process.env.NEXT_PUBLIC_MEDPLUM_BASE_URL || "https://api.medplum.com/",
    clientId: process.env.NEXT_PUBLIC_MEDPLUM_CLIENT_ID,
  });
}

export function TraumaLinkProviders({ children }: { children: ReactNode }) {
  const medplum = useMemo(() => createClient(), []);
  return <MedplumProvider medplum={medplum}>{children}</MedplumProvider>;
}

type ConnState =
  | { status: "checking" }
  | { status: "ok"; fhirVersion?: string }
  | { status: "error"; message: string };

/** Probes Medplum FHIR metadata — works without login. */
export function ConnectionStatus() {
  const medplum = useMedplum();
  const [state, setState] = useState<ConnState>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const metadata = (await medplum.get("fhir/R4/metadata")) as {
          fhirVersion?: string;
          software?: { name?: string };
        };
        if (cancelled) return;
        setState({
          status: "ok",
          fhirVersion: metadata.fhirVersion,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Connection failed",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [medplum]);

  const base =
    process.env.NEXT_PUBLIC_MEDPLUM_BASE_URL || "https://api.medplum.com/";

  return (
    <div className="flex items-center gap-2 text-xs font-mono tracking-wide">
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          state.status === "checking"
            ? "bg-amber-400 animate-pulse"
            : state.status === "ok"
              ? "bg-emerald-400"
              : "bg-red-500"
        }`}
        aria-hidden
      />
      {state.status === "checking" && (
        <span className="text-zinc-400">Connecting to Medplum…</span>
      )}
      {state.status === "ok" && (
        <span className="text-emerald-400/90">
          Medplum connected
          {state.fhirVersion ? ` · FHIR ${state.fhirVersion}` : ""}
        </span>
      )}
      {state.status === "error" && (
        <span className="text-red-400" title={state.message}>
          Medplum unreachable — check NEXT_PUBLIC_MEDPLUM_BASE_URL ({base})
        </span>
      )}
    </div>
  );
}

export function AppChrome({
  role,
  children,
}: {
  role: "EMS" | "Hospital";
  children: ReactNode;
}) {
  return (
    <TraumaLinkProviders>
      <div className="min-h-screen bg-[#0c1117] text-zinc-100">
        <header className="border-b border-zinc-800/80 px-6 py-4">
          <div className="mx-auto flex max-w-3xl items-baseline justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-400/90">
                TraumaLink
              </p>
              <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-zinc-50">
                {role === "EMS" ? "EMS handoff" : "Receiving hospital"}
              </h1>
            </div>
            <ConnectionStatus />
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
      </div>
    </TraumaLinkProviders>
  );
}
