"use client";

import type { ChannelEntry } from "@/lib/fhir/handoff";
import type { ReactNode } from "react";

export const EMS_QUICK_PHRASES = [
  "ETA 4 mins",
  "IV established",
  "Vitals stable",
  "Patient deteriorating",
] as const;

export const HOSPITAL_QUICK_PHRASES = [
  "Trauma Bay 2 Ready",
  "Trauma Team Activated",
  "Airway Team Standby",
  "Direct to CT on arrival",
] as const;

/** Shared EMS / hospital direct-channel thread + composer. */
export function CaseChannel({
  channel,
  emptyLabel,
  caption,
  draft,
  onDraftChange,
  onSend,
  placeholder,
  busy,
  disabled,
  quickPhrases,
  actions,
  listClassName = "max-h-40",
}: {
  channel: ChannelEntry[];
  emptyLabel: string;
  caption?: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  placeholder: string;
  busy: boolean;
  disabled?: boolean;
  quickPhrases: readonly string[];
  actions?: ReactNode;
  listClassName?: string;
}) {
  return (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
        Direct channel
      </p>
      {caption ? (
        <p className="mt-1 text-[11px] text-zinc-600">{caption}</p>
      ) : null}
      <ul
        className={`mt-2 space-y-1 overflow-y-auto font-mono text-xs text-zinc-400 ${listClassName}`}
      >
        {channel.length === 0 ? (
          <li className="text-zinc-600">{emptyLabel}</li>
        ) : (
          channel.map((m) => (
            <li key={m.id}>
              <span className="text-zinc-600">
                [{m.type}
                {m.from ? ` · ${m.from}` : ""}]
              </span>{" "}
              {m.message}
            </li>
          ))
        )}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm disabled:opacity-50"
        />
        <button
          type="button"
          disabled={busy || disabled || !draft.trim()}
          onClick={onSend}
          className="rounded-md border border-zinc-600 px-3 py-1.5 text-sm text-zinc-200 disabled:opacity-50"
        >
          Send
        </button>
        {actions}
      </div>
      {!disabled && quickPhrases.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {quickPhrases.map((quick) => (
            <button
              key={quick}
              type="button"
              disabled={busy}
              onClick={() => onDraftChange(quick)}
              className="rounded border border-zinc-800 bg-zinc-950/60 px-2 py-0.5 text-[11px] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            >
              {quick}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
