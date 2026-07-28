"use client";

import {
  ArrowRight,
  ChevronRight,
  Gauge,
  Link2,
  LockKeyhole,
  Mic,
  ShieldCheck,
  Sparkles,
  Video,
  Wifi,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

export type MeetingSession = {
  room: string;
  invite: string;
  inviteUrl: string;
  token: string;
  serverUrl: string;
  name: string;
  isHost: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
};

type ApiError = { error?: string };

const ROOM_STORAGE_PREFIX = "calltocall:host:";
const MeetingRoom = dynamic(() => import("./MeetingRoom"), {
  ssr: false,
  loading: () => (
    <div className="meeting-loading">
      <span className="brand-mark mini">
        <span />
        <span />
      </span>
      <p>Подготавливаем защищённую комнату…</p>
    </div>
  ),
});

function roomLabel(room: string) {
  return room.replace(/^ctc-/, "").toUpperCase();
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function readInviteFromUrl() {
  if (typeof window === "undefined") return { room: "", invite: "" };
  const params = new URLSearchParams(window.location.search);
  return {
    room: params.get("room") ?? "",
    invite: params.get("invite") ?? "",
  };
}

export default function CallApp() {
  const [invitation, setInvitation] = useState({ room: "", invite: "" });
  const [name, setName] = useState("");
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [session, setSession] = useState<MeetingSession | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setInvitation(readInviteFromUrl());
  }, []);

  const requestToken = useCallback(
    async ({
      room,
      invite,
      hostCredential,
      inviteUrl,
    }: {
      room: string;
      invite: string;
      hostCredential?: string;
      inviteUrl: string;
    }) => {
      const response = await fetch("/api/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          room,
          invite,
          name: name.trim(),
          hostCredential,
        }),
      });
      const data = (await response.json()) as ApiError & {
        token?: string;
        serverUrl?: string;
        isHost?: boolean;
      };
      if (!response.ok || !data.token || !data.serverUrl) {
        throw new Error(data.error || "Не удалось подключиться к встрече");
      }
      setSession({
        room,
        invite,
        inviteUrl,
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
        invite?: string;
        inviteUrl?: string;
        hostCredential?: string;
      };
      if (
        !response.ok ||
        !data.room ||
        !data.invite ||
        !data.inviteUrl ||
        !data.hostCredential
      ) {
        throw new Error(data.error || "Не удалось создать встречу");
      }
      sessionStorage.setItem(
        `${ROOM_STORAGE_PREFIX}${data.room}`,
        data.hostCredential,
      );
      window.history.replaceState(
        {},
        "",
        `/?room=${encodeURIComponent(data.room)}&invite=${encodeURIComponent(data.invite)}`,
      );
      setInvitation({ room: data.room, invite: data.invite });
      await requestToken({
        room: data.room,
        invite: data.invite,
        inviteUrl: data.inviteUrl,
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
    if (!invitation.room || !invitation.invite) {
      setError("Откройте действующую ссылку-приглашение");
      return;
    }
    setPending(true);
    setError("");
    try {
      const hostCredential =
        sessionStorage.getItem(
          `${ROOM_STORAGE_PREFIX}${invitation.room}`,
        ) ?? undefined;
      await requestToken({
        room: invitation.room,
        invite: invitation.invite,
        inviteUrl: window.location.href,
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
        <a className="brand" href="/" aria-label="CalltoCall — главная">
          <span className="brand-mark">
            <span />
            <span />
          </span>
          <span>CalltoCall</span>
        </a>
        <div className="nav-status">
          <span className="status-dot" />
          Защищённая связь
        </div>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <Sparkles size={15} />
            Встреча начинается за 10 секунд
          </div>
          <h1>
            Созванивайтесь
            <br />
            <span>напрямую.</span>
          </h1>
          <p className="hero-lead">
            До 10 человек в одной комнате. Без установки, регистрации и
            нагрузки на компьютер организатора.
          </p>

          <div className="benefit-row">
            <div className="benefit">
              <span className="benefit-icon">
                <Gauge size={19} />
              </span>
              <span>
                <strong>Лёгкий хост</strong>
                <small>Передачу видео берёт на себя SFU</small>
              </span>
            </div>
            <div className="benefit">
              <span className="benefit-icon">
                <ShieldCheck size={19} />
              </span>
              <span>
                <strong>Приватная комната</strong>
                <small>Вход только по подписанной ссылке</small>
              </span>
            </div>
          </div>
        </div>

        <div className="join-card-wrap">
          <div className="join-card">
            <div className="card-heading">
              <span className="card-icon">
                {invitation.room ? <Link2 size={22} /> : <Video size={22} />}
              </span>
              <div>
                <p>{invitation.room ? "Вас пригласили" : "Новая встреча"}</p>
                <span>
                  {invitation.room
                    ? `Комната ${roomLabel(invitation.room)}`
                    : "Вы будете организатором"}
                </span>
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
                    void (invitation.room ? joinMeeting() : createMeeting());
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
              onClick={() =>
                void (invitation.room ? joinMeeting() : createMeeting())
              }
              disabled={pending}
            >
              <span>
                {pending
                  ? "Подключаем…"
                  : invitation.room
                    ? "Войти во встречу"
                    : "Создать встречу"}
              </span>
              <ArrowRight size={20} />
            </button>

            <div className="card-footnote">
              <LockKeyhole size={14} />
              Доступ к камере и микрофону запрашивается только при входе
            </div>
          </div>

          <div className="capacity-note">
            <div className="capacity-avatars" aria-hidden="true">
              <span>AK</span>
              <span>М</span>
              <span>+</span>
            </div>
            <p>
              <strong>До 10 участников</strong>
              <small>Адаптивное качество видео</small>
            </p>
            <ChevronRight size={18} />
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <span>© 2026 CalltoCall</span>
        <span className="footer-architecture">
          <Wifi size={14} />
          Оптимизировано для слабых устройств
        </span>
      </footer>
    </main>
  );
}
