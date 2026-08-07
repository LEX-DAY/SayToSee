import "./style.css";
import logoMark from "./assets/saytosee-mark.png";

import type {
  Participant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
} from "livekit-client";
import {
  Copy,
  createIcons,
  Leaf,
  Mic,
  MonitorUp,
  Phone,
  Users,
  Video,
} from "lucide";
import { CheckServer, CreateRoom, JoinRoom } from "../wailsjs/go/main/App";

type Session = {
  room: string;
  key: string;
  inviteUrl: string;
  token: string;
  serverUrl: string;
  isHost: boolean;
  displayName: string;
};

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main class="app-shell">
    <section id="lobby" class="lobby view active">
      <header class="app-header">
        <div class="brand"><img class="brand-mark" src="${logoMark}" alt=""><span>SayToSee</span></div>
        <div class="header-right">
          <div id="server-status" class="server-status"><span></span><em>Проверяем сервер</em></div>
        </div>
      </header>
      <div class="lobby-content">
        <div class="lobby-copy">
          <h1>Созвон без<br><strong>лишней нагрузки.</strong></h1>
        </div>
        <form id="join-form" class="join-card">
          <div class="card-top">
            <div><h2>Начать встречу</h2><p>Представьтесь и введите ключ комнаты</p></div>
          </div>
          <label for="display-name">Ваше имя</label>
          <div class="input-with-avatar">
            <span id="avatar-preview" class="avatar">ВЫ</span>
            <input id="display-name" maxlength="40" autocomplete="name" placeholder="Например, Алексей">
          </div>
          <div class="key-heading">
            <label for="meeting-key">Ключ встречи</label>
            <small>оставьте пустым, чтобы создать</small>
          </div>
          <input id="meeting-key" class="key-input" maxlength="19" autocomplete="off" spellcheck="false" placeholder="XXXX — XXXX — XXXX — XXXX">
          <div class="prejoin">
            <span>При входе</span>
            <button type="button" id="prejoin-audio" class="prejoin-toggle active" aria-pressed="true"><i data-lucide="mic"></i><span>Микрофон</span><i></i></button>
            <button type="button" id="prejoin-video" class="prejoin-toggle" aria-pressed="false"><i data-lucide="video"></i><span>Камера</span><i></i></button>
          </div>
          <div id="lobby-error" class="form-error" role="alert"></div>
          <button id="join-button" class="primary-button" type="submit"><span>Войти по ключу</span><b>→</b></button>
          <button id="create-button" class="secondary-button" type="button"><i data-lucide="video"></i><span>Создать новую комнату</span></button>
        </form>
      </div>
    </section>

    <section id="meeting" class="meeting view">
      <header class="meeting-header">
        <div class="brand compact"><img class="brand-mark" src="${logoMark}" alt=""><span>SayToSee</span></div>
        <div class="meeting-title">
          <span id="meeting-live" class="live-dot"></span>
          <div><b id="meeting-code">Встреча</b><small id="meeting-role">Подключение…</small></div>
        </div>
        <div class="meeting-actions">
          <span class="participants-pill"><i data-lucide="users"></i><b id="participant-count">1</b><small>/10</small></span>
          <button id="copy-invite" class="copy-button"><i data-lucide="copy"></i><span>Скопировать приглашение</span></button>
        </div>
      </header>
      <div id="tile-grid" class="tile-grid"></div>
      <footer class="control-dock">
        <div class="connection-state"><span></span><b id="connection-label">Защищённое соединение</b></div>
        <div class="controls">
          <button id="audio-control" class="call-control active" aria-label="Микрофон"><i data-lucide="mic"></i><span>Микрофон</span></button>
          <button id="video-control" class="call-control" aria-label="Камера"><i data-lucide="video"></i><span>Камера</span></button>
          <button id="screen-control" class="call-control" aria-label="Показ экрана"><i data-lucide="monitor-up"></i><span>Экран</span></button>
          <button id="leave-control" class="call-control hangup" aria-label="Завершить звонок"><i data-lucide="phone"></i><span>Выйти</span></button>
        </div>
        <div class="quality-note"><i data-lucide="leaf"></i><span>Экономный режим</span></div>
      </footer>
    </section>

    <div id="toast" class="toast" role="status"></div>
  </main>
`;

createIcons({
  icons: { Copy, Leaf, Mic, MonitorUp, Phone, Users, Video },
});

const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const lobby = $("#lobby");
const meeting = $("#meeting");
const nameInput = $<HTMLInputElement>("#display-name");
const keyInput = $<HTMLInputElement>("#meeting-key");
const avatarPreview = $("#avatar-preview");
const lobbyError = $("#lobby-error");
const joinButton = $<HTMLButtonElement>("#join-button");
const createButton = $<HTMLButtonElement>("#create-button");
const audioPrejoin = $<HTMLButtonElement>("#prejoin-audio");
const videoPrejoin = $<HTMLButtonElement>("#prejoin-video");
const serverStatus = $("#server-status");
const tileGrid = $("#tile-grid");
const toast = $("#toast");

let room: Room | null = null;
let livekit: typeof import("livekit-client") | null = null;
let session: Session | null = null;
let audioEnabled = true;
let videoEnabled = false;
let screenEnabled = false;
let activeSpeakers = new Set<string>();
let toastTimer = 0;

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "ВЫ";
const normalizeKey = (value: string) =>
  value.toUpperCase().replaceAll("O", "0").replace(/[IL]/g, "1")
    .replace(/[^0-9A-HJKMNP-TV-Z]/g, "").slice(0, 16);
const formatKey = (value: string) =>
  normalizeKey(value).match(/.{1,4}/g)?.join("-") ?? "";

function setPending(pending: boolean, action: "join" | "create" = "join") {
  joinButton.disabled = pending;
  createButton.disabled = pending;
  joinButton.querySelector("span")!.textContent =
    pending && action === "join" ? "Подключаемся…" : "Войти по ключу";
  createButton.querySelector("span")!.textContent =
    pending && action === "create" ? "Создаём комнату…" : "Создать новую комнату";
}

function errorMessage(reason: unknown) {
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return reason.message;
  return (reason as { message?: string })?.message || "Что-то пошло не так. Попробуйте ещё раз.";
}

function showToast(message: string) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2200);
}

function togglePrejoin(button: HTMLButtonElement, value: boolean) {
  button.classList.toggle("active", value);
  button.setAttribute("aria-pressed", String(value));
}

async function enterMeeting(nextSession: Session) {
  try {
    livekit ??= await import("livekit-client");
  } catch {
    lobbyError.textContent = "Не удалось загрузить модуль видеосвязи.";
    return;
  }

  session = nextSession;
  lobby.classList.remove("active");
  meeting.classList.add("active");
  $("#meeting-code").textContent = `Встреча ${nextSession.key}`;
  $("#meeting-role").textContent = nextSession.isHost ? "Вы организатор" : "Вы участник";
  $("#connection-label").textContent = "Устанавливаем соединение…";
  document.title = `${nextSession.key} · SayToSee`;

  room = new livekit.Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: { resolution: { width: 640, height: 360, frameRate: 15 } },
    publishDefaults: { simulcast: false, videoCodec: "vp8", dtx: true, red: false },
  });
  bindRoomEvents(room);
  try {
    await room.connect(nextSession.serverUrl, nextSession.token, { autoSubscribe: true });
    await room.localParticipant.setMicrophoneEnabled(audioEnabled);
    if (videoEnabled) await room.localParticipant.setCameraEnabled(true);
    $("#connection-label").textContent = "Защищённое соединение";
    renderParticipants();
    updateControls();
  } catch (reason) {
    await leaveMeeting(true);
    lobbyError.textContent = `Не удалось войти: ${errorMessage(reason)}`;
  }
}

function bindRoomEvents(currentRoom: Room) {
  const { ConnectionState, RoomEvent, Track } = livekit!;
  currentRoom
    .on(RoomEvent.ParticipantConnected, renderParticipants)
    .on(RoomEvent.ParticipantDisconnected, renderParticipants)
    .on(RoomEvent.LocalTrackPublished, renderParticipants)
    .on(RoomEvent.LocalTrackUnpublished, renderParticipants)
    .on(RoomEvent.TrackMuted, renderParticipants)
    .on(RoomEvent.TrackUnmuted, renderParticipants)
    .on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        const element = track.attach();
        element.dataset.saytoseeAudio = "true";
        document.body.appendChild(element);
      }
      renderParticipants();
    })
    .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _publication: RemoteTrackPublication) => {
      track.detach().forEach((element) => element.remove());
      renderParticipants();
    })
    .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      activeSpeakers = new Set(speakers.map((speaker) => speaker.sid));
      tileGrid.querySelectorAll<HTMLElement>(".participant-tile").forEach((tile) =>
        tile.classList.toggle("speaking", activeSpeakers.has(tile.dataset.sid || "")),
      );
    })
    .on(RoomEvent.ConnectionStateChanged, (state) => {
      const connecting = state === ConnectionState.Connecting || state === ConnectionState.Reconnecting;
      $("#connection-label").textContent = connecting
        ? "Восстанавливаем соединение…"
        : state === ConnectionState.Connected ? "Защищённое соединение" : "Нет соединения";
      $("#meeting-live").classList.toggle("offline", state !== ConnectionState.Connected);
    })
    .on(RoomEvent.Disconnected, () => void leaveMeeting(false));
}

function videoPublication(participant: Participant) {
  const { Track } = livekit!;
  const publications = Array.from(participant.trackPublications.values());
  return publications.find((publication) =>
    publication.source === Track.Source.ScreenShare && publication.track && !publication.isMuted,
  ) || publications.find((publication) =>
    publication.source === Track.Source.Camera && publication.track && !publication.isMuted,
  );
}

function renderParticipants() {
  if (!room) return;
  const participants: Participant[] = [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
  const validSids = new Set(participants.map((participant) => participant.sid));

  tileGrid.querySelectorAll<HTMLElement>(".participant-tile").forEach((tile) => {
    if (!validSids.has(tile.dataset.sid || "")) {
      const video = tile.querySelector<HTMLVideoElement>("video");
      if (video) video.srcObject = null;
      tile.remove();
    }
  });

  for (const participant of participants) {
    let tile = tileGrid.querySelector<HTMLElement>(`[data-sid="${participant.sid}"]`);
    if (!tile) {
      tile = document.createElement("article");
      tile.className = "participant-tile";
      tile.dataset.sid = participant.sid;
      tile.innerHTML = `
        <div class="video-slot"></div>
        <div class="avatar-large">${initials(participant.name || participant.identity)}</div>
        <div class="tile-shade"></div>
        <div class="participant-label"><span></span><i></i></div>`;
      tileGrid.appendChild(tile);
    }
    tile.classList.toggle("speaking", activeSpeakers.has(participant.sid));
    tile.classList.toggle("local", participant === room.localParticipant);
    tile.querySelector(".participant-label span")!.textContent =
      participant === room.localParticipant
        ? `${participant.name || session?.displayName || "Вы"} · вы`
        : participant.name || "Участник";

    const publication = videoPublication(participant);
    const slot = tile.querySelector<HTMLElement>(".video-slot")!;
    const currentVideo = slot.querySelector<HTMLVideoElement>("video");
    if (!publication?.track) {
      if (currentVideo) {
        const previous = Array.from(participant.trackPublications.values())
          .find((item) => item.trackSid === currentVideo.dataset.trackSid);
        previous?.track?.detach(currentVideo);
        currentVideo.srcObject = null;
        currentVideo.remove();
      }
      tile.classList.remove("has-video");
      continue;
    }
    tile.classList.add("has-video");
    if (currentVideo?.dataset.trackSid === publication.trackSid) continue;
    if (currentVideo) {
      const previous = Array.from(participant.trackPublications.values())
        .find((item) => item.trackSid === currentVideo.dataset.trackSid);
      previous?.track?.detach(currentVideo);
      currentVideo.srcObject = null;
      currentVideo.remove();
    }
    const video = document.createElement("video");
    video.className = "participant-video";
    video.dataset.trackSid = publication.trackSid;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = participant === room.localParticipant;
    publication.track.attach(video);
    slot.appendChild(video);
  }

  $("#participant-count").textContent = String(participants.length);
  tileGrid.dataset.count = String(participants.length);
}

function updateControls() {
  const states: Array<[string, boolean]> = [
    ["#audio-control", audioEnabled],
    ["#video-control", videoEnabled],
    ["#screen-control", screenEnabled],
  ];
  for (const [selector, enabled] of states) {
    $(selector).classList.toggle("active", enabled);
    $(selector).classList.toggle("disabled", !enabled);
  }
}

async function toggleMicrophone() {
  if (!room) return;
  try {
    audioEnabled = !audioEnabled;
    await room.localParticipant.setMicrophoneEnabled(audioEnabled);
    updateControls();
  } catch (reason) {
    audioEnabled = !audioEnabled;
    showToast(errorMessage(reason));
  }
}

async function toggleCamera() {
  if (!room) return;
  try {
    videoEnabled = !videoEnabled;
    await room.localParticipant.setCameraEnabled(videoEnabled);
    updateControls();
    renderParticipants();
  } catch (reason) {
    videoEnabled = !videoEnabled;
    showToast("Не удалось включить камеру: " + errorMessage(reason));
  }
}

async function toggleScreen() {
  if (!room) return;
  try {
    screenEnabled = !screenEnabled;
    await room.localParticipant.setScreenShareEnabled(screenEnabled, { audio: false });
    updateControls();
    renderParticipants();
  } catch (reason) {
    screenEnabled = !screenEnabled;
    updateControls();
    showToast("Не удалось показать экран: " + errorMessage(reason));
  }
}

async function leaveMeeting(disconnect = true) {
  const currentRoom = room;
  room = null;
  if (disconnect && currentRoom) await currentRoom.disconnect();
  document.querySelectorAll("[data-saytosee-audio]").forEach((element) => element.remove());
  tileGrid.replaceChildren();
  meeting.classList.remove("active");
  lobby.classList.add("active");
  session = null;
  screenEnabled = false;
  document.title = "SayToSee";
  setPending(false);
}

async function submitJoin() {
  lobbyError.textContent = "";
  const key = normalizeKey(keyInput.value);
  if (!nameInput.value.trim()) {
    lobbyError.textContent = "Введите имя, которое увидят участники.";
    nameInput.focus();
    return;
  }
  if (key.length !== 16) {
    lobbyError.textContent = "Введите ключ встречи из 16 символов.";
    keyInput.focus();
    return;
  }
  setPending(true, "join");
  try {
    await enterMeeting(await JoinRoom({ key: formatKey(key), name: nameInput.value.trim() }));
  } catch (reason) {
    lobbyError.textContent = errorMessage(reason);
  } finally {
    setPending(false);
  }
}

async function submitCreate() {
  lobbyError.textContent = "";
  if (!nameInput.value.trim()) {
    lobbyError.textContent = "Введите имя, которое увидят участники.";
    nameInput.focus();
    return;
  }
  setPending(true, "create");
  try {
    const created = await CreateRoom(nameInput.value.trim());
    keyInput.value = created.key;
    await enterMeeting(created);
  } catch (reason) {
    lobbyError.textContent = errorMessage(reason);
  } finally {
    setPending(false);
  }
}

async function checkServer() {
  serverStatus.classList.remove("online", "offline");
  serverStatus.querySelector("em")!.textContent = "Проверяем сервер";
  try {
    await CheckServer();
    serverStatus.classList.add("online");
    serverStatus.querySelector("em")!.textContent = "Сервер доступен";
  } catch {
    serverStatus.classList.add("offline");
    serverStatus.querySelector("em")!.textContent = "Сервер недоступен";
  }
}

nameInput.addEventListener("input", () => {
  avatarPreview.textContent = initials(nameInput.value);
  lobbyError.textContent = "";
});
keyInput.addEventListener("input", () => {
  keyInput.value = formatKey(keyInput.value);
  lobbyError.textContent = "";
});
audioPrejoin.addEventListener("click", () => {
  audioEnabled = !audioEnabled;
  togglePrejoin(audioPrejoin, audioEnabled);
});
videoPrejoin.addEventListener("click", () => {
  videoEnabled = !videoEnabled;
  togglePrejoin(videoPrejoin, videoEnabled);
});
$("#join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void submitJoin();
});
createButton.addEventListener("click", () => void submitCreate());
$("#audio-control").addEventListener("click", () => void toggleMicrophone());
$("#video-control").addEventListener("click", () => void toggleCamera());
$("#screen-control").addEventListener("click", () => void toggleScreen());
$("#leave-control").addEventListener("click", () => void leaveMeeting());
$("#copy-invite").addEventListener("click", async () => {
  if (!session) return;
  try {
    await navigator.clipboard.writeText(`${session.inviteUrl}\nКлюч встречи: ${session.key}`);
    showToast("Приглашение скопировано");
  } catch {
    showToast(`Ключ встречи: ${session.key}`);
  }
});
window.addEventListener("beforeunload", () => {
  if (room) void room.disconnect();
});

void checkServer();
