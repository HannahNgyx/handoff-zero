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
  etaMinutes?: number;
  field?: string;
  value?: string;
};

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
    bloodType: raw.bloodType ?? card.bloodType,
    lastOralIntake: raw.lastOralIntake ?? card.lastOralIntake,
    emergencyContact: raw.emergencyContact ?? card.emergencyContact,
    etaMinutes: raw.etaMinutes ?? card.etaMinutes,
    etaCapturedAt: card.etaCapturedAt ?? new Date().toISOString(),
  };
}

const AGENT_PROMPT = `You are TraumaLink, an EMS pre-arrival handoff coordinator speaking with a paramedic.
Extract structured trauma data using update_trauma_card whenever you hear demographics, vitals, injuries, allergies, anticoagulants, or ETA.
Always speak a short spoken reply after tool calls (one sentence). Never stay silent after updating the card.
After updating, call get_missing_fields and ask for at most one missing clinical detail if urgent (prefer last oral intake).
Do not invent values. Use update_field when the paramedic answers a follow-up.
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-teal-400/90">
            Deepgram voice
          </p>
          <p className="mt-1 font-mono text-xs text-zinc-400">
            {state}
            {isConnected ? ` · ${mode}` : ""}
            {isConnected ? ` · mic ${micMuted ? "muted" : "open"}` : ""}
            {isConnected ? ` · tts ${ttsEnabled ? "on" : "off"}` : ""}
          </p>
          {isConnected && (
            <p className="mt-0.5 font-mono text-[10px] text-zinc-600">
              in {levels.in}% · out {levels.out}%
            </p>
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
      const next: TraumaCard = {
        ...cardRef.current,
        [args.field]: args.value,
        etaCapturedAt: cardRef.current.etaCapturedAt ?? new Date().toISOString(),
      };
      cardRef.current = next;
      onCardChangeRef.current(next);
      return JSON.stringify({ ok: true, field: args.field, value: args.value });
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
