"use client";

import {
  LiveKitRoom,
  VideoConference,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
} from "@livekit/components-react";
import { useKrispNoiseFilter } from "@livekit/components-react/krisp";
import { AlertTriangle, AudioLines, Check, Copy, Users } from "lucide-react";
import Image from "next/image";
import {
  AudioPresets,
  DefaultReconnectPolicy,
  DisconnectReason,
  RoomEvent,
  VideoPresets,
} from "livekit-client";
import { useEffect, useMemo, useState } from "react";
import AudioQualityIndicator from "./AudioQualityIndicator";
import type { MeetingSession } from "./CallApp";
import {
  loadDevicePreferences,
  saveDevicePreferences,
} from "./device-preferences";
import { krispSupport } from "./noise-filter";

function roomLabel(room: string) {
  return (
    room
      .replace(/^ctc-/, "")
      .toUpperCase()
      .match(/.{1,4}/g)
      ?.join("-") ?? ""
  );
}

const DISCONNECT_MESSAGES: Partial<Record<DisconnectReason, string>> = {
  [DisconnectReason.DUPLICATE_IDENTITY]:
    "Встреча открыта в другом окне или вкладке.",
  [DisconnectReason.SERVER_SHUTDOWN]:
    "Сервер встречи перезапустился. Попробуйте войти снова.",
  [DisconnectReason.PARTICIPANT_REMOVED]:
    "Организатор удалил вас из встречи.",
  [DisconnectReason.ROOM_DELETED]: "Встреча была закрыта.",
  [DisconnectReason.STATE_MISMATCH]:
    "Соединение сброшено сервером. Попробуйте войти снова.",
  [DisconnectReason.JOIN_FAILURE]:
    "Не удалось подключиться к комнате. Попробуйте ещё раз.",
  [DisconnectReason.SIGNAL_CLOSE]:
    "Потеряно соединение с сервером. Попробуйте войти снова.",
  [DisconnectReason.ROOM_CLOSED]: "Встреча была закрыта.",
};

function disconnectMessage(reason?: DisconnectReason) {
  if (
    reason === undefined ||
    reason === DisconnectReason.CLIENT_INITIATED ||
    reason === DisconnectReason.UNKNOWN_REASON
  ) {
    return "";
  }
  return (
    DISCONNECT_MESSAGES[reason] ??
    "Связь со встречей прервалась. Попробуйте войти снова."
  );
}

export default function MeetingRoom({
  session,
  onLeave,
  onNoiseFilterChange,
}: {
  session: MeetingSession;
  onLeave: (message?: string) => void;
  onNoiseFilterChange: (enabled: boolean) => void;
}) {
  const [noiseFilterSupported, setNoiseFilterSupported] = useState<
    boolean | null
  >(null);
  const [connectionError, setConnectionError] = useState("");
  const [connectAttempt, setConnectAttempt] = useState(0);
  const noiseFilterEnabled = session.noiseFilterEnabled;

  useEffect(() => {
    let active = true;
    krispSupport().then((supported) => {
      if (active) setNoiseFilterSupported(supported);
    });
    return () => {
      active = false;
    };
  }, []);

  if (noiseFilterSupported === null) {
    return (
      <div className="meeting-shell">
        <div className="meeting-loading">
          <Image
            className="brand-mark mini"
            src="/saytosee-mark.png"
            alt=""
            width={30}
            height={25}
          />
          <p>Подготавливаем звук и шумодав…</p>
        </div>
      </div>
    );
  }

  // Krisp сам подавляет шум: встроенное подавление браузера и изоляцию
  // голоса (Chrome 124+) при этом выключаем — двойная обработка портит голос.
  // Если Krisp недоступен или выключен, используем лучший нативный стек.
  const nativeSuppression = !(noiseFilterSupported && noiseFilterEnabled);

  return (
    <div className="meeting-shell" data-lk-theme="default">
      <LiveKitRoom
        key={connectAttempt}
        token={session.token}
        serverUrl={session.serverUrl}
        connect
        audio={session.audioEnabled}
        video={session.videoEnabled}
        onError={(error) => {
          setConnectionError(
            error instanceof Error
              ? error.message
              : "Не удалось установить соединение",
          );
        }}
        options={{
          adaptiveStream: true,
          dynacast: true,
          // Стандартная политика сдаётся через ~31 c (10 попыток). Расширенный
          // список держит участника в комнате ~90 c — переживает переключение
          // Wi-Fi → LTE и короткие обрывы канала без возврата на лендинг.
          reconnectPolicy: new DefaultReconnectPolicy([
            0, 300, 1200, 2700, 4800, 7000, 7000, 7000, 7000, 7000, 7000,
            7000, 7000, 7000, 7000, 7000,
          ]),
          audioCaptureDefaults: {
            // exact, а не ideal: Chromium при ideal молча откатывается на
            // устройство по умолчанию. Точность гарантирует выбранный микрофон;
            // исчезнувшее устройство отсеивается на лендинге до входа.
            deviceId: session.devices.mic
              ? { exact: session.devices.mic }
              : undefined,
            autoGainControl: true,
            channelCount: { ideal: 1 },
            echoCancellation: true,
            noiseSuppression: nativeSuppression,
            voiceIsolation: nativeSuppression,
          },
          videoCaptureDefaults: {
            deviceId: session.devices.cam
              ? { exact: session.devices.cam }
              : undefined,
            // 24 fps вместо 30 — минус ~20% работы кодера; камеры без
            // 24 fps автоматически отдадут ближайший режим (обычно 30)
            resolution: {
              ...VideoPresets.h720.resolution,
              frameRate: 24,
            },
          },
          audioOutput: session.devices.speaker
            ? { deviceId: session.devices.speaker }
            : undefined,
          publishDefaults: {
            audioPreset: AudioPresets.music,
            dtx: false,
            forceStereo: false,
            red: true,
            simulcast: true,
            // H.264 кодируется аппаратно почти на всех устройствах;
            // VP8 в Chrome работает программно и держит ядро CPU.
            // У кого нет H.264 — автоматический откат на VP8.
            videoCodec: "h264",
            backupCodec: true,
            // При нехватке CPU или канала браузер снижает разрешение,
            // а не замораживает картинку — звонок остаётся плавным.
            degradationPreference: "maintain-framerate",
            videoEncoding: VideoPresets.h720.encoding,
            videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
            // Без DTX замьюченный микрофон продолжает лить тишину на полном
            // битрейте; остановка трека экономит канал и батарею.
            stopMicTrackOnMute: true,
          },
        }}
      >
        {/* VideoConference уже включает собственный RoomAudioRenderer —
            второй рендерер дублировал бы звук каждого участника (эхо). */}
        <MeetingChrome
          session={session}
          onLeave={onLeave}
          noiseFilterSupported={noiseFilterSupported}
          noiseFilterEnabled={noiseFilterEnabled}
          onNoiseFilterToggle={() => onNoiseFilterChange(!noiseFilterEnabled)}
          connectionError={connectionError}
          onReconnect={() => {
            setConnectionError("");
            setConnectAttempt((value) => value + 1);
          }}
        />
      </LiveKitRoom>
    </div>
  );
}

function MeetingChrome({
  session,
  onLeave,
  noiseFilterSupported,
  noiseFilterEnabled,
  onNoiseFilterToggle,
  connectionError,
  onReconnect,
}: {
  session: MeetingSession;
  onLeave: (message?: string) => void;
  noiseFilterSupported: boolean;
  noiseFilterEnabled: boolean;
  onNoiseFilterToggle: () => void;
  connectionError: string;
  onReconnect: () => void;
}) {
  const participants = useParticipants();
  const room = useRoomContext();
  const [copied, setCopied] = useState(false);

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(session.inviteUrl);
    } catch {
      const input = document.createElement("textarea");
      input.value = session.inviteUrl;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  useEffect(() => {
    const handleDisconnect = (reason?: DisconnectReason) => {
      onLeave(disconnectMessage(reason) || undefined);
    };
    room.on(RoomEvent.Disconnected, handleDisconnect);
    // Смена устройства в комнате (через меню в панели управления) обновляет
    // сохранённый выбор — следующий вход сразу использует его
    const handleDeviceChange = (kind: MediaDeviceKind, deviceId: string) => {
      const current = loadDevicePreferences();
      if (kind === "audioinput") current.mic = deviceId || undefined;
      else if (kind === "videoinput") current.cam = deviceId || undefined;
      else if (kind === "audiooutput") current.speaker = deviceId || undefined;
      else return;
      saveDevicePreferences(current);
    };
    room.on(RoomEvent.ActiveDeviceChanged, handleDeviceChange);
    return () => {
      room.off(RoomEvent.Disconnected, handleDisconnect);
      room.off(RoomEvent.ActiveDeviceChanged, handleDeviceChange);
    };
  }, [onLeave, room]);

  return (
    <div className="meeting-layout">
      <header className="meeting-header">
        <div className="meeting-brand">
          <Image className="brand-mark mini" src="/saytosee-mark.png" alt="" width={30} height={25} />
          <span>SayToSee</span>
        </div>
        <div className="meeting-meta">
          <CallTimer />
          <span className="meeting-code">
            Встреча {roomLabel(session.room)}
          </span>
        </div>
        <div className="header-actions">
          <span className="participant-count">
            <Users size={16} />
            {participants.length}/10
          </span>
          <button
            className="copy-button"
            onClick={() => void copyInvite()}
            title={session.inviteUrl}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "Скопировано" : "Копировать ссылку"}
          </button>
        </div>
      </header>

      <div className="conference-wrap">
        {connectionError && (
          <div className="meeting-alert" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>
              Проблема с соединением: {connectionError}. Проверьте интернет и
              попробуйте снова.
            </span>
            <button type="button" onClick={onReconnect}>
              Переподключиться
            </button>
          </div>
        )}
        <VideoConference />
      </div>

      <div className="meeting-note">
        <NoiseFilterToggle
          supported={noiseFilterSupported}
          enabled={noiseFilterEnabled}
          onToggle={onNoiseFilterToggle}
        />
        <AudioQualityIndicator />
        <span className="meeting-role">
          {session.isHost
            ? "Вы организатор · адаптивный WebRTC через SFU"
            : "Защищённое WebRTC-соединение установлено"}
        </span>
      </div>
    </div>
  );
}

/**
 * Таймер звонка живёт в собственном компоненте: иначе секундный тик
 * перерендеривал бы всё дерево комнаты вместе с VideoConference.
 */
function CallTimer() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const interval = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(interval);
  }, []);

  const time = useMemo(() => {
    const minutes = Math.floor(elapsed / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (elapsed % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, [elapsed]);

  return (
    <span className="live-pill">
      <i />
      {time}
    </span>
  );
}

function NoiseFilterToggle({
  supported,
  enabled,
  onToggle,
}: {
  supported: boolean;
  enabled: boolean;
  onToggle: () => void;
}) {
  const { microphoneTrack } = useLocalParticipant();
  const hasMicTrack = Boolean(microphoneTrack?.track);
  const { setNoiseFilterEnabled, isNoiseFilterEnabled, isNoiseFilterPending } =
    useKrispNoiseFilter({
      filterOptions: useMemo(() => {
        // На слабых машинах (≤4 ядер) нейросеть Krisp работает в режиме low —
        // заметно меньше CPU при чуть более простом подавлении шума.
        const cores = navigator.hardwareConcurrency || 4;
        return { quality: cores <= 4 ? "low" : "medium" };
      }, []),
    });

  // Держим процессор в sync с тумблером. Без микрофонного трека не вызываем
  // хук вовсе: setNoiseFilterEnabled без трека вечно висит в pending, а
  // включение микрофона перерендерит компонент и эффект применит фильтр.
  useEffect(() => {
    if (
      !supported ||
      !hasMicTrack ||
      isNoiseFilterPending ||
      isNoiseFilterEnabled === enabled
    ) {
      return;
    }
    void setNoiseFilterEnabled(enabled);
  }, [
    supported,
    hasMicTrack,
    enabled,
    isNoiseFilterEnabled,
    isNoiseFilterPending,
    setNoiseFilterEnabled,
  ]);

  const label = !supported
    ? "Шумодав: браузерный"
    : isNoiseFilterPending
      ? "Шумодав: переключаем…"
      : enabled
        ? "Шумодав: AI"
        : "Шумодав: выкл";

  return (
    <button
      type="button"
      className={
        supported && enabled ? "noise-toggle active" : "noise-toggle"
      }
      onClick={onToggle}
      disabled={!supported || isNoiseFilterPending}
      aria-pressed={supported && enabled}
      title={
        supported
          ? "AI-подавление шума Krisp: убирает клавиатуру, вентилятор и уличный шум, оставляя голос"
          : "AI-шумодав недоступен в этом браузере — работает встроенное подавление шума"
      }
    >
      <AudioLines size={14} aria-hidden="true" />
      {label}
    </button>
  );
}
