"use client";

import {
  etaIsOverdue,
  formatEtaCountdown,
  type TraumaCard,
} from "@/lib/trauma";
import { useEffect, useState } from "react";

/** Ticking ETA from etaCapturedAt + etaMinutes (MM:SS). */
export function EtaCountdown({
  card,
  compact = false,
}: {
  card: TraumaCard;
  compact?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (card.etaMinutes == null || !card.etaCapturedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [card.etaMinutes, card.etaCapturedAt]);

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
