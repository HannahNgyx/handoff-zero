"use client";

import {
  getMissingFields,
  type TraumaCard,
} from "@/lib/trauma";
import type { AgentSessionConfig, FunctionCallItem } from "@deepgram/agents";
import {
  AgentProvider,
  useAgentConversation,
  useAgentMicrophone,
  useAgentMode,
  useAgentPlayer,
  useAgentSession,
  useAgentState,
} from "@deepgram/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TraumaArgs = {
  age?: number;
  sex?: TraumaCard["sex"];
  mechanism?: string;
  bpSystolic?: number;
  bpDiastolic?: number;
  heartRate?: number;
  gcs?: number;
  injury?: string;
  allergy?: string;
  anticoagulants?: string;
  bloodType?: string;
  lastOralIntake?: string;
  emergencyContact?: string;
  interventions?: string[];
  etaMinutes?: number;
  field?: string;
  value?: string;
};

const FIELD_ALIASES: Record<string, keyof TraumaCard> = {
  bloodtype: "bloodType",
  "blood type": "bloodType",
  blood_type: "bloodType",
  lastoralintake: "lastOralIntake",
  "last oral intake": "lastOralIntake",
  oralintake: "lastOralIntake",
  emergencycontact: "emergencyContact",
  "emergency contact": "emergencyContact",
  allergy: "allergy",
  anticoagulants: "anticoagulants",
  injury: "injury",
  mechanism: "mechanism",
};

function normalizeFieldKey(field: string): keyof TraumaCard | null {
  const direct = field as keyof TraumaCard;
  if (
    direct === "bloodType" ||
    direct === "lastOralIntake" ||
    direct === "emergencyContact" ||
    direct === "allergy" ||
    direct === "anticoagulants" ||
    direct === "injury" ||
    direct === "mechanism"
  ) {
    return direct;
  }
  return FIELD_ALIASES[field.toLowerCase().trim()] ?? null;
}

export function applyTraumaArgs(card: TraumaCard, raw: TraumaArgs): TraumaCard {
  return {
    ...card,
    age: raw.age ?? card.age,
    sex: raw.sex ?? card.sex,
    mechanism: raw.mechanism ?? card.mechanism,
    vitals: {
      bpSystolic: raw.bpSystolic ?? card.vitals.bpSystolic,
      bpDiastolic: raw.bpDiastolic ?? card.vitals.bpDiastolic,
      heartRate: raw.heartRate ?? card.vitals.heartRate,
      gcs: raw.gcs ?? card.vitals.gcs,
    },
    injury: raw.injury ?? card.injury,
    allergy: raw.allergy ?? card.allergy,
    anticoagulants: raw.anticoagulants ?? card.anticoagulants,
    bloodType: raw.bloodType
      ? String(raw.bloodType).trim().toUpperCase()
      : card.bloodType,
    lastOralIntake: raw.lastOralIntake ?? card.lastOralIntake,
    emergencyContact: raw.emergencyContact ?? card.emergencyContact,
    interventions: raw.interventions ?? card.interventions,
    etaMinutes: raw.etaMinutes ?? card.etaMinutes,
    etaCapturedAt: card.etaCapturedAt ?? new Date().toISOString(),
  };
}

const AGENT_PROMPT = `You are TraumaLink, an EMS pre-arrival handoff coordinator speaking with a paramedic.
Extract structured trauma data using update_trauma_card whenever you hear demographics, vitals, injuries, allergies, anticoagulants, or ETA.
When you hear blood pressure (e.g. "92 over 60"), always set both bpSystolic and bpDiastolic.
Always speak a short spoken reply after tool calls (one sentence). Never stay silent after updating the card.
After updating, call get_missing_fields and ask for at most one missing clinical detail if urgent (prefer last oral intake).
Do not invent values. Use update_field when the paramedic answers a follow-up (field names: bloodType, lastOralIntake, emergencyContact, allergy, anticoagulants).
When they say a blood type like O positive or A-, call update_field with field bloodType.
Ignore background noise, sirens, and radio static — only react to clear speech.`;

function buildAgentConfig(): AgentSessionConfig {
  return {
    auth: {
      tokenFactory: async () => {
        const res = await fetch("/api/deepgram/token");
        const data = (await res.json()) as { access_token?: string; error?: string };
        if (!res.ok || !data.access_token) {
          throw new Error(data.error || "Failed to get Deepgram token");
        }
        return data.access_token;
      },
    },
    audio: {
      input: { encoding: "linear16", sampleRate: 16_000 },
      output: { encoding: "linear16", sampleRate: 24_000 },
    },
    agent: {
      language: "en",
      greeting:
        "TraumaLink ready. Go ahead with the patient handoff when you are.",
      listen: {
        provider: {
          type: "deepgram",
          model: "nova-3",
          version: "v1",
          language: "en",
          smart_format: true,
          keyterms: [
            "GCS",
            "femur",
            "penicillin",
            "anticoagulant",
            "ETA",
            "systolic",
            "diastolic",
          ],
        },
      },
      think: {
        provider: { type: "open_ai", model: "gpt-4o-mini" },
        prompt: AGENT_PROMPT,
        functions: [
          {
            name: "update_trauma_card",
            description:
              "Update the live trauma handoff card with any fields extracted from the paramedic report.",
            parameters: {
              type: "object",
              properties: {
                age: { type: "number" },
                sex: {
                  type: "string",
                  enum: ["female", "male", "other", "unknown"],
                },
                mechanism: { type: "string" },
                bpSystolic: { type: "number" },
                bpDiastolic: { type: "number" },
                heartRate: { type: "number" },
                gcs: { type: "number" },
                injury: { type: "string" },
                allergy: { type: "string" },
                anticoagulants: { type: "string" },
                bloodType: { type: "string" },
                lastOralIntake: { type: "string" },
                emergencyContact: { type: "string" },
                interventions: {
                  type: "array",
                  items: { type: "string" },
                  description: "Prehospital critical interventions performed (e.g. Tourniquet, Pelvic Binder, TXA, Large Bore IV, Intubated).",
                },
                etaMinutes: { type: "number" },
              },
            },
          },
          {
            name: "get_missing_fields",
            description: "Return clinically missing fields on the trauma card.",
            parameters: { type: "object", properties: {} },
          },
          {
            name: "update_field",
            description:
              "Patch a single trauma card field after a follow-up answer.",
            parameters: {
              type: "object",
              properties: {
                field: {
                  type: "string",
                  enum: [
                    "bloodType",
                    "lastOralIntake",
                    "emergencyContact",
                    "allergy",
                    "anticoagulants",
                    "injury",
                    "mechanism",
                  ],
                },
                value: { type: "string" },
              },
              required: ["field", "value"],
            },
          },
        ],
      },
      speak: {
        provider: { type: "deepgram", model: "aura-2-thalia-en" },
      },
    },
  };
}

function VoiceControls({
  injectMessage,
  onVoiceStarted,
}: {
  injectMessage: string | null;
  onVoiceStarted?: () => void | Promise<void>;
}) {
  const { start, stop, isConnected, isConnecting, state } = useAgentState();
  const { mode, isSpeaking } = useAgentMode();
  const { conversation } = useAgentConversation();
  const { setMicMuted, micMuted, getInputVolume } = useAgentMicrophone();
  const { enabled: ttsEnabled, getOutputVolume } = useAgentPlayer();
  const session = useAgentSession();
  const lastInjected = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState({ in: 0, out: 0 });

  // Mute mic while agent speaks so TTS/echo does not barge in.
  useEffect(() => {
    if (!isConnected) return;
    setMicMuted(isSpeaking);
  }, [isConnected, isSpeaking, setMicMuted]);

  useEffect(() => {
    if (!injectMessage || !isConnected) return;
    if (lastInjected.current === injectMessage) return;
    lastInjected.current = injectMessage;
    try {
      session.injectAgentMessage(injectMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inject failed");
    }
  }, [injectMessage, isConnected, session]);

  useEffect(() => {
    if (!isConnected) return;
    let raf = 0;
    const tick = () => {
      setLevels({
        in: Math.round(getInputVolume() * 100),
        out: Math.round(getOutputVolume() * 100),
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isConnected, getInputVolume, getOutputVolume]);

  async function onToggle() {
    setError(null);
    try {
      if (isConnected) {
        stop();
      } else {
        await start();
        if (onVoiceStarted) await onVoiceStarted();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice connect failed");
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-teal-400/90">
              Deepgram voice
            </p>
            {isConnected && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  isSpeaking
                    ? "bg-teal-900/60 text-teal-300 ring-1 ring-teal-500/50"
                    : mode === "listening"
                      ? "bg-emerald-900/60 text-emerald-300 ring-1 ring-emerald-500/50"
                      : "bg-zinc-800 text-zinc-400"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isSpeaking
                      ? "bg-teal-400 animate-ping"
                      : mode === "listening"
                        ? "bg-emerald-400 animate-pulse"
                        : "bg-zinc-500"
                  }`}
                />
                {isSpeaking ? "Speaking" : mode === "listening" ? "Listening" : mode}
              </span>
            )}
          </div>
          <p className="mt-1 font-mono text-xs text-zinc-400">
            {state}
            {isConnected ? ` · mic ${micMuted ? "muted" : "open"}` : ""}
            {isConnected ? ` · tts ${ttsEnabled ? "on" : "off"}` : ""}
          </p>
          {isConnected && (
            <div className="mt-2 flex items-center gap-3 font-mono text-[10px] text-zinc-500">
              <div className="flex items-center gap-1.5">
                <span>Mic</span>
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-75"
                    style={{ width: `${Math.min(100, levels.in * 1.5)}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span>Voice</span>
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full bg-teal-400 transition-all duration-75"
                    style={{ width: `${Math.min(100, levels.out * 1.5)}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={isConnecting}
          onClick={() => void onToggle()}
          className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50"
        >
          {isConnecting
            ? "Connecting…"
            : isConnected
              ? "Stop voice"
              : "Start voice handoff"}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
      {conversation.length > 0 && (
        <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-xs text-zinc-400">
          {conversation.slice(-8).map((msg) => (
            <li key={msg.id}>
              <span className="text-zinc-500">{msg.role}:</span> {msg.content}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function VoiceHandoff({
  card,
  onCardChange,
  injectMessage,
  onVoiceStarted,
}: {
  card: TraumaCard;
  onCardChange: (card: TraumaCard) => void;
  /** Hospital accept / info-request lines injected into the live agent. */
  injectMessage: string | null;
  /** Fired after voice session connects (create draft hospital card). */
  onVoiceStarted?: () => void | Promise<void>;
}) {
  const cardRef = useRef(card);
  cardRef.current = card;
  const onCardChangeRef = useRef(onCardChange);
  onCardChangeRef.current = onCardChange;

  const config = useMemo(() => buildAgentConfig(), []);

  const handleFunctionCall = useCallback(async (fn: FunctionCallItem) => {
    const args = (() => {
      try {
        return JSON.parse(fn.arguments || "{}") as TraumaArgs;
      } catch {
        return {} as TraumaArgs;
      }
    })();

    if (fn.name === "update_trauma_card") {
      const next = applyTraumaArgs(cardRef.current, args);
      cardRef.current = next;
      onCardChangeRef.current(next);
      return JSON.stringify({ ok: true, missing: getMissingFields(next) });
    }

    if (fn.name === "get_missing_fields") {
      return JSON.stringify({ missing: getMissingFields(cardRef.current) });
    }

    if (fn.name === "update_field" && args.field && args.value != null) {
      const fieldKey = normalizeFieldKey(args.field);
      if (!fieldKey) {
        return JSON.stringify({ error: `Unknown field ${args.field}` });
      }
      const value =
        fieldKey === "bloodType"
          ? String(args.value).trim().toUpperCase()
          : String(args.value);
      const next: TraumaCard = {
        ...cardRef.current,
        [fieldKey]: value,
        etaCapturedAt: cardRef.current.etaCapturedAt ?? new Date().toISOString(),
      };
      cardRef.current = next;
      onCardChangeRef.current(next);
      return JSON.stringify({ ok: true, field: fieldKey, value });
    }

    return JSON.stringify({ error: `Unknown function ${fn.name}` });
  }, []);

  return (
    <AgentProvider
      config={config}
      microphone
      microphoneOptions={{
        sampleRate: 16_000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }}
      tts
      playerSampleRate={24_000}
      onFunctionCall={handleFunctionCall}
    >
      <VoiceControls
        injectMessage={injectMessage}
        onVoiceStarted={onVoiceStarted}
      />
    </AgentProvider>
  );
}
