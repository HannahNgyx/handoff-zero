"use client";

import { AppChrome } from "@/components/Providers";
import { CaseChannel, EMS_QUICK_PHRASES } from "@/components/CaseChannel";
import { EtaCountdown } from "@/components/EtaCountdown";
import { TraumaCardFields } from "@/components/TraumaCardFields";
import { VoiceHandoff } from "@/components/VoiceHandoff";
import {
  ACCEPTANCE_COMM_CRITERIA,
  BRIDGE_COMM_CRITERIA,
  CHANNEL_COMM_CRITERIA,
  communicationFromBundle,
  confirmHandoff,
  createDraftHandoff,
  INFO_REQUEST_COMM_CRITERIA,
  loadCaseChannel,
  parseAcceptancePayload,
  parseBridgePayload,
  parseInfoRequestPayload,
  patchHandoffCard,
  postChannelMessage,
  requestBridge,
  writeOralIntakeObservation,
  type ChannelEntry,
} from "@/lib/fhir/handoff";
import {
  applyHandoffText,
  caseShortId,
  caseTitle,
  COMMON_INTERVENTIONS,
  DEMO_PRESETS,
  EMPTY_TRAUMA_CARD,
  getMissingFields,
  hasClinicalData,
  patientLine,
  type ActiveHandoff,
  type TraumaCard,
} from "@/lib/trauma";
import type { Bundle } from "@medplum/fhirtypes";
import { useMedplum, useSubscription } from "@medplum/react-hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type OpenInfoAsk = {
  id: string;
  labels: string[];
  message: string;
  serviceRequestId?: string;
};

function TraumaCardView({
  card,
  handoff,
}: {
  card: TraumaCard;
  handoff: ActiveHandoff | null;
}) {
  const missing = getMissingFields(card);
  const hasAny = hasClinicalData(card);

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-amber-400/95">
            Active case
            {handoff ? (
              <span className="ml-2 font-mono text-[10px] text-zinc-500">
                · {caseShortId(handoff)}
              </span>
            ) : null}
          </h2>
          {hasAny && (
            <p className="mt-1 text-sm text-zinc-400">{patientLine(card)}</p>
          )}
          {handoff && (
            <p
              className={`mt-2 text-[10px] font-semibold uppercase tracking-wider ${
                handoff.handoffStatus === "confirmed"
                  ? "text-teal-400"
                  : "text-amber-400"
              }`}
            >
              {handoff.handoffStatus === "confirmed"
                ? "Confirmed"
                : "Incoming (live)"}
            </p>
          )}
        </div>
        <EtaCountdown card={card} />
      </div>

      {!hasAny ? (
        <p className="mt-6 text-sm text-zinc-500">
          Start voice or Open Incoming for this case, then speak / paste the
          handoff. Use New patient for a second case.
        </p>
      ) : (
        <TraumaCardFields card={card} />
      )}

      {hasAny && missing.length > 0 && (
        <div className="mt-6 border-t border-zinc-800 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Missing
          </p>
          <ul className="mt-2 space-y-1 text-sm text-zinc-400">
            {missing.map((m) => (
              <li key={m}>• {m}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function EmsPage() {
  return (
    <AppChrome role="EMS">
      <EmsContent />
    </AppChrome>
  );
}

function EmsContent() {
  const medplum = useMedplum();
  const [cases, setCases] = useState<ActiveHandoff[]>([]);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [cardsById, setCardsById] = useState<Record<string, TraumaCard>>({});
  const [localCard, setLocalCard] = useState<TraumaCard>(EMPTY_TRAUMA_CARD);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [injectMessage, setInjectMessage] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [reportText, setReportText] = useState("");
  const [openAsks, setOpenAsks] = useState<OpenInfoAsk[]>([]);
  const [channel, setChannel] = useState<ChannelEntry[]>([]);
  const [channelDraft, setChannelDraft] = useState("");
  const wroteOralRef = useRef<Record<string, string>>({});
  const patchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const casesRef = useRef(cases);
  const activeCaseRef = useRef<ActiveHandoff | null>(null);

  const activeCase = useMemo(
    () => cases.find((c) => c.id === activeCaseId) ?? null,
    [cases, activeCaseId],
  );

  useEffect(() => {
    casesRef.current = cases;
  }, [cases]);

  useEffect(() => {
    activeCaseRef.current = activeCase;
  }, [activeCase]);

  const card = activeCaseId
    ? (cardsById[activeCaseId] ?? activeCase?.card ?? localCard)
    : localCard;

  const setCard = useCallback(
    (next: TraumaCard) => {
      if (activeCaseId) {
        setCardsById((m) => ({ ...m, [activeCaseId]: next }));
        setCases((list) =>
          list.map((c) => (c.id === activeCaseId ? { ...c, card: next } : c)),
        );
      } else {
        setLocalCard(next);
      }
    },
    [activeCaseId],
  );

  const hasData = hasClinicalData(card);

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

  useEffect(() => {
    void refreshChannel(activeCase?.encounterId);
  }, [activeCase?.encounterId, refreshChannel]);

  useSubscription(ACCEPTANCE_COMM_CRITERIA, (bundle: Bundle) => {
    const comm = communicationFromBundle(bundle);
    const raw = comm?.payload?.[0]?.contentString;
    if (!raw) return;
    const parsed = parseAcceptancePayload(raw);
    if (!parsed) return;
    const match = casesRef.current.find(
      (c) =>
        !parsed.serviceRequestId ||
        c.serviceRequestId === parsed.serviceRequestId,
    );
    if (match && activeCaseId && match.id !== activeCaseId) {
      setStatus(
        parsed.type === "decline"
          ? `Hospital declined case ${caseShortId(match)} — switch to that case.`
          : `Hospital accepted case ${caseShortId(match)} — switch to that case.`,
      );
      return;
    }
    setInjectMessage(parsed.message);
    setBanner(parsed.message);
    setStatus(
      parsed.type === "decline"
        ? "Hospital cannot accept — see message below."
        : "Hospital accepted — see acknowledgment below.",
    );
    if (parsed.type === "decline" && match) {
      setCases((list) => list.filter((c) => c.id !== match.id));
      if (activeCaseId === match.id) setActiveCaseId(null);
    }
  });

  useSubscription(INFO_REQUEST_COMM_CRITERIA, (bundle: Bundle) => {
    const comm = communicationFromBundle(bundle);
    const raw = comm?.payload?.[0]?.contentString;
    if (!raw) return;
    const parsed = parseInfoRequestPayload(raw);
    if (!parsed) return;
    const match = casesRef.current.find(
      (c) =>
        !parsed.serviceRequestId ||
        c.serviceRequestId === parsed.serviceRequestId,
    );
    const ask: OpenInfoAsk = {
      id: comm?.id ?? crypto.randomUUID(),
      labels: parsed.labels,
      message: parsed.message,
      serviceRequestId: parsed.serviceRequestId,
    };
    setOpenAsks((prev) => {
      if (prev.some((a) => a.id === ask.id)) return prev;
      return [...prev, ask];
    });
    if (match && activeCaseId && match.id !== activeCaseId) {
      setStatus(
        `Info request on case ${caseShortId(match)}: ${parsed.labels.join(", ")}`,
      );
      return;
    }
    setInjectMessage(parsed.message);
    setBanner(parsed.message);
    setStatus("Hospital requested more info — agent will ask when voice is on.");
  });

  useSubscription(BRIDGE_COMM_CRITERIA, (bundle: Bundle) => {
    const comm = communicationFromBundle(bundle);
    const raw = comm?.payload?.[0]?.contentString;
    if (!raw) return;
    const parsed = parseBridgePayload(raw);
    if (!parsed || parsed.from === "ems") return;
    const match = casesRef.current.find(
      (c) =>
        !parsed.serviceRequestId ||
        c.serviceRequestId === parsed.serviceRequestId,
    );
    if (match && activeCaseId && match.id !== activeCaseId) {
      setStatus(`Live connect request on case ${caseShortId(match)}`);
      return;
    }
    setInjectMessage(parsed.message);
    setBanner(parsed.message);
    setStatus("Hospital requested live radio/phone connect.");
    if (activeCase?.encounterId) void refreshChannel(activeCase.encounterId);
  });

  useSubscription(CHANNEL_COMM_CRITERIA, () => {
    if (activeCase?.encounterId) void refreshChannel(activeCase.encounterId);
  });

  // Debounced live patch for active case only. Depend on card + case id, not the
  // whole handoff object — a successful patch used to replace that object and
  // retrigger another write.
  useEffect(() => {
    const handoff = activeCaseRef.current;
    if (!handoff?.communicationId && !handoff?.encounterId) return;
    if (patchTimer.current) clearTimeout(patchTimer.current);
    patchTimer.current = setTimeout(() => {
      const current = activeCaseRef.current;
      if (!current?.communicationId && !current?.encounterId) return;
      void patchHandoffCard(medplum, current, card)
        .then((next) => {
          setCases((list) => {
            let changed = false;
            const mapped = list.map((c) => {
              if (c.id !== next.id) return c;
              if (c.communicationId === next.communicationId) return c;
              changed = true;
              return { ...next, card };
            });
            return changed ? mapped : list;
          });
        })
        .catch((err) => {
          setStatus(err instanceof Error ? err.message : "Live patch failed");
        });
    }, 400);
    return () => {
      if (patchTimer.current) clearTimeout(patchTimer.current);
    };
  }, [card, medplum, activeCase?.id]);

  useEffect(() => {
    const value = card.lastOralIntake?.trim();
    const handoff = activeCaseRef.current;
    if (!value || !handoff?.encounterId || !handoff.patientId) return;
    const key = `${handoff.id}:${value}`;
    if (wroteOralRef.current[key]) return;
    wroteOralRef.current[key] = value;
    void (async () => {
      try {
        await writeOralIntakeObservation(medplum, handoff, value);
        setStatus(`Oral intake sent: ${value}`);
        setOpenAsks((asks) =>
          asks.filter(
            (a) =>
              a.serviceRequestId !== handoff.serviceRequestId ||
              !a.labels.some((l) => /oral/i.test(l)),
          ),
        );
      } catch (err) {
        delete wroteOralRef.current[key];
        setStatus(err instanceof Error ? err.message : "Failed to write oral intake");
      }
    })();
  }, [card.lastOralIntake, activeCase?.id, activeCase?.encounterId, activeCase?.patientId, medplum]);

  // Clear satisfied info-asks when blood type lands on the card (patched live to hospital).
  useEffect(() => {
    if (!card.bloodType?.trim() || !activeCase?.serviceRequestId) return;
    setOpenAsks((asks) =>
      asks.filter(
        (a) =>
          a.serviceRequestId !== activeCase.serviceRequestId ||
          !a.labels.some((l) => /blood/i.test(l)),
      ),
    );
  }, [card.bloodType, activeCase?.serviceRequestId]);

  const openIncoming = useCallback(
    async (seed?: TraumaCard) => {
      if (activeCase) {
        setStatus(`Case ${caseShortId(activeCase)} already open at hospital.`);
        return activeCase;
      }
      const payload = seed ?? card;
      try {
        const handoff = await createDraftHandoff(medplum, {
          ...payload,
          etaCapturedAt: payload.etaCapturedAt ?? new Date().toISOString(),
        });
        setCases((list) => [...list, handoff]);
        setActiveCaseId(handoff.id);
        setCardsById((m) => ({ ...m, [handoff.id]: payload }));
        setStatus(`Incoming opened · Case ${caseShortId(handoff)}`);
        return handoff;
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "Failed to open Incoming");
        return null;
      }
    },
    [medplum, card, activeCase],
  );

  const onVoiceStarted = useCallback(async () => {
    await openIncoming();
  }, [openIncoming]);

  async function onNewPatient() {
    setBusy(true);
    setStatus(null);
    setInjectMessage(null);
    setBanner(null);
    setReportText("");
    setLocalCard({ ...EMPTY_TRAUMA_CARD });
    try {
      const empty = {
        ...EMPTY_TRAUMA_CARD,
        etaCapturedAt: new Date().toISOString(),
      };
      const handoff = await createDraftHandoff(medplum, empty);
      setCases((list) => [...list, handoff]);
      setActiveCaseId(handoff.id);
      setCardsById((m) => ({ ...m, [handoff.id]: empty }));
      setStatus(`New patient · Case ${caseShortId(handoff)} (Incoming at hospital)`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "New patient failed");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm() {
    setBusy(true);
    setStatus(null);
    try {
      let handoff = activeCase;
      if (!handoff) {
        handoff = await createDraftHandoff(medplum, {
          ...card,
          etaCapturedAt: card.etaCapturedAt ?? new Date().toISOString(),
        });
        setCases((list) => [...list, handoff!]);
        setActiveCaseId(handoff.id);
      }
      const confirmed = await confirmHandoff(medplum, handoff, {
        ...card,
        etaCapturedAt: card.etaCapturedAt ?? new Date().toISOString(),
      });
      setCases((list) =>
        list.map((c) => (c.id === confirmed.id ? { ...confirmed, card } : c)),
      );
      setStatus(`Confirmed · Case ${caseShortId(confirmed)}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setBusy(false);
    }
  }

  async function onBridge() {
    const handoff = activeCase ?? (await openIncoming());
    if (!handoff) return;
    setBusy(true);
    try {
      await requestBridge(medplum, handoff, "ems");
      setStatus("Live connect requested to hospital.");
      await refreshChannel(handoff.encounterId);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Bridge failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSendChannel() {
    const handoff = activeCase;
    if (!handoff) return;
    try {
      await postChannelMessage(medplum, handoff, "ems", channelDraft);
      setChannelDraft("");
      await refreshChannel(handoff.encounterId);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Send failed");
    }
  }

  const caseAsks = openAsks.filter(
    (a) =>
      !activeCase?.serviceRequestId ||
      a.serviceRequestId === activeCase.serviceRequestId,
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            My cases
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onNewPatient()}
            className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            New patient
          </button>
        </div>
        <ul className="mt-3 space-y-1">
          {cases.length === 0 ? (
            <li className="rounded-md border border-dashed border-zinc-800 px-3 py-4 text-center text-xs text-zinc-600">
              No open cases yet
            </li>
          ) : (
            cases.map((c) => {
              const active = c.id === activeCaseId;
              const cCard = cardsById[c.id] ?? c.card;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveCaseId(c.id);
                      setLocalCard(cardsById[c.id] ?? c.card);
                    }}
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                      active
                        ? "border-teal-600/60 bg-teal-950/30 ring-1 ring-teal-700/40"
                        : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
                    }`}
                  >
                    <span className="font-mono text-[10px] text-zinc-500">
                      {caseShortId(c)} · {c.handoffStatus}
                    </span>
                    <p className="mt-1 truncate text-zinc-200">
                      {caseTitle({ ...c, card: cCard })}
                    </p>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </aside>

      <div>
        <TraumaCardView card={card} handoff={activeCase} />

        {caseAsks.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-800/40 bg-amber-950/20 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
              Open hospital asks
            </p>
            <ul className="mt-2 space-y-1 text-sm text-amber-100/90">
              {caseAsks.map((a) => (
                <li key={a.id}>• {a.labels.join(", ")}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4">
          <VoiceHandoff
            card={card}
            onCardChange={setCard}
            injectMessage={injectMessage}
            onVoiceStarted={onVoiceStarted}
          />
        </div>

        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-400">
              Quick Field Actions
            </p>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-zinc-500">Adjust ETA:</span>
              {[-2, 2, 5].map((delta) => (
                <button
                  key={delta}
                  type="button"
                  onClick={() => {
                    const current = card.etaMinutes ?? 10;
                    const nextEta = Math.max(1, current + delta);
                    setCard({
                      ...card,
                      etaMinutes: nextEta,
                      etaCapturedAt: new Date().toISOString(),
                    });
                  }}
                  className="rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 font-mono text-[11px] text-zinc-300 hover:border-zinc-500"
                >
                  {delta > 0 ? `+${delta}` : delta}m
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <p className="text-xs text-zinc-500">Critical prehospital interventions:</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {COMMON_INTERVENTIONS.map((intv) => {
                const active = card.interventions?.includes(intv);
                return (
                  <button
                    key={intv}
                    type="button"
                    onClick={() => {
                      const current = card.interventions ?? [];
                      const next = active
                        ? current.filter((i) => i !== intv)
                        : [...current, intv];
                      setCard({
                        ...card,
                        interventions: next,
                      });
                    }}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                      active
                        ? "bg-emerald-900/80 text-emerald-200 ring-1 ring-emerald-500"
                        : "border border-zinc-700 bg-zinc-950 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                    }`}
                  >
                    {active ? "✓ " : "+ "}
                    {intv}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
            Text fallback
          </p>
          <textarea
            value={reportText}
            onChange={(e) => setReportText(e.target.value)}
            rows={3}
            placeholder="Paste handoff report…"
            className="mt-3 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void openIncoming()}
              className="rounded-md border border-zinc-600 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
            >
              Open Incoming card
            </button>
            <button
              type="button"
              disabled={busy || !reportText.trim()}
              onClick={() => {
                const next = applyHandoffText(card, reportText);
                setCard(next);
                setStatus("Applied text to active case.");
                if (!activeCase) void openIncoming(next);
              }}
              className="rounded-md border border-zinc-600 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
            >
              Apply text to card
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <CaseChannel
            channel={channel}
            emptyLabel="No messages for this case."
            draft={channelDraft}
            onDraftChange={setChannelDraft}
            onSend={() => onSendChannel()}
            placeholder="Message hospital…"
            disabled={!activeCase}
            quickPhrases={EMS_QUICK_PHRASES}
            listClassName="max-h-32"
            actions={
              <button
                type="button"
                disabled={busy}
                onClick={() => void onBridge()}
                className="rounded-md border border-sky-800/60 px-3 py-1.5 text-sm text-sky-100 disabled:opacity-50"
              >
                Request live connect
              </button>
            }
          />
        </div>

        {banner && (
          <div
            className="mt-4 rounded-md border border-teal-700/50 bg-teal-950/40 px-4 py-3 text-sm text-teal-100"
            role="status"
          >
            {banner}
          </div>
        )}

        <div className="mt-6 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Demo Scenarios:
            </span>
            {DEMO_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  const next = {
                    ...p.card,
                    etaCapturedAt: new Date().toISOString(),
                  };
                  setCard(next);
                  setReportText(p.reportText);
                  setStatus(`Loaded ${p.name}`);
                  setInjectMessage(null);
                  setBanner(null);
                  if (!activeCase) void openIncoming(next);
                }}
                className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700"
              >
                {p.name.split(" · ")[0]}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!hasData || busy || activeCase?.handoffStatus === "confirmed"}
              onClick={() => void onConfirm()}
              className="rounded-md border border-teal-600/80 bg-teal-700/30 px-5 py-2.5 text-sm font-medium text-teal-100 enabled:hover:bg-teal-700/50 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-transparent disabled:text-zinc-500"
            >
              {busy
                ? "Confirming…"
                : activeCase?.handoffStatus === "confirmed"
                  ? "Confirmed"
                  : "Confirm handoff"}
            </button>
          </div>
        </div>

        {status && (
          <p className="mt-4 text-sm text-teal-300/90" role="status">
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
