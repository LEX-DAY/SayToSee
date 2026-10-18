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
  supportsAudioOutputSelection,
  VideoPresets,
} from "livekit-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AudioQualityIndicator from "./AudioQualityIndicator";
import type { MeetingSession } from "./CallApp";
import type { DevicePreferences } from "./device-preferences";
import DeviceSettingsDialog, { type MediaDeviceLists } from "./DeviceSettingsDialog";
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
  onDevicesChange,
}: {
  session: MeetingSession;
  onLeave: (message?: string) => void;
  onNoiseFilterChange: (enabled: boolean) => void;
  onDevicesChange: (devices: DevicePreferences) => void;
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
          onDevicesChange={onDevicesChange}
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
  onDevicesChange,
}: {
  session: MeetingSession;
  onLeave: (message?: string) => void;
  noiseFilterSupported: boolean;
  noiseFilterEnabled: boolean;
  onNoiseFilterToggle: () => void;
  connectionError: string;
  onReconnect: () => void;
  onDevicesChange: (devices: DevicePreferences) => void;
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
    return () => {
      room.off(RoomEvent.Disconnected, handleDisconnect);
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
          <InCallDeviceSettings devices={session.devices} onDevicesChange={onDevicesChange} />
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

function InCallDeviceSettings({
  devices,
  onDevicesChange,
}: {
  devices: DevicePreferences;
  onDevicesChange: (devices: DevicePreferences) => void;
}) {
  const room = useRoomContext();
  const [lists, setLists] = useState<MediaDeviceLists>({ mics: [], cams: [], speakers: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const switchingKind = useRef<MediaDeviceKind | null>(null);
  const devicesChangedDuringSwitch = useRef(false);
  const mounted = useRef(false);
  const permissionTried = useRef(new Set<MediaDeviceKind>());

  const refresh = useCallback(async () => {
    try {
      const available = await navigator.mediaDevices.enumerateDevices();
      if (!mounted.current) return;
      setLists({
        mics: available.filter((device) => device.kind === "audioinput"),
        cams: available.filter((device) => device.kind === "videoinput"),
        speakers: available.filter((device) => device.kind === "audiooutput"),
      });
    } catch {
      if (mounted.current) setError("Не удалось получить список устройств. Проверьте разрешения браузера.");
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const handle = window.setTimeout(() => void refresh(), 0);
    const onDevicesChanged = () => {
      // Перечитаем список после завершения переключения или восстановления,
      // чтобы hotplug не зафиксировал промежуточное состояние.
      if (switchingKind.current) devicesChangedDuringSwitch.current = true;
      else void refresh();
    };
    const handleDeviceChange = (kind: MediaDeviceKind, deviceId: string) => {
      if (!mounted.current || switchingKind.current === kind) return;
      const preferences = { audioinput: "mic", videoinput: "cam", audiooutput: "speaker" } as const;
      onDevicesChange({
        [preferences[kind]]: deviceId && deviceId !== "default" ? deviceId : undefined,
      });
    };
    const onDisconnected = () => { mounted.current = false; };
    room.on(RoomEvent.MediaDevicesChanged, onDevicesChanged);
    room.on(RoomEvent.ActiveDeviceChanged, handleDeviceChange);
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      mounted.current = false;
      window.clearTimeout(handle);
      room.off(RoomEvent.MediaDevicesChanged, onDevicesChanged);
      room.off(RoomEvent.ActiveDeviceChanged, handleDeviceChange);
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [onDevicesChange, refresh, room]);

  async function ensureLabels(kind: MediaDeviceKind) {
    const permissionKind = kind === "audiooutput" ? "audioinput" : kind;
    if (permissionTried.current.has(permissionKind)) return;
    permissionTried.current.add(permissionKind);
    try {
      const available = await navigator.mediaDevices.enumerateDevices();
      if (!mounted.current) return;
      if (available.some((device) => device.kind === kind && !device.label)) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: permissionKind === "audioinput",
          video: permissionKind === "videoinput",
        });
        stream.getTracks().forEach((track) => track.stop());
      }
      await refresh();
    } catch {
      if (mounted.current) setError("Разрешите доступ к устройству в браузере, чтобы увидеть его название.");
    }
  }

  async function changeDevice(patch: Partial<DevicePreferences>) {
    if (switchingKind.current || !mounted.current) return;
    const preference = Object.keys(patch)[0] as keyof DevicePreferences;
    const kinds = { mic: "audioinput", cam: "videoinput", speaker: "audiooutput" } as const;
    const kind = kinds[preference];
    const defaultId = kind === "audioinput" ? "default" : "";
    const previousChoice = devices[preference];
    const previousDeviceId = room.getActiveDevice(kind) ?? previousChoice ?? defaultId;
    switchingKind.current = kind;
    devicesChangedDuringSwitch.current = false;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const deviceId = patch[preference] ?? defaultId;
      const changed = await room.switchActiveDevice(kind, deviceId, Boolean(patch[preference]));
      if (!changed) throw new Error("Устройство не удалось переключить.");
      if (!mounted.current) return;
      onDevicesChange(patch);
      setMessage("Устройство переключено. Выбор сохранён для следующей встречи.");
    } catch {
      if (!mounted.current) return;
      // LiveKit восстанавливает options, но уже переключённые remote tracks
      // могут остаться на новом sink. Возвращаем устройство через тот же API.
      let restored = false;
      try {
        restored = await room.switchActiveDevice(kind, previousDeviceId, Boolean(previousDeviceId && previousDeviceId !== "default"));
      } catch {
        // Например, прежнюю гарнитуру отключили во время переключения.
      }
      if (!mounted.current) return;
      onDevicesChange({ [preference]: previousChoice });
      setError(restored
        ? "Не удалось переключить устройство. Прежнее устройство восстановлено. Проверьте подключение и разрешения."
        : "Не удалось переключить или восстановить устройство. Проверьте подключение и выберите доступное устройство.");
    } finally {
      if (mounted.current) {
        await refresh();
        if (mounted.current && devicesChangedDuringSwitch.current) {
          const activeId = room.getActiveDevice(kind);
          onDevicesChange({ [preference]: activeId && activeId !== "default" ? activeId : undefined });
        }
      }
      switchingKind.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <DeviceSettingsDialog
      triggerClassName="meeting-device-button"
      devices={devices}
      lists={lists}
      onChange={(patch) => void changeDevice(patch)}
      onFocus={(kind) => void ensureLabels(kind)}
      onOpen={() => void refresh()}
      busy={busy}
      outputSupported={supportsAudioOutputSelection()}
      error={error}
      message={busy ? "Переключаем устройство…" : message}
    />
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
