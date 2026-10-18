"use client";

import { Mic, MonitorSpeaker, Settings, Video, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { enhanceDeviceSelect } from "../shared/device-menu";
import type { DevicePreferences } from "./device-preferences";

export type MediaDeviceLists = {
  mics: MediaDeviceInfo[];
  cams: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
};

type DeviceSelectorsProps = {
  devices: DevicePreferences;
  lists: MediaDeviceLists;
  onChange: (patch: Partial<DevicePreferences>) => void;
  onFocus?: (kind: MediaDeviceKind) => void;
  busy?: boolean;
  outputSupported?: boolean;
};

type DeviceFieldProps = {
  preference: keyof DevicePreferences;
  kind: MediaDeviceKind;
  label: string;
  fallback: string;
  icon: LucideIcon;
  list: MediaDeviceInfo[];
  selected: string;
  disabled: boolean;
  onChange: DeviceSelectorsProps["onChange"];
  onFocus: DeviceSelectorsProps["onFocus"];
};

function DeviceField({
  preference,
  kind,
  label,
  fallback,
  icon: Icon,
  list,
  selected,
  disabled,
  onChange,
  onFocus,
}: DeviceFieldProps) {
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const selectRef = useRef<HTMLSelectElement>(null);
  const menuRef = useRef<ReturnType<typeof enhanceDeviceSelect> | null>(null);
  const callbacksRef = useRef({ onChange, preference });
  const knownDevice = list.some((device) => device.deviceId === selected);

  useEffect(() => {
    callbacksRef.current = { onChange, preference };
  }, [onChange, preference]);

  useEffect(() => {
    const select = selectRef.current;
    if (!select) return;

    // The shared menu emits a native event; call the current callback exactly once.
    const handleChange = () => {
      const callback = callbacksRef.current;
      callback.onChange({ [callback.preference]: select.value || undefined });
    };
    select.addEventListener("change", handleChange);
    const menu = enhanceDeviceSelect(select, { label });
    menuRef.current = menu;

    return () => {
      select.removeEventListener("change", handleChange);
      menu.destroy();
      menuRef.current = null;
    };
  }, [label]);

  // React owns the option list and selected value; the menu reads their final DOM state.
  useEffect(() => {
    menuRef.current?.refresh();
  });

  return (
    <div
      className={`device-select${preference === "speaker" ? " wide" : ""}`}
      onFocusCapture={(event) => {
        const target = event.target as HTMLElement;
        if (target === selectRef.current || target.hasAttribute("data-device-trigger")) {
          onFocus?.(kind);
        }
      }}
    >
      <span id={labelId}><Icon size={15} aria-hidden="true" />{label}</span>
      <select
        ref={selectRef}
        id={fieldId}
        aria-labelledby={labelId}
        value={selected}
        title={list.find((device) => device.deviceId === selected)?.label || `${label}: по умолчанию`}
        disabled={disabled}
        onChange={() => {}}
      >
        <option value="">По умолчанию</option>
        {selected && !knownDevice && <option value={selected}>Выбранное устройство недоступно</option>}
        {list.filter((device) => device.deviceId && device.deviceId !== "default").map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `${fallback} ${index + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}

export function DeviceSelectors({
  devices,
  lists,
  onChange,
  onFocus,
  busy = false,
  outputSupported = true,
}: DeviceSelectorsProps) {
  const fields = [
    { preference: "mic", kind: "audioinput", label: "Микрофон", fallback: "Микрофон", icon: Mic, list: lists.mics },
    { preference: "cam", kind: "videoinput", label: "Камера", fallback: "Камера", icon: Video, list: lists.cams },
    { preference: "speaker", kind: "audiooutput", label: "Вывод звука", fallback: "Устройство вывода", icon: MonitorSpeaker, list: lists.speakers },
  ] as const;

  return (
    <div className="device-selects device-dialog-fields">
      {fields.map(({ preference, kind, label, fallback, icon, list }) => (
        <DeviceField
          key={kind}
          preference={preference}
          kind={kind}
          label={label}
          fallback={fallback}
          icon={icon}
          list={list}
          selected={devices[preference] ?? ""}
          disabled={busy || (kind === "audiooutput" && !outputSupported)}
          onChange={onChange}
          onFocus={onFocus}
        />
      ))}
    </div>
  );
}

export default function DeviceSettingsDialog({
  triggerClassName,
  onOpen,
  error,
  message,
  ...selectorProps
}: DeviceSelectorsProps & {
  triggerClassName: string;
  onOpen?: () => void;
  error?: string;
  message?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        aria-haspopup="dialog"
        aria-label="Настроить устройства связи"
        title="Настроить устройства связи"
        onClick={() => {
          dialogRef.current?.showModal();
          onOpen?.();
        }}
      >
        <Settings size={16} aria-hidden="true" />
        <span>Устройства</span>
      </button>
      <dialog ref={dialogRef} className="device-settings-dialog" aria-labelledby={headingId}>
        <div className="device-dialog-header">
          <div><h2 id={headingId}>Устройства связи</h2><p>Выбор применяется сразу</p></div>
          <button type="button" className="device-dialog-close" aria-label="Закрыть настройки устройств" onClick={() => dialogRef.current?.close()}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <DeviceSelectors {...selectorProps} />
        {selectorProps.outputSupported === false && (
          <p className="device-dialog-message">В этом браузере звук выводится на устройство, выбранное в настройках системы.</p>
        )}
        {message && <p className="device-dialog-message" role="status">{message}</p>}
        {error && <p className="device-dialog-error" role="alert">{error}</p>}
      </dialog>
    </>
  );
}
