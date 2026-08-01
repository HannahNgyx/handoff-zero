"use client";

import { AppChrome } from "@/components/Providers";
import {
  acceptHandoff,
  BRIDGE_COMM_CRITERIA,
  CHANNEL_COMM_CRITERIA,
  HANDOFF_COMM_CRITERIA,
  HANDOFF_SR_CRITERIA,
  INFO_REQUEST_COMM_CRITERIA,
  INFO_TOPICS,
  loadActiveHandoffs,
  loadCaseChannel,
  loadOralIntake,
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
  formatBp,
  flagBp,
  flagHr,
  getSuggestedAsks,
  patientLine,
  sortHandoffs,
  type ActiveHandoff,
} from "@/lib/trauma";
import type { Bundle, Task } from "@medplum/fhirtypes";
import { useMedplum, useSubscription } from "@medplum/react-hooks";
import { useCallback, useEffect, useMemo, useState } from "react";

function Flag({ value }: { value: string | null }) {
  if (!value) return null;
  return (
    <span className="ml-2 text-[10px] font-bold tracking-wider text-rose-400">
      {value}
    </span>
  );
}

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

function CaseDetail({
  handoff,
  busy,
  showPicker,
  channel,
  channelDraft,
  onChannelDraft,
  onAccept,
  onOpenPicker,
  onSubmitInfo,
  onCancelPicker,
  onBridge,
  onSendChannel,
}: {
  handoff: ActiveHandoff;
  busy: boolean;
  showPicker: boolean;
  channel: ChannelEntry[];
  channelDraft: string;
  onChannelDraft: (v: string) => void;
  onAccept: () => void;
  onOpenPicker: () => void;
  onSubmitInfo: (topics: InfoTopicId[], customNote: string) => void;
  onCancelPicker: () => void;
  onBridge: () => void;
  onSendChannel: () => void;
}) {
  const { card } = handoff;
  const suggestions = getSuggestedAsks(card);

  return (
    <section
      className={`rounded-lg border bg-zinc-900/50 p-5 ${
        handoff.handoffStatus === "confirmed"
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
            <StatusBadge status={handoff.handoffStatus} />
          </div>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-zinc-50">
            {caseTitle(handoff)}
          </h2>
          {handoff.handoffStatus === "incoming" && (
            <p className="mt-1 text-xs text-amber-200/70">
              Live pre-arrival — not yet confirmed by EMS. Actions still available.
            </p>
          )}
        </div>
        <p className="font-mono text-sm text-zinc-300">
          ETA{" "}
          {card.etaMinutes != null
            ? `${String(card.etaMinutes).padStart(2, "0")}:00`
            : "—"}
        </p>
      </div>

      <dl className="mt-4 space-y-2.5 font-mono text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">
            Blood pressure
            <span className="ml-1 text-[10px] text-zinc-600">(BP)</span>
          </dt>
          <dd>
            {formatBp(card)}
            <span className="ml-1 text-[10px] text-zinc-600">mmHg</span>
            <Flag value={flagBp(card.vitals.bpSystolic)} />
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Heart rate</dt>
          <dd>
            {card.vitals.heartRate ?? "—"}
            <Flag value={flagHr(card.vitals.heartRate)} />
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Injury</dt>
          <dd className="text-right">{card.injury ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Allergy</dt>
          <dd className="font-semibold uppercase text-rose-300">
            {card.allergy ?? "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Blood type</dt>
          <dd className="font-semibold uppercase text-teal-200">
            {card.bloodType ?? "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Last oral intake</dt>
          <dd className="text-right">{card.lastOralIntake ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Emergency contact</dt>
          <dd className="text-right">{card.emergencyContact ?? "—"}</dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onAccept}
          className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
        >
          {busy ? "Working…" : "Accept Patient"}
        </button>
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
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-500"
        >
          Cannot Accept
        </button>
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
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Direct channel
        </p>
        <p className="mt-1 text-[11px] text-zinc-600">
          Medplum Communications for this case (demo bridge — not WebRTC)
        </p>
        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto font-mono text-xs text-zinc-400">
          {channel.length === 0 ? (
            <li className="text-zinc-600">No messages yet.</li>
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
        <div className="mt-2 flex gap-2">
          <input
            value={channelDraft}
            onChange={(e) => onChannelDraft(e.target.value)}
            placeholder="Message EMS…"
            className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={busy || !channelDraft.trim()}
            onClick={onSendChannel}
            className="rounded-md border border-zinc-600 px-3 py-1.5 text-sm text-zinc-200 disabled:opacity-50"
          >
            Send
          </button>
        </div>
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
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const [seenConfirmed, setSeenConfirmed] = useState<Set<string>>(new Set());
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [showPicker, setShowPicker] = useState(false);

  const sorted = useMemo(() => sortHandoffs(handoffs), [handoffs]);
  const selected =
    sorted.find((h) => h.id === selectedId) ??
    (accepted?.id === selectedId ? accepted : null) ??
    sorted[0] ??
    accepted;

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
      setHandoffs(list);
      setError(null);

      setSeenIds((prev) => {
        const next = new Set(prev);
        for (const h of list) {
          if (!next.has(h.id)) {
            next.add(h.id);
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
        }
        return next;
      });

      setSeenConfirmed((prev) => {
        const next = new Set(prev);
        for (const h of list) {
          if (h.handoffStatus === "confirmed" && !next.has(h.id)) {
            next.add(h.id);
            const t = nowStamp();
            const id = caseShortId(h);
            setEvents((e) =>
              [`${t}  [${id}] Handoff confirmed by EMS`, ...e].slice(0, 40),
            );
          }
        }
        return next;
      });

      setDirtyIds((prev) => {
        const next = new Set(prev);
        for (const h of list) {
          if (h.id !== selectedId) next.add(h.id);
        }
        return next;
      });

      if (!selectedId && list[0]) setSelectedId(list[0].id);

      const focus =
        list.find((h) => h.id === selectedId) ??
        (accepted?.id === selectedId ? accepted : null);
      if (focus?.encounterId) {
        await refreshChannel(focus.encounterId);
        if (accepted?.id === focus.id) {
          const prep = await loadPrepTasks(medplum, focus.encounterId);
          setTasks(prep);
          const oral = await loadOralIntake(medplum, focus.encounterId);
          if (oral && accepted.card.lastOralIntake !== oral) {
            setAccepted({
              ...accepted,
              card: { ...accepted.card, lastOralIntake: oral },
            });
            pushEvent(`[${caseShortId(accepted)}] Oral intake: ${oral}`);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load handoffs");
    }
  }, [medplum, selectedId, accepted, pushEvent, refreshChannel]);

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

  useSubscription(HANDOFF_SR_CRITERIA, () => {
    void refresh();
  });
  useSubscription(HANDOFF_COMM_CRITERIA, () => {
    void refresh();
  });
  useSubscription(BRIDGE_COMM_CRITERIA, () => {
    void refresh();
  });
  useSubscription(CHANNEL_COMM_CRITERIA, () => {
    void refresh();
  });
  useSubscription(INFO_REQUEST_COMM_CRITERIA, () => {
    void refresh();
  });
  useSubscription(`Task?_tag=https://traumatink.app/fhir/tag|prearrival-handoff`, () => {
    void refresh();
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

  const showingAccepted =
    accepted &&
    selected?.id === accepted.id &&
    !sorted.some((h) => h.id === accepted.id);

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside>
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Case queue
        </p>
        <p className="mt-1 text-[11px] text-zinc-600">
          {sorted.length} open · select to work a case
        </p>
        <ul className="mt-3 space-y-1">
          {sorted.length === 0 && !accepted ? (
            <li className="rounded-md border border-dashed border-zinc-800 px-3 py-6 text-center text-xs text-zinc-600">
              Waiting for Incoming…
            </li>
          ) : (
            sorted.map((h) => {
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
                      ETA {h.card.etaMinutes ?? "—"}
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
        ) : showingAccepted ? (
          <section className="rounded-lg border border-teal-800/50 bg-zinc-900/40 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-400">
              Transfer accepted · Case · {caseShortId(accepted)}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-50">
              {patientLine(accepted.card)}
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              Trauma Bay 2 is being prepared. Acknowledgment sent to EMS.
            </p>
            <dl className="mt-4 space-y-2 font-mono text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Blood type</dt>
                <dd className="uppercase text-teal-200">
                  {accepted.card.bloodType ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500">Last oral intake</dt>
                <dd>{accepted.card.lastOralIntake ?? "—"}</dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowPicker(true)}
                className="rounded-md border border-amber-700/60 px-3 py-2 text-sm text-amber-100"
              >
                Request More Info
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onBridge(accepted)}
                className="rounded-md border border-sky-800/60 px-3 py-2 text-sm text-sky-100"
              >
                Request live connect
              </button>
            </div>
            {showPicker && (
              <div className="mt-4">
                <InfoRequestPicker
                  busy={busy}
                  onSubmit={(topics, note) =>
                    void onSubmitInfo(accepted, topics, note)
                  }
                  onCancel={() => setShowPicker(false)}
                />
              </div>
            )}
          </section>
        ) : (
          <CaseDetail
            handoff={selected}
            busy={busy}
            showPicker={showPicker}
            channel={channel}
            channelDraft={channelDraft}
            onChannelDraft={setChannelDraft}
            onAccept={() => void onAccept(selected)}
            onOpenPicker={() => setShowPicker(true)}
            onSubmitInfo={(topics, note) =>
              void onSubmitInfo(selected, topics, note)
            }
            onCancelPicker={() => setShowPicker(false)}
            onBridge={() => void onBridge(selected)}
            onSendChannel={() => void onSendChannel(selected)}
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
