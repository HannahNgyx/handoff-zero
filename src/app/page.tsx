import Link from "next/link";

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0c1117] px-6 text-zinc-100">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(45,212,191,0.12),_transparent_55%),radial-gradient(ellipse_at_bottom,_rgba(24,24,27,0.9),_#0c1117)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
        aria-hidden
      />

      <div className="relative z-10 flex max-w-lg flex-col items-center text-center">
        <p className="text-4xl font-semibold tracking-tight text-teal-400 sm:text-5xl">
          TraumaLink
        </p>
        <p className="mt-4 text-lg text-zinc-300 sm:text-xl">
          Pre-arrival trauma channel
        </p>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-zinc-500">
          Open EMS and Hospital in two windows. Sign in on both, start a voice
          or Incoming card on EMS, then Accept on the hospital board.
        </p>

        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link
            href="/ems"
            className="rounded-md bg-teal-600 px-5 py-2.5 text-sm font-medium text-white shadow-[0_0_24px_rgba(13,148,136,0.25)] transition hover:bg-teal-500"
          >
            Open EMS
          </Link>
          <Link
            href="/hospital"
            className="rounded-md border border-zinc-600 bg-zinc-900/40 px-5 py-2.5 text-sm font-medium text-zinc-200 backdrop-blur transition hover:border-zinc-400"
          >
            Open Hospital
          </Link>
        </div>

        <ol className="mt-12 w-full max-w-sm space-y-2 text-left text-xs text-zinc-500">
          <li className="flex gap-2">
            <span className="font-mono text-teal-600/80">1</span>
            Sign in with Medplum on both tabs (header shows WS open)
          </li>
          <li className="flex gap-2">
            <span className="font-mono text-teal-600/80">2</span>
            EMS: Start voice or Open Incoming → hospital queue updates
          </li>
          <li className="flex gap-2">
            <span className="font-mono text-teal-600/80">3</span>
            Confirm on EMS → Accept / Request info on Hospital
          </li>
        </ol>
      </div>
    </div>
  );
}
