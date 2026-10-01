export type DevicePreferences = {
  mic?: string;
  cam?: string;
  speaker?: string;
};

const DEVICES_STORAGE_KEY = "saytosee:devices";

export function loadDevicePreferences(): DevicePreferences {
  try {
    const raw = window.localStorage.getItem(DEVICES_STORAGE_KEY) ?? "";
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<DevicePreferences>;
    return {
      mic: typeof parsed.mic === "string" ? parsed.mic : undefined,
      cam: typeof parsed.cam === "string" ? parsed.cam : undefined,
      speaker:
        typeof parsed.speaker === "string" ? parsed.speaker : undefined,
    };
  } catch {
    return {};
  }
}

export function saveDevicePreferences(preferences: DevicePreferences) {
  try {
    window.localStorage.setItem(DEVICES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Нет доступа к localStorage (приватный режим) — не критично
  }
}
