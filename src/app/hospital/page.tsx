"use client";

import { AppChrome } from "@/components/Providers";
import { CaseChannel, HOSPITAL_QUICK_PHRASES } from "@/components/CaseChannel";
import { EtaCountdown, useNow } from "@/components/EtaCountdown";
import { TraumaCardFields } from "@/components/TraumaCardFields";
import {
  acceptHandoff,
  BRIDGE_COMM_CRITERIA,
  CHANNEL_COMM_CRITERIA,
  declineHandoff,
  HANDOFF_COMM_CRITERIA,
  HANDOFF_SR_CRITERIA,
  INFO_REQUEST_COMM_CRITERIA,
  INFO_TOPICS,
  loadActiveHandoffs,
  loadCaseChannel,
  loadEncounterCard,
  loadPrepTasks,
  ORAL_INTAKE_OBS_CRITERIA,
  postChannelMessage,
  requestBridge,
  requestMoreInfo,
  type ChannelEntry,
  type InfoTopicId,
} from "@/lib/fhir/handoff";
import {
  caseShortId,
  caseTitle,
  flagBp,
  flagHr,
  getSuggestedAsks,
  getTraumaTriageAssessment,
  patientLine,
  sortHandoffs,
  type ActiveHandoff,
} from "@/lib/trauma";
import type { Task } from "@medplum/fhirtypes";
import { useMedplum, useSubscription } from "@medplum/react-hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function nowStamp() {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function StatusBadge({ status }: { status: ActiveHandoff["handoffStatus"] }) {
  const confirmed = status === "confirmed";
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
        confirmed
          ? "bg-teal-950 text-teal-300 ring-1 ring-teal-700/50"
          : "bg-amber-950 text-amber-300 ring-1 ring-amber-700/50"
      }`}
    >
      {confirmed ? "Confirmed" : "Incoming"}
    </span>
  );
}

function InfoRequestPicker({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (topics: InfoTopicId[], customNote: string) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<InfoTopicId>>(
    () => new Set(["last-oral-intake"]),
  );
  const [customNote, setCustomNote] = useState("");

  function toggle(id: InfoTopicId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="rounded-lg border border-amber-800/50 bg-zinc-950/80 p-4">
      <p className="text-sm font-medium text-amber-100">Request more info</p>
      <p className="mt-1 text-xs text-zinc-500">
        Choose one or more topics — EMS will see each ask for this case.
      </p>
      <ul className="mt-3 space-y-2">
        {INFO_TOPICS.map((t) => (
          <li key={t.id}>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
              <input
                type="checkbox"
                checked={selected.has(t.id)}
                onChange={() => toggle(t.id)}
                className="rounded border-zinc-600"
              />
              {t.label}
            </label>
          </li>
        ))}
      </ul>
      {selected.has("custom") && (
        <input
          value={customNote}
          onChange={(e) => setCustomNote(e.target.value)}
          placeholder="Custom ask…"
          className="mt-3 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        />
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || selected.size === 0}
          onClick={() => onSubmit([...selected], customNote)}
          className="rounded-md bg-amber-700 px-3 py-1.5 text-sm text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send request"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const TRAUMA_BAY_CHECKLIST = [
  "Trauma Surgeon / Team Alerted",
  "Trauma Bay 2 Monitored & Ready",
  "RSI Airway Kit at Bedside",
  "Blood Bank MTP Cooler on Standby",
  "CT Scanner Cleared for Direct Arrival",
] as const;

function CaseDetail({
  handoff,
  accepted,
  busy,
  showPicker,
  channel,
  channelDraft,
  readiness,
  onToggleReadiness,
  onChannelDraft,
  onAccept,
  onOpenPicker,
  onSubmitInfo,
  onCancelPicker,
  onBridge,
  onDecline,
  onSendChannel,
  now,
}: {
  handoff: ActiveHandoff;
  accepted?: boolean;
  busy: boolean;
  showPicker: boolean;
  channel: ChannelEntry[];
  channelDraft: string;
  readiness: Set<string>;
  onToggleReadiness: (item: string) => void;
  onChannelDraft: (v: string) => void;
  onAccept: () => void;
  onOpenPicker: () => void;
  onSubmitInfo: (topics: InfoTopicId[], customNote: string) => void;
  onCancelPicker: () => void;
  onBridge: () => void;
  onDecline: () => void;
  onSendChannel: () => void;
  now: number;
}) {
  const { card } = handoff;
  const suggestions = getSuggestedAsks(card);
  const triage = getTraumaTriageAssessment(card);

  return (
    <section
      className={`rounded-lg border bg-zinc-900/50 p-5 ${
        accepted || handoff.handoffStatus === "confirmed"
          ? "border-teal-700/40"
          : "border-amber-700/40"
      }`}
    >
      <div className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-[11px] text-zinc-500">
              Case · {caseShortId(handoff)}
            </p>
            {accepted ? (
              <span className="inline-block rounded bg-teal-950 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-teal-300 ring-1 ring-teal-700/50">
                Accepted
              </span>
            ) : (
              <StatusBadge status={handoff.handoffStatus} />
            )}
          </div>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-zinc-50">
            {caseTitle(handoff)}
          </h2>
          {accepted ? (
            <p className="mt-1 text-xs text-teal-200/70">
              Trauma Bay 2 is being prepared. Acknowledgment sent to EMS.
            </p>
          ) : handoff.handoffStatus === "incoming" ? (
            <p className="mt-1 text-xs text-amber-200/70">
              Live pre-arrival — not yet confirmed by EMS. Actions still available.
            </p>
          ) : null}
        </div>
        <EtaCountdown card={card} now={now} />
      </div>

      {triage.level !== "ROUTINE" && (
        <div
          className={`mt-4 rounded-md border p-3 text-xs ${
            triage.level === "LEVEL 1 TRAUMA"
              ? "border-rose-700/60 bg-rose-950/30 text-rose-200"
              : "border-amber-700/60 bg-amber-950/30 text-amber-200"
          }`}
        >
          <div className="flex items-center gap-2 font-semibold tracking-wide">
            <span className="inline-block h-2 w-2 rounded-full bg-current animate-pulse" />
            <span>{triage.level} CRITERIA MET</span>
          </div>
          <ul className="mt-1.5 space-y-0.5 text-[11px] opacity-90">
            {triage.reasons.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        </div>
      )}

      <TraumaCardFields card={card} />

      <div className="mt-6 border-t border-zinc-800 pt-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Trauma Bay Readiness Checklist
          </p>
          <span className="font-mono text-[10px] text-zinc-500">
            {readiness.size}/{TRAUMA_BAY_CHECKLIST.length} ready
          </span>
        </div>
        <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
          {TRAUMA_BAY_CHECKLIST.map((item) => {
            const checked = readiness.has(item);
            return (
              <button
                key={item}
                type="button"
                onClick={() => onToggleReadiness(item)}
                className={`flex items-center gap-2 rounded border p-2 text-left text-xs transition ${
                  checked
                    ? "border-teal-700/60 bg-teal-950/40 text-teal-200"
                    : "border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300"
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${
                    checked
                      ? "border-teal-500 bg-teal-600 text-white"
                      : "border-zinc-700 bg-zinc-900 text-transparent"
                  }`}
                >
                  ✓
                </span>
                <span className="truncate">{item}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {!accepted && (
          <button
            type="button"
            disabled={busy}
            onClick={onAccept}
            className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
          >
            {busy ? "Working…" : "Accept Patient"}
          </button>
        )}
        <button
          type="button"
          disabled={busy || showPicker}
          onClick={onOpenPicker}
          className="rounded-md border border-amber-700/60 px-3 py-2 text-sm text-amber-100 hover:bg-amber-950/40 disabled:opacity-50"
        >
          Request More Info
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onBridge}
          className="rounded-md border border-sky-800/60 px-3 py-2 text-sm text-sky-100 hover:bg-sky-950/40 disabled:opacity-50"
        >
          Request live connect
        </button>
        {!accepted && (
          <button
            type="button"
            disabled={busy}
            onClick={onDecline}
            className="rounded-md border border-rose-900/60 px-3 py-2 text-sm text-rose-200 hover:bg-rose-950/40 disabled:opacity-50"
          >
            Cannot Accept
          </button>
        )}
      </div>

      {showPicker && (
        <div className="mt-4">
          <InfoRequestPicker
            busy={busy}
            onSubmit={onSubmitInfo}
            onCancel={onCancelPicker}
          />
        </div>
      )}

      <div className="mt-6 border-t border-zinc-800 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Suggested next asks
        </p>
        <p className="mt-1 text-[11px] text-zinc-600">
          TraumaLink suggestions (not Medplum, not voice AI) — from missing fields /
          vital flags
        </p>
        {suggestions.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">No open suggestions.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-zinc-300">
            {suggestions.map((s) => (
              <li key={s}>• {s}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 border-t border-zinc-800 pt-4">
        <CaseChannel
          channel={channel}
          emptyLabel="No messages yet."
          caption="Medplum Communications for this case (demo bridge — not WebRTC)"
          draft={channelDraft}
          onDraftChange={onChannelDraft}
          onSend={onSendChannel}
          placeholder="Message EMS…"
          busy={busy}
          quickPhrases={HOSPITAL_QUICK_PHRASES}
        />
      </div>
    </section>
  );
}

export default function HospitalPage() {
  return (
    <AppChrome role="Hospital">
      <HospitalContent />
    </AppChrome>
  );
}

function HospitalContent() {
  const medplum = useMedplum();
  const [handoffs, setHandoffs] = useState<ActiveHandoff[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<ActiveHandoff | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [channel, setChannel] = useState<ChannelEntry[]>([]);
  const [channelDraft, setChannelDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [showPicker, setShowPicker] = useState(false);
  const [queueFilter, setQueueFilter] = useState<"all" | "incoming" | "confirmed">("all");
  const [readinessByCase, setReadinessByCase] = useState<Record<string, Set<string>>>({});
  const seenIdsRef = useRef(new Set<string>());
  const seenConfirmedRef = useRef(new Set<string>());
  const selectedIdRef = useRef(selectedId);
  const acceptedRef = useRef(accepted);
  const handoffsRef = useRef(handoffs);
  const focusEncounterRef = useRef<string | undefined>(undefined);

  const now = useNow(true);
  const sorted = useMemo(() => sortHandoffs(handoffs, now), [handoffs, now]);
  const filteredQueue = useMemo(() => {
    if (queueFilter === "all") return sorted;
    return sorted.filter((h) => h.handoffStatus === queueFilter);
  }, [sorted, queueFilter]);

  const selected =
    sorted.find((h) => h.id === selectedId) ??
    (accepted?.id === selectedId ? accepted : null) ??
    sorted[0] ??
    accepted;

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    acceptedRef.current = accepted;
  }, [accepted]);
  useEffect(() => {
    handoffsRef.current = handoffs;
  }, [handoffs]);
  useEffect(() => {
    focusEncounterRef.current = selected?.encounterId;
  }, [selected?.encounterId]);

  const pushEvent = useCallback((line: string) => {
    setEvents((e) => [`${nowStamp()}  ${line}`, ...e].slice(0, 40));
  }, []);

  const refreshChannel = useCallback(
    async (encounterId: string | undefined) => {
      if (!encounterId) {
        setChannel([]);
        return;
      }
      try {
        setChannel(await loadCaseChannel(medplum, encounterId));
      } catch {
        /* ignore */
      }
    },
    [medplum],
  );

  const refresh = useCallback(async () => {
    try {
      const list = await loadActiveHandoffs(medplum);
      const selectedIdNow = selectedIdRef.current;
      const acceptedNow = acceptedRef.current;
      const prev = handoffsRef.current;
      setHandoffs(list);
      setError(null);

      for (const h of list) {
        if (!seenIdsRef.current.has(h.id)) {
          seenIdsRef.current.add(h.id);
          const t = nowStamp();
          const id = caseShortId(h);
          setEvents((e) =>
            [
              `${t}  [${id}] Handoff started (incoming)`,
              `${t}  [${id}] Encounter created`,
              ...e,
            ].slice(0, 40),
          );
        }
        if (h.handoffStatus === "confirmed" && !seenConfirmedRef.current.has(h.id)) {
          seenConfirmedRef.current.add(h.id);
          const t = nowStamp();
          setEvents((e) =>
            [`${t}  [${caseShortId(h)}] Handoff confirmed by EMS`, ...e].slice(0, 40),
          );
        }
      }

      setDirtyIds((dirty) => {
        let changed = false;
        const next = new Set(dirty);
        for (const h of list) {
          if (h.id === selectedIdNow) continue;
          const old = prev.find((p) => p.id === h.id);
          if (old && old.transmittedAt !== h.transmittedAt && !next.has(h.id)) {
            next.add(h.id);
            changed = true;
          }
        }
        return changed ? next : dirty;
      });

      if (!selectedIdNow && list[0]) setSelectedId(list[0].id);

      const focus =
        list.find((h) => h.id === selectedIdNow) ??
        (acceptedNow?.id === selectedIdNow ? acceptedNow : null);

      if (acceptedNow?.encounterId) {
        const packed = await loadEncounterCard(medplum, acceptedNow.encounterId);
        if (packed) {
          const oralChanged =
            Boolean(packed.card.lastOralIntake) &&
            packed.card.lastOralIntake !== acceptedNow.card.lastOralIntake;
          setAccepted((prev) => {
            if (!prev || prev.id !== acceptedNow.id) return prev;
            if (JSON.stringify(prev.card) === JSON.stringify(packed.card)) {
              return prev;
            }
            return {
              ...prev,
              card: packed.card,
              communicationId: packed.communicationId ?? prev.communicationId,
            };
          });
          if (oralChanged) {
            pushEvent(
              `[${caseShortId(acceptedNow)}] Oral intake: ${packed.card.lastOralIntake}`,
            );
          }
        }
      }

      if (focus?.encounterId) {
        await refreshChannel(focus.encounterId);
        if (acceptedNow?.id === focus.id) {
          setTasks(await loadPrepTasks(medplum, focus.encounterId));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load handoffs");
    }
  }, [medplum, pushEvent, refreshChannel]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (selectedId) {
      setDirtyIds((prev) => {
        const next = new Set(prev);
        next.delete(selectedId);
        return next;
      });
      setShowPicker(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void refreshChannel(selected?.encounterId);
  }, [selected?.encounterId, refreshChannel]);

  useSubscription(HANDOFF_SR_CRITERIA, () => {
    void refresh();
  });
  useSubscription(HANDOFF_COMM_CRITERIA, () => {
    void refresh();
  });
  useSubscription(BRIDGE_COMM_CRITERIA, () => {
    void refreshChannel(focusEncounterRef.current);
  });
  useSubscription(CHANNEL_COMM_CRITERIA, () => {
    void refreshChannel(focusEncounterRef.current);
  });
  useSubscription(INFO_REQUEST_COMM_CRITERIA, () => {
    void refreshChannel(focusEncounterRef.current);
  });
  useSubscription(`Task?_tag=https://traumatink.app/fhir/tag|prearrival-handoff`, () => {
    const encounterId = focusEncounterRef.current;
    const acceptedNow = acceptedRef.current;
    if (!encounterId || !acceptedNow) return;
    void loadPrepTasks(medplum, encounterId)
      .then(setTasks)
      .catch(() => {
        /* ignore */
      });
  });
  useSubscription(ORAL_INTAKE_OBS_CRITERIA, () => {
    void refresh();
  });

  async function onAccept(handoff: ActiveHandoff) {
    setBusy(true);
    setError(null);
    try {
      const { tasks: created } = await acceptHandoff(medplum, handoff);
      setAccepted(handoff);
      setTasks(created);
      setHandoffs((h) => h.filter((x) => x.id !== handoff.id));
      setSelectedId(handoff.id);
      pushEvent(`[${caseShortId(handoff)}] Transfer accepted`);
      pushEvent(`[${caseShortId(handoff)}] Medplum prep Tasks created (×3)`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Accept failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDecline(handoff: ActiveHandoff) {
    setBusy(true);
    setError(null);
    try {
      await declineHandoff(medplum, handoff);
      setHandoffs((h) => h.filter((x) => x.id !== handoff.id));
      if (selectedId === handoff.id) {
        setSelectedId(null);
        setAccepted((a) => (a?.id === handoff.id ? null : a));
      }
      pushEvent(`[${caseShortId(handoff)}] Transfer declined (Cannot Accept)`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decline failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitInfo(
    handoff: ActiveHandoff,
    topics: InfoTopicId[],
    customNote: string,
  ) {
    setBusy(true);
    setError(null);
    try {
      await requestMoreInfo(medplum, handoff, topics, customNote);
      const labels = topics
        .map((id) => INFO_TOPICS.find((t) => t.id === id)?.label ?? id)
        .join(", ");
      pushEvent(`[${caseShortId(handoff)}] Info requested: ${labels}`);
      setShowPicker(false);
      await refreshChannel(handoff.encounterId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request info failed");
    } finally {
      setBusy(false);
    }
  }

  async function onBridge(handoff: ActiveHandoff) {
    setBusy(true);
    setError(null);
    try {
      await requestBridge(medplum, handoff, "hospital");
      pushEvent(`[${caseShortId(handoff)}] Live connect requested`);
      await refreshChannel(handoff.encounterId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bridge request failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSendChannel(handoff: ActiveHandoff) {
    setBusy(true);
    try {
      await postChannelMessage(medplum, handoff, "hospital", channelDraft);
      setChannelDraft("");
      await refreshChannel(handoff.encounterId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  const activeReadiness = useMemo(() => {
    if (!selected) return new Set<string>();
    return readinessByCase[selected.id] ?? new Set<string>();
  }, [selected, readinessByCase]);

  const toggleReadiness = useCallback(
    (item: string) => {
      if (!selected) return;
      setReadinessByCase((prev) => {
        const current = new Set(prev[selected.id] ?? []);
        if (current.has(item)) current.delete(item);
        else current.add(item);
        return { ...prev, [selected.id]: current };
      });
    },
    [selected],
  );

  const showingAccepted =
    accepted &&
    selected?.id === accepted.id &&
    !sorted.some((h) => h.id === accepted.id);

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Case queue
          </p>
          <span className="font-mono text-[10px] text-zinc-500">
            {sorted.length} total
          </span>
        </div>
        <div className="mt-2 flex gap-1 rounded bg-zinc-950 p-0.5 text-[10px]">
          {(["all", "incoming", "confirmed"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setQueueFilter(filter)}
              className={`flex-1 rounded py-1 font-medium capitalize transition ${
                queueFilter === filter
                  ? "bg-zinc-800 text-teal-300 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
        <ul className="mt-3 space-y-1">
          {filteredQueue.length === 0 && !accepted ? (
            <li className="rounded-md border border-dashed border-zinc-800 px-3 py-6 text-center text-xs text-zinc-600">
              No cases match filter
            </li>
          ) : (
            filteredQueue.map((h) => {
              const active = selected?.id === h.id;
              const dirty = dirtyIds.has(h.id) && !active;
              const bp = flagBp(h.card.vitals.bpSystolic);
              const hr = flagHr(h.card.vitals.heartRate);
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(h.id)}
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                      active
                        ? "border-teal-600/60 bg-teal-950/30 ring-1 ring-teal-700/40"
                        : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-zinc-500">
                        {caseShortId(h)}
                        {dirty && (
                          <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
                        )}
                      </span>
                      <StatusBadge status={h.handoffStatus} />
                    </div>
                    <p className="mt-1 truncate text-zinc-200">{caseTitle(h)}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
                      <EtaCountdown card={h.card} compact now={now} />
                      {bp ? ` · BP ${bp}` : ""}
                      {hr ? ` · HR ${hr}` : ""}
                    </p>
                  </button>
                </li>
              );
            })
          )}
          {accepted && !sorted.some((h) => h.id === accepted.id) && (
            <li>
              <button
                type="button"
                onClick={() => setSelectedId(accepted.id)}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                  selected?.id === accepted.id
                    ? "border-teal-600/60 bg-teal-950/30"
                    : "border-zinc-800 bg-zinc-900/40"
                }`}
              >
                <span className="text-[10px] font-semibold uppercase text-teal-400">
                  Accepted
                </span>
                <p className="mt-1 truncate text-zinc-200">
                  {patientLine(accepted.card)}
                </p>
              </button>
            </li>
          )}
        </ul>
      </aside>

      <div>
        {!selected ? (
          <section className="flex min-h-[280px] flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700/80 bg-zinc-900/20 px-6 py-16 text-center">
            <h2 className="text-xl font-semibold text-zinc-200">No active handoffs</h2>
            <p className="mt-2 max-w-sm text-sm text-zinc-500">
              Listening for EMS Incoming drafts and Confirm…
            </p>
          </section>
        ) : (
          <CaseDetail
            handoff={selected}
            accepted={Boolean(showingAccepted)}
            busy={busy}
            showPicker={showPicker}
            channel={channel}
            channelDraft={channelDraft}
            readiness={activeReadiness}
            onToggleReadiness={toggleReadiness}
            onChannelDraft={setChannelDraft}
            onAccept={() => void onAccept(selected)}
            onOpenPicker={() => setShowPicker(true)}
            onSubmitInfo={(topics, note) =>
              void onSubmitInfo(selected, topics, note)
            }
            onCancelPicker={() => setShowPicker(false)}
            onBridge={() => void onBridge(selected)}
            onDecline={() => void onDecline(selected)}
            onSendChannel={() => void onSendChannel(selected)}
            now={now}
          />
        )}

        {tasks.length > 0 && selected?.id === accepted?.id && (
          <div className="mt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Prep tasks (Medplum)
            </p>
            <p className="mt-1 text-[11px] text-zinc-600">
              Created in Medplum when you accepted — not AI recommendations
            </p>
            <ul className="mt-2 space-y-2">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className="rounded-md border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-sm"
                >
                  <span className="text-zinc-200">{task.description}</span>
                  <span className="ml-2 text-xs text-zinc-500">
                    {task.note?.[0]?.text ?? "requested"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            FHIR event log
          </p>
          {events.length === 0 ? (
            <p className="mt-2 font-mono text-xs text-zinc-600">Waiting…</p>
          ) : (
            <ul className="mt-2 space-y-1 font-mono text-xs text-zinc-400">
              {events.map((line, i) => (
                <li key={`${line}-${i}`}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
