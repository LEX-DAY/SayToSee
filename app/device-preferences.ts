export type DevicePreferences = {
  mic?: string;
  cam?: string;
  speaker?: string;
};

const DEVICES_STORAGE_KEY = "saytosee:devices";

function chosenDevice(value: unknown) {
  return typeof value === "string" && value !== "" && value !== "default" ? value : undefined;
}

export function loadDevicePreferences(): DevicePreferences {
  try {
    const raw = window.localStorage.getItem(DEVICES_STORAGE_KEY) ?? "";
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<DevicePreferences>;
    return {
      mic: chosenDevice(parsed.mic),
      cam: chosenDevice(parsed.cam),
      speaker: chosenDevice(parsed.speaker),
    };
  } catch {
    return {};
  }
}

export function saveDevicePreferences(preferences: DevicePreferences) {
  try {
    window.localStorage.setItem(DEVICES_STORAGE_KEY, JSON.stringify({
      mic: chosenDevice(preferences.mic),
      cam: chosenDevice(preferences.cam),
      speaker: chosenDevice(preferences.speaker),
    }));
  } catch {
    // Нет доступа к localStorage (приватный режим) — не критично
  }
}
