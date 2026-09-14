"use client";

import {
  etaIsOverdue,
  formatEtaCountdown,
  type TraumaCard,
} from "@/lib/trauma";
import { useEffect, useState } from "react";

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

/** Ticking ETA from etaCapturedAt + etaMinutes (MM:SS). */
export function EtaCountdown({
  card,
  compact = false,
  now: nowProp,
}: {
  card: TraumaCard;
  compact?: boolean;
  /** Pass a shared clock from the parent list; omit to tick locally. */
  now?: number;
}) {
  const needsOwnTick =
    nowProp == null && card.etaMinutes != null && Boolean(card.etaCapturedAt);
  const localNow = useNow(needsOwnTick);
  const now = nowProp ?? localNow;

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
