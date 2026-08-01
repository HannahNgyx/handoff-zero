"use client";

import { MedplumClient } from "@medplum/core";
import {
  MedplumProvider,
  useMedplum,
  useMedplumContext,
  useMedplumProfile,
  useSubscription,
} from "@medplum/react-hooks";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

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

function ConnectionStatus() {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const [state, setState] = useState<ConnState>({ status: "checking" });
  const [ws, setWs] = useState<"idle" | "open" | "closed" | "error">("idle");
  const [wsError, setWsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const metadata = (await medplum.get("fhir/R4/metadata")) as {
          fhirVersion?: string;
        };
        if (cancelled) return;
        setState({ status: "ok", fhirVersion: metadata.fhirVersion });
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

  const onWsOpen = useCallback(() => {
    setWs("open");
    setWsError(null);
  }, []);
  const onWsClose = useCallback(() => setWs("closed"), []);
  const onWsError = useCallback((err: Error) => {
    setWs("error");
    setWsError(err.message);
  }, []);

  // Probes Medplum WebSocket subscriptions (requires signed-in user + feature flag)
  useSubscription(
    profile ? "Communication?_count=1" : undefined,
    () => {
      /* presence only */
    },
    {
      onWebSocketOpen: onWsOpen,
      onWebSocketClose: onWsClose,
      onSubscriptionConnect: onWsOpen,
      onError: onWsError,
    },
  );

  return (
    <div className="flex flex-col items-end gap-1 text-xs font-mono tracking-wide">
      <div className="flex items-center gap-2">
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
          <span className="text-zinc-400">Connecting…</span>
        )}
        {state.status === "ok" && (
          <span className="text-emerald-400/90">
            Medplum · FHIR {state.fhirVersion}
            {profile ? " · signed in" : " · sign in"}
          </span>
        )}
        {state.status === "error" && (
          <span className="text-red-400" title={state.message}>
            Medplum unreachable
          </span>
        )}
      </div>
      {profile && (
        <div className="flex items-center gap-2" title={wsError ?? undefined}>
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              ws === "open"
                ? "bg-emerald-400"
                : ws === "error"
                  ? "bg-red-500"
                  : ws === "closed"
                    ? "bg-amber-400"
                    : "bg-zinc-600"
            }`}
            aria-hidden
          />
          <span
            className={
              ws === "open"
                ? "text-emerald-400/90"
                : ws === "error"
                  ? "text-red-400"
                  : "text-zinc-500"
            }
          >
            WS {ws === "idle" ? "connecting…" : ws}
          </span>
        </div>
      )}
      {profile && (
        <button
          type="button"
          className="text-[10px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
          onClick={() => void medplum.signOut()}
        >
          Sign out
        </button>
      )}
    </div>
  );
}

/** Demo auth: email/password against Medplum (no OAuth redirect). */
function LoginForm() {
  const medplum = useMedplum();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, bump] = useState(0);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const login = await medplum.startLogin({
        email,
        password,
        clientId: process.env.NEXT_PUBLIC_MEDPLUM_CLIENT_ID,
      });
      if (login.code) {
        await medplum.processCode(login.code);
      } else {
        throw new Error(
          "Sign-in needs another step (MFA/project). Use an account that returns a code directly.",
        );
      }
      bump((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-lg border border-zinc-800 bg-zinc-900/60 p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-400">
        TraumaLink
      </p>
      <h2 className="mt-2 text-lg font-semibold text-zinc-50">
        Sign in to Medplum
      </h2>
      <p className="mt-1 mb-4 text-sm text-zinc-500">
        Demo login — use your Medplum project email and password on both EMS and
        hospital tabs. Stays on this page (no OAuth redirect).
      </p>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        <label className="block text-xs text-zinc-400">
          Email
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-teal-600"
          />
        </label>
        <label className="block text-xs text-zinc-400">
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-teal-600"
          />
        </label>
        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-teal-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

function AuthGate({ children }: { children: ReactNode }) {
  const profile = useMedplumProfile();
  const { loading } = useMedplumContext();
  // Avoid SSR/client mismatch: localStorage session only exists in the browser
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || loading) {
    return (
      <p className="text-center text-sm text-zinc-500">Restoring Medplum session…</p>
    );
  }

  if (!profile) return <LoginForm />;
  return <>{children}</>;
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
          <div className="mx-auto flex max-w-6xl items-baseline justify-between gap-4">
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
        <main className="mx-auto max-w-6xl px-6 py-8">
          <AuthGate>{children}</AuthGate>
        </main>
      </div>
    </TraumaLinkProviders>
  );
}
