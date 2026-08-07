"use client";

import {
  ArrowRight,
  KeyRound,
  Mic,
  Video,
} from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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
};

type ApiError = { error?: string };

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
  const [session, setSession] = useState<MeetingSession | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const key = new URLSearchParams(window.location.search).get("key");
      if (key) setJoinKey(formatKeyInput(key));
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);

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
      });
    },
    [audioEnabled, name, videoEnabled],
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
        onLeave={() => {
          setSession(null);
          setError("");
        }}
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
        <div className="nav-status">
          <span className="status-dot" />
          Сервер доступен
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
