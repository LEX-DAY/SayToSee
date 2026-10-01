"use client";

import {
  ArrowRight,
  AudioLines,
  KeyRound,
  Mic,
  MonitorSpeaker,
  Video,
} from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadDevicePreferences,
  saveDevicePreferences,
  type DevicePreferences,
} from "./device-preferences";
import { krispSupport, NOISE_FILTER_STORAGE_KEY } from "./noise-filter";

export type MeetingSession = {
  room: string;
  joinKey: string;
  inviteUrl: string;
  token: string;
  serverUrl: string;
  name: string;
  isHost: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  noiseFilterEnabled: boolean;
  devices: DevicePreferences;
};

type MediaDeviceLists = {
  mics: MediaDeviceInfo[];
  cams: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
};

const EMPTY_DEVICE_LISTS: MediaDeviceLists = {
  mics: [],
  cams: [],
  speakers: [],
};

type ApiError = { error?: string };

type ServerStatus = "checking" | "up" | "down";

const SERVER_STATUS_POLL_MS = 20_000;

const ROOM_STORAGE_PREFIX = "saytosee:host:";
const MeetingRoom = dynamic(() => import("./MeetingRoom"), {
  ssr: false,
  loading: () => (
    <div className="meeting-loading">
      <Image className="brand-mark mini" src="/saytosee-mark.png" alt="" width={30} height={25} />
      <p>Подготавливаем защищённую комнату…</p>
    </div>
  ),
});

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function normalizeKeyInput(value: string) {
  return value
    .toUpperCase()
    .replaceAll("O", "0")
    .replace(/[IL]/g, "1")
    .replace(/[^0-9A-HJKMNP-TV-Z]/g, "")
    .slice(0, 16);
}

function formatKeyInput(value: string) {
  return normalizeKeyInput(value).match(/.{1,4}/g)?.join("-") ?? "";
}

export default function CallApp() {
  const [name, setName] = useState("");
  const [joinKey, setJoinKey] = useState("");
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [noiseFilterEnabled, setNoiseFilterEnabled] = useState(true);
  const [session, setSession] = useState<MeetingSession | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [serverStatus, setServerStatus] = useState<ServerStatus>("checking");
  // Персист включаем только после загрузки сохранённых настроек, иначе
  // первый рендер запишет дефолт поверх хранимого значения.
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [deviceLists, setDeviceLists] =
    useState<MediaDeviceLists>(EMPTY_DEVICE_LISTS);
  const [devices, setDevices] = useState<DevicePreferences>({});
  const labelPermissionTried = useRef(false);

  const refreshDeviceLists = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDeviceLists({
        mics: list.filter((device) => device.kind === "audioinput"),
        cams: list.filter((device) => device.kind === "videoinput"),
        speakers: list.filter((device) => device.kind === "audiooutput"),
      });
    } catch {
      // Нет доступа к enumerateDevices — селекты останутся пустыми
    }
  }, []);

  // До выдачи разрешения браузер скрывает названия устройств; запрашиваем
  // доступ один раз, когда пользователь трогает селекты, и перечитываем список.
  const ensureDeviceLabels = useCallback(async () => {
    if (labelPermissionTried.current) return;
    labelPermissionTried.current = true;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      if (list.some((device) => !device.label)) {
        const stream = await navigator.mediaDevices
          .getUserMedia({ audio: true, video: true })
          .catch(() => null);
        stream?.getTracks().forEach((track) => track.stop());
      }
    } catch {
      // Разрешение не выдано — останутся безымянные устройства
    }
    await refreshDeviceLists();
  }, [refreshDeviceLists]);

  useEffect(() => {
    let active = true;
    async function checkServer() {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        if (active) setServerStatus(response.ok ? "up" : "down");
      } catch {
        if (active) setServerStatus("down");
      }
    }
    void checkServer();
    const interval = window.setInterval(checkServer, SERVER_STATUS_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      // Предзагружаем тяжёлый модуль AI-шумодова и читаем сохранённую настройку
      void krispSupport();
      try {
        const stored =
          window.localStorage.getItem(NOISE_FILTER_STORAGE_KEY) ?? "";
        if (stored) setNoiseFilterEnabled(JSON.parse(stored) === true);
      } catch {
        // Нет доступа к localStorage — остаётся значение по умолчанию
      }
      setDevices(loadDevicePreferences());
      setSettingsLoaded(true);
      const key = new URLSearchParams(window.location.search).get("key");
      if (key) setJoinKey(formatKeyInput(key));
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);

  // Список устройств: перечитываем сразу и при подключении/отключении девайсов
  useEffect(() => {
    const handle = window.setTimeout(() => void refreshDeviceLists(), 0);
    const handler = () => void refreshDeviceLists();
    navigator.mediaDevices?.addEventListener?.("devicechange", handler);
    return () => {
      window.clearTimeout(handle);
      navigator.mediaDevices?.removeEventListener?.("devicechange", handler);
    };
  }, [refreshDeviceLists]);

  function updateDeviceChoice(patch: Partial<DevicePreferences>) {
    setDevices((previous) => {
      const next = { ...previous, ...patch };
      saveDevicePreferences(next);
      return next;
    });
  }

  // Настройка шумодава меняется и до входа, и в комнате (MeetingRoom
  // вызывает onNoiseFilterChange) — персистим её здесь, в общем состоянии.
  useEffect(() => {
    if (!settingsLoaded) return;
    try {
      window.localStorage.setItem(
        NOISE_FILTER_STORAGE_KEY,
        JSON.stringify(noiseFilterEnabled),
      );
    } catch {
      // Нет доступа к localStorage (приватный режим) — не критично
    }
  }, [noiseFilterEnabled, settingsLoaded]);

  const requestToken = useCallback(
    async ({
      key,
      hostCredential,
    }: {
      key: string;
      hostCredential?: string;
    }) => {
      const response = await fetch("/api/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key,
          name: name.trim(),
          hostCredential,
        }),
      });
      const data = (await response.json()) as ApiError & {
        token?: string;
        serverUrl?: string;
        isHost?: boolean;
        room?: string;
        key?: string;
      };
      if (
        !response.ok ||
        !data.token ||
        !data.serverUrl ||
        !data.room ||
        !data.key
      ) {
        throw new Error(data.error || "Не удалось подключиться к встрече");
      }
      const inviteUrl = new URL("/", window.location.origin);
      inviteUrl.searchParams.set("key", data.key);
      window.history.replaceState({}, "", inviteUrl);
      setSession({
        room: data.room,
        joinKey: data.key,
        inviteUrl: inviteUrl.toString(),
        token: data.token,
        serverUrl: data.serverUrl,
        name: name.trim(),
        isHost: Boolean(data.isHost),
        audioEnabled,
        videoEnabled,
        noiseFilterEnabled,
        devices,
      });
    },
    [audioEnabled, devices, name, noiseFilterEnabled, videoEnabled],
  );

  async function createMeeting() {
    if (!name.trim()) {
      setError("Введите имя, которое увидят участники");
      return;
    }
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = (await response.json()) as ApiError & {
        room?: string;
        key?: string;
        hostCredential?: string;
      };
      if (
        !response.ok ||
        !data.room ||
        !data.key ||
        !data.hostCredential
      ) {
        throw new Error(data.error || "Не удалось создать встречу");
      }
      sessionStorage.setItem(
        `${ROOM_STORAGE_PREFIX}${data.room}`,
        data.hostCredential,
      );
      setJoinKey(data.key);
      await requestToken({
        key: data.key,
        hostCredential: data.hostCredential,
      });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось создать встречу",
      );
    } finally {
      setPending(false);
    }
  }

  async function joinMeeting() {
    if (!name.trim()) {
      setError("Введите имя, которое увидят участники");
      return;
    }
    const normalizedKey = normalizeKeyInput(joinKey);
    if (normalizedKey.length !== 16) {
      setError("Введите ключ встречи из 16 символов");
      return;
    }
    setPending(true);
    setError("");
    try {
      const room = `ctc-${normalizedKey.toLowerCase()}`;
      const hostCredential =
        sessionStorage.getItem(`${ROOM_STORAGE_PREFIX}${room}`) ?? undefined;
      await requestToken({
        key: formatKeyInput(normalizedKey),
        hostCredential,
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось присоединиться к встрече",
      );
    } finally {
      setPending(false);
    }
  }

  if (session) {
    return (
      <MeetingRoom
        session={session}
        onLeave={(message) => {
          setSession(null);
          setError(message ?? "");
        }}
        onNoiseFilterChange={setNoiseFilterEnabled}
      />
    );
  }

  return (
    <main className="landing-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <nav className="site-nav" aria-label="Основная навигация">
        <Link className="brand" href="/" aria-label="SayToSee — главная">
          <Image className="brand-mark" src="/saytosee-mark.png" alt="" width={38} height={31} priority />
          <span>SayToSee</span>
        </Link>
        <div
          className={`nav-status nav-status-${serverStatus}`}
          role="status"
          title={
            serverStatus === "up"
              ? "Сервер встреч отвечает на запросы"
              : serverStatus === "down"
                ? "Сервер встреч не отвечает — попробуйте позже"
                : undefined
          }
        >
          <span className="status-dot" />
          {serverStatus === "up"
            ? "Сервер доступен"
            : serverStatus === "down"
              ? "Сервер недоступен"
              : "Проверяем сервер…"}
        </div>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <h1>
            Чистый звук.
            <br />
            <span>Стабильная связь.</span>
          </h1>
        </div>

        <div className="join-card-wrap">
          <div className="join-card">
            <div className="card-heading">
              <div>
                <p>Начать встречу</p>
                <span>Представьтесь и введите ключ комнаты</span>
              </div>
            </div>

            <label className="field-label" htmlFor="display-name">
              Ваше имя
            </label>
            <div className="name-field">
              <div className="avatar-preview" aria-hidden="true">
                {initials(name) || "ВЫ"}
              </div>
              <input
                id="display-name"
                autoComplete="name"
                maxLength={40}
                placeholder="Например, Алексей"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void (joinKey ? joinMeeting() : createMeeting());
                  }
                }}
              />
            </div>

            <label className="field-label key-label" htmlFor="meeting-key">
              Ключ встречи
            </label>
            <div className="key-field">
              <KeyRound size={19} aria-hidden="true" />
              <input
                id="meeting-key"
                autoComplete="off"
                maxLength={19}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                spellCheck={false}
                value={joinKey}
                onChange={(event) => {
                  setJoinKey(formatKeyInput(event.target.value));
                  setError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void joinMeeting();
                  }
                }}
              />
            </div>

            <p className="device-title">Перед входом</p>
            <div className="device-options">
              <button
                className={audioEnabled ? "device-toggle active" : "device-toggle"}
                onClick={() => setAudioEnabled((value) => !value)}
                aria-pressed={audioEnabled}
              >
                <span>
                  <Mic size={18} />
                  Микрофон
                </span>
                <i aria-hidden="true" />
              </button>
              <button
                className={videoEnabled ? "device-toggle active" : "device-toggle"}
                onClick={() => setVideoEnabled((value) => !value)}
                aria-pressed={videoEnabled}
              >
                <span>
                  <Video size={18} />
                  Камера
                </span>
                <i aria-hidden="true" />
              </button>
              <button
                className={
                  noiseFilterEnabled
                    ? "device-toggle active wide"
                    : "device-toggle wide"
                }
                onClick={() => setNoiseFilterEnabled((value) => !value)}
                aria-pressed={noiseFilterEnabled}
                title="AI-подавление шума Krisp: убирает клавиатуру, вентилятор и уличный шум, оставляя голос"
              >
                <span>
                  <AudioLines size={18} />
                  Шумодав (AI)
                </span>
                <i aria-hidden="true" />
              </button>
            </div>

            <p className="device-title">Устройства связи</p>
            <div className="device-selects" onFocus={() => void ensureDeviceLabels()}>
              <label className="device-select">
                <span>
                  <Mic size={15} aria-hidden="true" />
                  Микрофон
                </span>
                <select
                  value={devices.mic ?? ""}
                  onChange={(event) =>
                    updateDeviceChoice({ mic: event.target.value || undefined })
                  }
                >
                  <option value="">По умолчанию</option>
                  {deviceLists.mics.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Микрофон ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="device-select">
                <span>
                  <Video size={15} aria-hidden="true" />
                  Камера
                </span>
                <select
                  value={devices.cam ?? ""}
                  onChange={(event) =>
                    updateDeviceChoice({ cam: event.target.value || undefined })
                  }
                >
                  <option value="">По умолчанию</option>
                  {deviceLists.cams.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Камера ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="device-select wide">
                <span>
                  <MonitorSpeaker size={15} aria-hidden="true" />
                  Вывод звука
                </span>
                <select
                  value={devices.speaker ?? ""}
                  onChange={(event) =>
                    updateDeviceChoice({
                      speaker: event.target.value || undefined,
                    })
                  }
                >
                  <option value="">По умолчанию</option>
                  {deviceLists.speakers.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Устройство вывода ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {error && <div className="form-error">{error}</div>}

            <button
              className="primary-action"
              onClick={() => void joinMeeting()}
              disabled={pending}
            >
              <span>{pending ? "Подождите…" : "Войти по ключу"}</span>
              <ArrowRight size={20} />
            </button>

            <button
              className="secondary-action"
              onClick={() => void createMeeting()}
              disabled={pending}
            >
              <Video size={18} />
              Создать новую комнату
            </button>

          </div>
        </div>
      </section>
    </main>
  );
}
