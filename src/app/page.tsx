import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0c1117] px-6 text-zinc-100">
      <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-teal-400">
        TraumaLink
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        Pre-arrival trauma channel
      </h1>
      <p className="mt-2 max-w-md text-center text-sm text-zinc-500">
        Open EMS and Hospital in two browser windows for the demo.
      </p>
      <div className="mt-10 flex flex-wrap justify-center gap-4">
        <Link
          href="/ems"
          className="rounded-md bg-teal-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-500"
        >
          EMS handoff
        </Link>
        <Link
          href="/hospital"
          className="rounded-md border border-zinc-600 px-5 py-2.5 text-sm font-medium text-zinc-200 hover:border-zinc-400"
        >
          Hospital dashboard
        </Link>
      </div>
    </div>
  );
}
