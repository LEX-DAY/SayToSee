import "./style.css";
import logoMark from "./assets/saytosee-mark.png";
import { enhanceDeviceSelect } from "../../../shared/device-menu";

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
  MonitorSpeaker,
  MonitorUp,
  Phone,
  Settings,
  Users,
  Video,
  X,
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
          <div class="device-picker">
            <span>Устройства связи</span>
            <div class="device-grid">
              <div class="device-select"><i data-lucide="mic"></i>
                <span>Микрофон</span><select id="device-mic" aria-label="Микрофон"><option value="">По умолчанию</option></select>
              </div>
              <div class="device-select"><i data-lucide="video"></i>
                <span>Камера</span><select id="device-cam" aria-label="Камера"><option value="">По умолчанию</option></select>
              </div>
              <div class="device-select wide"><i data-lucide="monitor-speaker"></i>
                <span>Вывод звука</span><select id="device-speaker" aria-label="Динамики или наушники"><option value="">По умолчанию</option></select>
              </div>
            </div>
            <small id="lobby-device-note" class="device-note"></small>
          </div>
          <div id="lobby-error" class="form-error" role="alert"></div>
          <div id="lan-block" class="lan-block">
            <span>Локальная сеть · без интернета</span>
            <button type="button" id="lan-host-button" class="secondary-button"><i data-lucide="wifi"></i><span>Создать локальную встречу</span></button>
            <div id="lan-discovery" class="lan-discovery">
              <small>Встречи в этой сети</small>
              <div id="lan-list" class="lan-list"></div>
              <button type="button" id="lan-rescan" class="lan-rescan">Искать снова</button>
            </div>
          </div>
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
          <button id="devices-control" class="call-control" aria-label="Настройки устройств" aria-haspopup="dialog" aria-controls="devices-dialog"><i data-lucide="settings"></i><span>Устройства</span></button>
          <button id="leave-control" class="call-control hangup" aria-label="Завершить звонок"><i data-lucide="phone"></i><span>Выйти</span></button>
        </div>
        <div class="quality-note"><i data-lucide="leaf"></i><span>Экономный режим</span></div>
      </footer>
    </section>

    <dialog id="devices-dialog" class="device-dialog" aria-labelledby="devices-title" aria-describedby="devices-note">
      <div class="device-dialog-header">
        <div><h2 id="devices-title">Устройства связи</h2><p>Выбор применяется сразу во время звонка</p></div>
        <button type="button" id="devices-close" class="icon-button" aria-label="Закрыть настройки"><i data-lucide="x"></i></button>
      </div>
      <div class="device-dialog-fields">
        <div class="device-select"><span><i data-lucide="mic"></i>Микрофон</span><select id="call-device-mic" aria-label="Микрофон"><option value="">По умолчанию</option></select></div>
        <div class="device-select"><span><i data-lucide="video"></i>Камера</span><select id="call-device-cam" aria-label="Камера"><option value="">По умолчанию</option></select></div>
        <div class="device-select"><span><i data-lucide="monitor-speaker"></i>Вывод звука</span><select id="call-device-speaker" aria-label="Динамики или наушники"><option value="">По умолчанию</option></select></div>
      </div>
      <p id="devices-note" class="device-note">Выбранные устройства сохраняются для следующих встреч.</p>
      <div id="devices-error" class="form-error" role="alert"></div>
    </dialog>
    <div id="toast" class="toast" role="status"></div>
  </main>
`;

createIcons({
  icons: { Copy, Leaf, Mic, MonitorSpeaker, MonitorUp, Phone, Settings, Users, Video, X },
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
const micSelect = $<HTMLSelectElement>("#device-mic");
const camSelect = $<HTMLSelectElement>("#device-cam");
const speakerSelect = $<HTMLSelectElement>("#device-speaker");
const devicesDialog = $<HTMLDialogElement>("#devices-dialog");
const devicesControl = $<HTMLButtonElement>("#devices-control");
const devicesError = $("#devices-error");
const callMicSelect = $<HTMLSelectElement>("#call-device-mic");
const callCamSelect = $<HTMLSelectElement>("#call-device-cam");
const callSpeakerSelect = $<HTMLSelectElement>("#call-device-speaker");
const serverStatus = $("#server-status");
const tileGrid = $("#tile-grid");
const toast = $("#toast");

let room: Room | null = null;
let livekit: typeof import("livekit-client") | null = null;
let session: Session | null = null;
let audioEnabled = true;
let videoEnabled = false;
let screenEnabled = false;
let switchingScreen = false;
let activeSpeakers = new Set<string>();
let toastTimer = 0;

// Страница работает в двух режимах: внутри Wails (полный доступ к Go-методам)
// и как обычная страница, которую локальный хост отдаёт браузерам той же сети.
const inWails = typeof window !== "undefined" && "go" in window;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lanApp = (): any => (window as any).go?.main?.App;
let lanHosting = false;

// Выбор устройств связи: тот же ключ localStorage, что и в веб-версии
type DevicePrefs = { mic?: string; cam?: string; speaker?: string };
type DeviceKey = keyof DevicePrefs;
const DEVICES_KEY = "saytosee:devices";
let devicePrefs: DevicePrefs = (() => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(DEVICES_KEY) || "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    const prefs: DevicePrefs = {};
    for (const key of ["mic", "cam", "speaker"] as const) {
      const value = (stored as Record<string, unknown>)[key];
      if (typeof value === "string" && value && value !== "default") prefs[key] = value;
    }
    return prefs;
  } catch {
    return {};
  }
})();
const deviceKinds: Record<DeviceKey, MediaDeviceKind> = {
  mic: "audioinput", cam: "videoinput", speaker: "audiooutput",
};
const deviceTitles: Record<DeviceKey, string> = {
  mic: "микрофон", cam: "камеру", speaker: "устройство вывода",
};
const deviceSelects: Record<DeviceKey, HTMLSelectElement[]> = {
  mic: [micSelect, callMicSelect],
  cam: [camSelect, callCamSelect],
  speaker: [speakerSelect, callSpeakerSelect],
};
const deviceMenus = new Map<HTMLSelectElement, ReturnType<typeof enhanceDeviceSelect>>();
for (const selects of Object.values(deviceSelects)) {
  for (const select of selects) {
    deviceMenus.set(select, enhanceDeviceSelect(select, {
      label: select.getAttribute("aria-label") || "Устройство связи",
    }));
  }
}
const supportsAudioOutput = "setSinkId" in HTMLMediaElement.prototype;
const switchingDevices = new Set<DeviceKey>();
const labelRequests = new Map<"audio" | "video", Promise<void>>();
let availableDevices: MediaDeviceInfo[] = [];
const knownDeviceIds = new Set<string>();
let deviceRefresh: Promise<void> | null = null;
let deviceChangePending = false;

if (!supportsAudioOutput) {
  for (const select of deviceSelects.speaker) {
    select.disabled = true;
    deviceMenus.get(select)?.refresh();
  }
  $("#lobby-device-note").textContent = "Для вывода звука используется устройство Windows по умолчанию.";
  $("#devices-note").textContent = "Для вывода звука используется устройство Windows по умолчанию. Остальной выбор сохраняется.";
}

function saveDevicePrefs() {
  try {
    localStorage.setItem(DEVICES_KEY, JSON.stringify(devicePrefs));
  } catch {
    // localStorage недоступен — выбор просто не сохранится
  }
}

function syncSelectValue(select: HTMLSelectElement, deviceId?: string) {
  select.value = deviceId && Array.from(select.options).some((option) => option.value === deviceId)
    ? deviceId
    : "";
  select.title = Array.from(select.options).find((option) => option.value === select.value)?.textContent || "По умолчанию";
  deviceMenus.get(select)?.refresh();
}

function availableDevice(key: DeviceKey, deviceId?: string) {
  return Boolean(deviceId && availableDevices.some((device) =>
    device.kind === deviceKinds[key] && device.deviceId === deviceId,
  ));
}

function syncDeviceSelects() {
  for (const key of ["mic", "cam", "speaker"] as const) {
    for (const select of deviceSelects[key]) syncSelectValue(select, devicePrefs[key]);
  }
}

function fillDeviceSelect(
  select: HTMLSelectElement,
  devices: MediaDeviceInfo[],
  fallbackLabel: string,
) {
  select.replaceChildren();
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "По умолчанию";
  select.appendChild(defaultOption);
  devices.filter((device) => device.deviceId && device.deviceId !== "default")
    .forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `${fallbackLabel} ${index + 1}`;
    select.appendChild(option);
    });
  deviceMenus.get(select)?.refresh();
}

async function refreshDeviceLists() {
  try {
    availableDevices = await navigator.mediaDevices.enumerateDevices();
    for (const device of availableDevices) {
      if (device.deviceId) knownDeviceIds.add(`${device.kind}:${device.deviceId}`);
    }
    for (const key of ["mic", "cam", "speaker"] as const) {
      const devices = availableDevices.filter((device) => device.kind === deviceKinds[key]);
      const label = key === "mic" ? "Микрофон" : key === "cam" ? "Камера" : "Устройство вывода";
      for (const select of deviceSelects[key]) fillDeviceSelect(select, devices, label);
    }
    syncDeviceSelects();
  } catch {
    // enumerateDevices недоступен — остаются значения по умолчанию
  }
}

// Запрашиваем только нужный тип: отсутствие камеры не блокирует выбор микрофона.
async function ensureDeviceLabels(key: DeviceKey) {
  const mediaKind = key === "cam" ? "video" : "audio";
  const pending = labelRequests.get(mediaKind);
  if (pending) return pending;
  const request = (async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputKind = mediaKind === "video" ? "videoinput" : "audioinput";
      if (devices.some((device) => device.kind === inputKind && !device.label)) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: mediaKind === "audio", video: mediaKind === "video",
        });
        stream.getTracks().forEach((track) => track.stop());
      }
    } catch {
      // При отказе пользователь всё ещё может выбрать системное устройство.
    }
    await refreshDeviceLists();
  })();
  labelRequests.set(mediaKind, request);
  try {
    await request;
  } finally {
    labelRequests.delete(mediaKind);
  }
}

function setDeviceBusy(key: DeviceKey, busy: boolean) {
  for (const select of deviceSelects[key]) {
    select.disabled = busy || (key === "speaker" && !supportsAudioOutput);
    deviceMenus.get(select)?.refresh();
  }
  if (key === "mic") $<HTMLButtonElement>("#audio-control").disabled = busy;
  if (key === "cam") $<HTMLButtonElement>("#video-control").disabled = busy;
}

function sdkDeviceId(key: DeviceKey, deviceId?: string) {
  return deviceId || (key === "mic" ? "default" : "");
}

function switchRoomDevice(currentRoom: Room, key: DeviceKey, deviceId?: string) {
  // У камер нет синтетического ID "default": пустой ideal выбирает камеру браузера.
  return currentRoom.switchActiveDevice(deviceKinds[key], sdkDeviceId(key, deviceId),
    Boolean(deviceId) || key === "mic");
}

async function changeDevice(key: DeviceKey, deviceId: string) {
  if (switchingDevices.has(key)) return;
  const currentRoom = room;
  const previousPreference = devicePrefs[key];
  switchingDevices.add(key);
  setDeviceBusy(key, true);
  devicesError.textContent = "";
  try {
    if (currentRoom) {
      const changed = await switchRoomDevice(currentRoom, key, deviceId);
      if (!changed) throw new Error("Устройство не удалось активировать.");
      if (room !== currentRoom) return;
    }
    devicePrefs[key] = deviceId || undefined;
    saveDevicePrefs();
    syncDeviceSelects();
  } catch (reason) {
    // SDK может успеть изменить один из треков до ошибки: вернём прежний выбор.
    if (currentRoom && room === currentRoom) {
      try {
        await switchRoomDevice(currentRoom, key, previousPreference);
      } catch {
        // Состояние звука/камеры показываем по фактическим трекам ниже.
      }
      audioEnabled = currentRoom.localParticipant.isMicrophoneEnabled;
      videoEnabled = currentRoom.localParticipant.isCameraEnabled;
      updateControls();
    }
    devicePrefs[key] = previousPreference;
    const message = `Не удалось переключить ${deviceTitles[key]}: ${errorMessage(reason)}`;
    if (devicesDialog.open) devicesError.textContent = message;
    else showToast(message);
    syncDeviceSelects();
  } finally {
    switchingDevices.delete(key);
    setDeviceBusy(key, false);
    updateControls();
  }
}

async function handleDeviceChange() {
  deviceChangePending = true;
  if (deviceRefresh) return deviceRefresh;
  deviceRefresh = (async () => {
    while (deviceChangePending) {
      deviceChangePending = false;
      await refreshDeviceLists();
      for (const key of ["mic", "cam", "speaker"] as const) {
        const selected = devicePrefs[key];
        // Только известный отключённый ID: скрытый до разрешения список не стирает выбор.
        if (!selected || availableDevice(key, selected) || switchingDevices.has(key)
          || !knownDeviceIds.has(`${deviceKinds[key]}:${selected}`)) continue;
        if (key === "speaker" && !supportsAudioOutput) continue;
        const currentRoom = room;
        const hasDevice = availableDevices.some((device) => device.kind === deviceKinds[key] && device.deviceId);
        if (!hasDevice && currentRoom && key !== "speaker") {
          try {
            if (key === "mic") await currentRoom.localParticipant.setMicrophoneEnabled(false);
            else await currentRoom.localParticipant.setCameraEnabled(false);
          } catch { /* Уже остановленный трек не требует повторного отключения. */ }
          if (room === currentRoom) {
            audioEnabled = currentRoom.localParticipant.isMicrophoneEnabled;
            videoEnabled = currentRoom.localParticipant.isCameraEnabled;
            updateControls();
          }
          devicePrefs[key] = undefined;
          saveDevicePrefs();
          syncDeviceSelects();
        } else {
          await changeDevice(key, "");
        }
        if (!devicePrefs[key]) showToast(hasDevice || key === "speaker"
          ? "Устройство отключено. Используется системный выбор."
          : `${key === "mic" ? "Микрофон отключён" : "Камера отключена"}. Подключите устройство, чтобы включить его снова.`);
      }
    }
  })();
  try {
    await deviceRefresh;
  } finally {
    deviceRefresh = null;
  }
}

function openDeviceSettings() {
  if (!room || devicesDialog.open) return;
  devicesError.textContent = "";
  syncDeviceSelects();
  devicesDialog.showModal();
  void refreshDeviceLists();
}

async function prepareCaptureDevice(currentRoom: Room, key: "mic" | "cam") {
  await ensureDeviceLabels(key);
  if (room !== currentRoom) return false;
  const selected = devicePrefs[key];
  const available = availableDevice(key, selected);
  if (selected && !available && availableDevices.some((device) =>
    device.kind === deviceKinds[key] && device.label,
  )) {
    devicePrefs[key] = undefined;
    saveDevicePrefs();
    syncDeviceSelects();
  }
  const changed = await switchRoomDevice(currentRoom, key, available ? selected : undefined);
  if (!changed) throw new Error("Устройство не удалось активировать.");
  return room === currentRoom;
}

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
  const requestedAudio = audioEnabled;
  const requestedVideo = videoEnabled;
  try {
    livekit ??= await import("livekit-client");
  } catch {
    lobbyError.textContent = "Не удалось загрузить модуль видеосвязи.";
    return;
  }

  // exact-констрейнт падает, если устройство отключили после выбора, —
  // сверяем выбор со свежим списком и отсеиваем пропавшие девайсы
  await Promise.all([
    requestedAudio ? ensureDeviceLabels("mic") : Promise.resolve(),
    requestedVideo ? ensureDeviceLabels("cam") : Promise.resolve(),
  ]);
  await refreshDeviceLists();
  for (const key of ["mic", "cam", "speaker"] as const) {
    if (devicePrefs[key] && !availableDevice(key, devicePrefs[key])
      && availableDevices.some((device) => device.kind === deviceKinds[key] && device.label)) {
      devicePrefs[key] = undefined;
    }
  }
  saveDevicePrefs();
  syncDeviceSelects();
  const wiredMic = availableDevice("mic", devicePrefs.mic) ? devicePrefs.mic : undefined;
  const wiredCam = availableDevice("cam", devicePrefs.cam) ? devicePrefs.cam : undefined;
  const wiredSpeaker = supportsAudioOutput && availableDevice("speaker", devicePrefs.speaker)
    ? devicePrefs.speaker
    : undefined;

  session = nextSession;
  lobby.classList.remove("active");
  meeting.classList.add("active");
  $("#meeting-code").textContent = `Встреча ${nextSession.key}`;
  $("#meeting-role").textContent = nextSession.isHost ? "Вы организатор" : "Вы участник";
  $("#connection-label").textContent = "Устанавливаем соединение…";
  document.title = `${nextSession.key} · SayToSee`;

  const currentRoom = new livekit.Room({
    adaptiveStream: true,
    dynacast: true,
    // exact, а не ideal: Chromium при ideal молча откатывается на дефолт
    audioCaptureDefaults: {
      deviceId: wiredMic ? { exact: wiredMic } : undefined,
    },
    videoCaptureDefaults: {
      deviceId: wiredCam ? { exact: wiredCam } : undefined,
      resolution: { width: 640, height: 360, frameRate: 15 },
    },
    audioOutput: wiredSpeaker ? { deviceId: wiredSpeaker } : undefined,
    publishDefaults: { simulcast: false, videoCodec: "vp8", dtx: true, red: false },
  });
  room = currentRoom;
  bindRoomEvents(currentRoom);
  updateControls();
  try {
    await currentRoom.connect(nextSession.serverUrl, nextSession.token, { autoSubscribe: true });
  } catch (reason) {
    if (room === currentRoom) {
      await leaveMeeting(true);
      lobbyError.textContent = `Не удалось войти: ${errorMessage(reason)}`;
    }
    return;
  }
  if (room !== currentRoom) return;
  const mediaErrors: string[] = [];
  if (requestedAudio) {
    try {
      await currentRoom.localParticipant.setMicrophoneEnabled(true);
    } catch (reason) {
      if (room === currentRoom) audioEnabled = false;
      mediaErrors.push(`Микрофон недоступен: ${errorMessage(reason)}`);
    }
  }
  if (room !== currentRoom) return;
  if (requestedVideo) {
    try {
      await currentRoom.localParticipant.setCameraEnabled(true);
    } catch (reason) {
      if (room === currentRoom) videoEnabled = false;
      mediaErrors.push(`Камера недоступна: ${errorMessage(reason)}`);
    }
  }
  if (room !== currentRoom) return;
  $("#connection-label").textContent = "Защищённое соединение";
  renderParticipants();
  updateControls();
  await refreshDeviceLists();
  if (mediaErrors.length) showToast(mediaErrors.join(" "));
}

function bindRoomEvents(currentRoom: Room) {
  const { ConnectionState, RoomEvent, Track } = livekit!;
  const refreshLocalState = () => {
    if (room !== currentRoom) return;
    audioEnabled = currentRoom.localParticipant.isMicrophoneEnabled;
    videoEnabled = currentRoom.localParticipant.isCameraEnabled;
    screenEnabled = currentRoom.localParticipant.isScreenShareEnabled;
    updateControls();
    renderParticipants();
  };
  currentRoom
    .on(RoomEvent.ParticipantConnected, renderParticipants)
    .on(RoomEvent.ParticipantDisconnected, renderParticipants)
    .on(RoomEvent.LocalTrackPublished, () => {
      refreshLocalState();
      void refreshDeviceLists();
    })
    .on(RoomEvent.LocalTrackUnpublished, refreshLocalState)
    .on(RoomEvent.TrackMuted, refreshLocalState)
    .on(RoomEvent.TrackUnmuted, refreshLocalState)
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
      updateControls();
    })
    .on(RoomEvent.Disconnected, () => {
      if (room === currentRoom) void leaveMeeting(false);
    })
    .on(RoomEvent.ActiveDeviceChanged, () => {
      if (room !== currentRoom) return;
      // Системный выбор остаётся системным, даже если SDK сообщает физический ID.
      void handleDeviceChange();
    });
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
  const connected = Boolean(room && livekit && room.state === livekit.ConnectionState.Connected);
  const states: Array<[string, boolean]> = [
    ["#audio-control", audioEnabled],
    ["#video-control", videoEnabled],
    ["#screen-control", screenEnabled],
  ];
  for (const [selector, enabled] of states) {
    $(selector).classList.toggle("active", enabled);
    $(selector).classList.toggle("disabled", !enabled);
    $(selector).setAttribute("aria-pressed", String(enabled));
  }
  $<HTMLButtonElement>("#audio-control").disabled = !connected || switchingDevices.has("mic");
  $<HTMLButtonElement>("#video-control").disabled = !connected || switchingDevices.has("cam");
  $<HTMLButtonElement>("#screen-control").disabled = !connected || switchingScreen;
  devicesControl.disabled = !connected;
}

async function toggleMicrophone() {
  const currentRoom = room;
  if (!currentRoom || switchingDevices.has("mic") || currentRoom.state !== livekit?.ConnectionState.Connected) return;
  switchingDevices.add("mic");
  setDeviceBusy("mic", true);
  try {
    const enable = !audioEnabled;
    if (enable && !await prepareCaptureDevice(currentRoom, "mic")) return;
    await currentRoom.localParticipant.setMicrophoneEnabled(enable);
    if (room !== currentRoom) return;
    audioEnabled = currentRoom.localParticipant.isMicrophoneEnabled;
    updateControls();
    await refreshDeviceLists();
  } catch (reason) {
    if (room === currentRoom) showToast(errorMessage(reason));
  } finally {
    switchingDevices.delete("mic");
    setDeviceBusy("mic", false);
    updateControls();
    void handleDeviceChange();
  }
}

async function toggleCamera() {
  const currentRoom = room;
  if (!currentRoom || switchingDevices.has("cam") || currentRoom.state !== livekit?.ConnectionState.Connected) return;
  switchingDevices.add("cam");
  setDeviceBusy("cam", true);
  try {
    const enable = !videoEnabled;
    if (enable && !await prepareCaptureDevice(currentRoom, "cam")) return;
    await currentRoom.localParticipant.setCameraEnabled(enable);
    if (room !== currentRoom) return;
    videoEnabled = currentRoom.localParticipant.isCameraEnabled;
    updateControls();
    renderParticipants();
    await refreshDeviceLists();
  } catch (reason) {
    if (room === currentRoom) showToast("Не удалось включить камеру: " + errorMessage(reason));
  } finally {
    switchingDevices.delete("cam");
    setDeviceBusy("cam", false);
    updateControls();
    void handleDeviceChange();
  }
}

async function toggleScreen() {
  const currentRoom = room;
  if (!currentRoom || switchingScreen || currentRoom.state !== livekit?.ConnectionState.Connected) return;
  switchingScreen = true;
  updateControls();
  try {
    await currentRoom.localParticipant.setScreenShareEnabled(!screenEnabled, { audio: false });
    if (room !== currentRoom) return;
    screenEnabled = currentRoom.localParticipant.isScreenShareEnabled;
    updateControls();
    renderParticipants();
  } catch (reason) {
    if (room === currentRoom) showToast("Не удалось показать экран: " + errorMessage(reason));
  } finally {
    switchingScreen = false;
    updateControls();
  }
}

async function leaveMeeting(disconnect = true) {
  const currentRoom = room;
  room = null;
  if (devicesDialog.open) devicesDialog.close();
  if (disconnect && currentRoom) await currentRoom.disconnect();
  if (lanHosting) {
    // Хост ушёл — локальная встреча заканчивается вместе с сервером
    lanHosting = false;
    lanApp()?.StopLANHost();
  }
  document.querySelectorAll("[data-saytosee-audio]").forEach((element) => element.remove());
  tileGrid.replaceChildren();
  meeting.classList.remove("active");
  lobby.classList.add("active");
  session = null;
  screenEnabled = false;
  togglePrejoin(audioPrejoin, audioEnabled);
  togglePrejoin(videoPrejoin, videoEnabled);
  document.title = "SayToSee";
  setPending(false);
}

// --- Локальная сеть: хост и обнаружение встреч ---

async function submitCreateLAN() {
  lobbyError.textContent = "";
  if (!nameInput.value.trim()) {
    lobbyError.textContent = "Введите имя, которое увидят участники.";
    nameInput.focus();
    return;
  }
  setPending(true, "create");
  try {
    const started = await lanApp().StartLANHost(nameInput.value.trim());
    lanHosting = true;
    await enterMeeting(started as Session);
    const url = (started as Session).inviteUrl;
    $("#connection-label").textContent = `Локальная встреча · гости: ${url}`;
    showToast(`Хост запущен: ${url}`);
  } catch (reason) {
    lobbyError.textContent = errorMessage(reason);
  } finally {
    setPending(false);
  }
}

async function refreshLANList() {
  const app = lanApp();
  if (!app) return;
  try {
    const hosts = (await app.DiscoverLANHosts()) as Array<{
      name: string; ip: string; port: number; roomKey: string; hostName: string;
    }>;
    const list = $("#lan-list");
    list.replaceChildren();
    for (const host of hosts) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "lan-item";
      const title = document.createElement("b");
      title.textContent = host.hostName || host.name;
      const meta = document.createElement("small");
      meta.textContent = `${host.roomKey || "встреча"} · ${host.ip}`;
      item.append(title, meta);
      item.addEventListener("click", () => void joinLANHost(host));
      list.appendChild(item);
    }
    $("#lan-discovery").classList.toggle("visible", hosts.length > 0);
  } catch {
    // mDNS недоступен в этой сети — секция просто пустует
  }
}

async function joinLANHost(host: { ip: string; port: number; roomKey: string }) {
  lobbyError.textContent = "";
  if (!nameInput.value.trim()) {
    lobbyError.textContent = "Введите имя, которое увидят участники.";
    nameInput.focus();
    return;
  }
  setPending(true, "join");
  try {
    const started = await lanApp().JoinLANHost(
      host.ip, host.port, nameInput.value.trim(), host.roomKey || "",
    );
    await enterMeeting(started as Session);
  } catch (reason) {
    lobbyError.textContent = errorMessage(reason);
  } finally {
    setPending(false);
  }
}

// --- API-адаптер: внутри Wails вызываем Go, в браузере — HTTP того же хоста ---

async function apiCheckServer() {
  if (inWails) return CheckServer();
  const response = await fetch("/api/health");
  if (!response.ok) throw new Error("сервер недоступен");
}

async function apiCreateRoom(name: string): Promise<Session> {
  if (inWails) return CreateRoom(name);
  const response = await fetch("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await response.json() as Session & { error?: string };
  if (!response.ok) throw new Error(data.error || "сервер ответил с ошибкой");
  return data;
}

async function apiJoinRoom(key: string, name: string): Promise<Session> {
  if (inWails) return JoinRoom({ key: formatKey(key), name });
  const response = await fetch("/api/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, name }),
  });
  const data = await response.json() as Session & { error?: string };
  if (!response.ok) throw new Error(data.error || "сервер ответил с ошибкой");
  return data;
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
    await enterMeeting(await apiJoinRoom(formatKey(key), nameInput.value.trim()));
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
    const created = await apiCreateRoom(nameInput.value.trim());
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
    await apiCheckServer();
    serverStatus.classList.add("online");
    serverStatus.querySelector("em")!.textContent = inWails ? "Сервер доступен" : "Хост доступен";
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
for (const key of ["mic", "cam", "speaker"] as const) {
  for (const select of deviceSelects[key]) {
    select.addEventListener("focus", () => void ensureDeviceLabels(key));
    select.addEventListener("change", () => void changeDevice(key, select.value));
  }
}
navigator.mediaDevices?.addEventListener?.("devicechange", () => void handleDeviceChange());
void refreshDeviceLists();
$("#join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void submitJoin();
});
createButton.addEventListener("click", () => void submitCreate());
$("#audio-control").addEventListener("click", () => void toggleMicrophone());
$("#video-control").addEventListener("click", () => void toggleCamera());
$("#screen-control").addEventListener("click", () => void toggleScreen());
devicesControl.addEventListener("click", openDeviceSettings);
$("#devices-close").addEventListener("click", () => devicesDialog.close());
devicesDialog.addEventListener("close", () => {
  if (meeting.classList.contains("active")) devicesControl.focus();
});
devicesDialog.addEventListener("click", (event) => {
  if (event.target !== devicesDialog) return;
  const bounds = devicesDialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right
    || event.clientY < bounds.top || event.clientY > bounds.bottom) devicesDialog.close();
});
$("#leave-control").addEventListener("click", () => void leaveMeeting());

// Локальная сеть: кнопки хоста и авто-поиск встреч (только внутри Wails)
if (inWails) {
  $("#lan-host-button").addEventListener("click", () => void submitCreateLAN());
  $("#lan-rescan").addEventListener("click", () => void refreshLANList());
  void refreshLANList();
  window.setInterval(() => {
    if (lobby.classList.contains("active")) void refreshLANList();
  }, 6000);
} else {
  // Страница, отданная локальным хостом браузеру/телефону: это роль гостя
  $("#lan-block").style.display = "none";
  createButton.style.display = "none";
  const urlKey = new URLSearchParams(window.location.search).get("key");
  if (urlKey) keyInput.value = formatKey(urlKey);
}

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
  for (const menu of deviceMenus.values()) menu.destroy();
  if (room) void room.disconnect();
});

void checkServer();
