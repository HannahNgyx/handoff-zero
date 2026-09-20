"use client";

import {
  etaIsOverdue,
  formatEtaCountdown,
  type TraumaCard,
} from "@/lib/trauma";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const NowContext = createContext<number | null>(null);

/** Shared 1s clock so list rows do not each start their own interval. */
export function useNow(active = true, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

/** One ticker for a tree. Put this above queue + detail, not around Medplum subscriptions. */
export function NowProvider({ children }: { children: ReactNode }) {
  const now = useNow(true);
  return <NowContext.Provider value={now}>{children}</NowContext.Provider>;
}

export function useSharedNow(): number {
  const ctx = useContext(NowContext);
  const local = useNow(ctx == null);
  return ctx ?? local;
}

/** Ticking ETA from etaCapturedAt + etaMinutes (MM:SS). */
export function EtaCountdown({
  card,
  compact = false,
  now: nowProp,
}: {
  card: TraumaCard;
  compact?: boolean;
  /** Pass a shared clock from the parent list; omit to use NowProvider or a local tick. */
  now?: number;
}) {
  const shared = useSharedNow();
  const now = nowProp ?? shared;

  const size = compact ? "text-[10px]" : "text-sm";

  if (card.etaMinutes == null) {
    return <span className={`font-mono ${size} text-zinc-500`}>ETA —</span>;
  }

  const overdue = etaIsOverdue(card, now);
  const label = formatEtaCountdown(card, now);

  return (
    <span
      className={`font-mono tabular-nums ${size} ${
        overdue ? "font-semibold text-rose-400" : "text-zinc-300"
      }`}
      title={
        card.etaCapturedAt
          ? `Captured ${new Date(card.etaCapturedAt).toLocaleTimeString()}`
          : `${card.etaMinutes} min (not yet live-ticking)`
      }
    >
      ETA {label}
      {overdue ? (
        <span className="ml-1 text-[10px] font-semibold tracking-wider">DUE</span>
      ) : null}
    </span>
  );
}
