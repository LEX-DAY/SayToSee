import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// This harness replaces capture devices, the Wails bridge and LiveKit transport.
// It verifies layout and UI state without capturing audio/video or joining a server.
const require = createRequire(import.meta.url);
const runtimeModules = process.env.CODEX_QA_NODE_MODULES ||
  "C:/Users/ange1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const { chromium } = require(path.join(runtimeModules, "playwright"));
const webUrl = process.env.QA_WEB_URL || "http://127.0.0.1:3001";
const desktopUrl = process.env.QA_DESKTOP_URL || "http://127.0.0.1:5173";
const outputDir = path.resolve("work/qa-responsive");
await mkdir(outputDir, { recursive: true });
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
const snapshotsOnly = process.argv.includes("--snapshots");

const webSizes = [[1440, 900], [1180, 730], [1024, 600], [768, 1024],
  [390, 844], [320, 568], [844, 390], [390, 360]];
const desktopSizes = [[1164, 720], [1000, 650], [760, 562]];
const reports = [];
const failures = [];

function fakeEnvironment({ realistic = false } = {}) {
  window.__qaCaptureRequests = [];
  window.__qaDevices = [
    { kind: "audioinput", deviceId: "mic-1", groupId: "usb-1", label: "По умолчанию — Микрофон USB Audio Device (0d8c:0012) " + "очень длинное название устройства ".repeat(8) },
    { kind: "audioinput", deviceId: "mic-2", groupId: "usb-2", label: "Второй микрофон USB" },
    { kind: "audioinput", deviceId: "mic-fail", groupId: "usb-3", label: "Недоступный микрофон для проверки отката" },
    { kind: "videoinput", deviceId: "cam-1", groupId: "camera-1", label: "Камера — " + "очень длинное название устройства ".repeat(8) },
    { kind: "videoinput", deviceId: "cam-2", groupId: "camera-2", label: "Вторая камера" },
    { kind: "audiooutput", deviceId: "speaker-1", groupId: "usb-1", label: "Динамики USB Audio Device (0d8c:0012) " + "очень длинное название устройства ".repeat(8) },
    { kind: "audiooutput", deviceId: "speaker-2", groupId: "usb-2", label: "Наушники USB" },
  ];
  if (realistic) {
    const names = {
      "mic-1": "Связь — Динамик телефона с отменой эха (Poly Calisto 5300 Series) (047f:015b)",
      "mic-2": "Микрофон (3- USB Audio Device) (0d8c:0012)",
      "mic-fail": "Динамик телефона с отменой эха (Poly Calisto 5300 Series) (047f:015b)",
      "cam-1": "Logitech HD Webcam C270", "cam-2": "USB 2.0 Camera",
      "speaker-1": "Динамики (3- USB Audio Device) (0d8c:0012)",
      "speaker-2": "Наушники (Realtek High Definition Audio)",
    };
    window.__qaDevices.forEach((device) => { device.label = names[device.deviceId]; });
  }
  const events = new EventTarget();
  const mediaDevices = {
    enumerateDevices: async () => window.__qaDevices.map((item) => ({ ...item, toJSON: () => ({ ...item }) })),
    getUserMedia: async (constraints) => {
      window.__qaCaptureRequests.push(constraints);
      return { getTracks: () => [{ stop() {} }] };
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: mediaDevices });
  Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", { configurable: true, value: async function (id) { this.__qaSinkId = id; } });
  localStorage.setItem("saytosee:devices", JSON.stringify({ mic: realistic ? "mic-2" : "mic-1", cam: "cam-1", speaker: "speaker-1" }));
  localStorage.setItem("saytosee:noise-filter", "false");
  window.go = { main: { App: {
    CheckServer: async () => undefined,
    CreateRoom: async (displayName) => ({ room: "qa-room", key: "0123-4567-89AB-CDEF", inviteUrl: "https://89.169.153.186/?key=0123-4567-89AB-CDEF", token: "qa-token", serverUrl: "wss://qa.invalid", isHost: true, displayName }),
    JoinRoom: async ({ name: displayName }) => ({ room: "qa-room", key: "0123-4567-89AB-CDEF", inviteUrl: "https://89.169.153.186/?key=0123-4567-89AB-CDEF", token: "qa-token", serverUrl: "wss://qa.invalid", isHost: false, displayName }),
  } } };
}

const livekitMock = `
export const RoomEvent = Object.fromEntries(["ParticipantConnected", "ParticipantDisconnected", "LocalTrackPublished", "LocalTrackUnpublished", "TrackMuted", "TrackUnmuted", "TrackSubscribed", "TrackUnsubscribed", "ActiveSpeakersChanged", "ConnectionStateChanged", "Disconnected", "ActiveDeviceChanged"].map(key => [key, key]));
export const ConnectionState = { Connecting: "connecting", Reconnecting: "reconnecting", Connected: "connected", Disconnected: "disconnected" };
export const Track = { Kind: { Audio: "audio", Video: "video" }, Source: { Microphone: "microphone", Camera: "camera", ScreenShare: "screen_share" } };
export class Room {
  constructor(options) {
    this.options = options; this.handlers = new Map(); this.remoteParticipants = new Map(); this.calls = []; this.state = ConnectionState.Disconnected;
    this.activeDevices = { audioinput: options.audioCaptureDefaults?.deviceId?.exact || "default", videoinput: options.videoCaptureDefaults?.deviceId?.exact || "default", audiooutput: options.audioOutput?.deviceId || "default" };
    this.localParticipant = { sid: "qa-local", name: "Алексей", identity: "qa-local", trackPublications: new Map(), isMicrophoneEnabled: false, isCameraEnabled: false, isScreenShareEnabled: false,
      setMicrophoneEnabled: async (enabled) => { this.calls.push(["microphone", enabled]); this.localParticipant.isMicrophoneEnabled = enabled; },
      setCameraEnabled: async (enabled) => { this.calls.push(["camera", enabled]); this.localParticipant.isCameraEnabled = enabled; },
      setScreenShareEnabled: async (enabled) => { this.calls.push(["screen", enabled]); this.localParticipant.isScreenShareEnabled = enabled; },
    };
    window.__qaRoom = this;
  }
  on(event, handler) { const list = this.handlers.get(event) || []; list.push(handler); this.handlers.set(event, list); return this; }
  emit(event, ...args) { for (const handler of this.handlers.get(event) || []) handler(...args); }
  async connect() { this.calls.push(["connect"]); this.state = ConnectionState.Connected; this.emit(RoomEvent.ConnectionStateChanged, this.state); }
  async disconnect() { this.calls.push(["disconnect"]); this.state = ConnectionState.Disconnected; this.emit(RoomEvent.Disconnected); }
  getActiveDevice(kind) { return this.activeDevices[kind]; }
  async switchActiveDevice(kind, id) {
    this.calls.push(["switch", kind, id]); this.activeDevices[kind] = id;
    if (id === "mic-fail") throw new Error("QA: device rejected after partial switch");
    this.emit(RoomEvent.ActiveDeviceChanged, kind, id); return true;
  }
}
`;

async function contextFor(browser, size, desktop = false, realistic = false) {
  const context = await browser.newContext({ viewport: { width: size[0], height: size[1] } });
  await context.addInitScript(fakeEnvironment, { realistic });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  if (desktop) {
    await page.route(/\/node_modules\/\.vite\/deps\/livekit-client\.js(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: livekitMock }));
  }
  return { context, page, errors };
}

async function auditLayout(page, rootSelectors, controlSelector) {
  return page.evaluate(({ rootSelectors, controlSelector }) => {
    const roots = rootSelectors.flatMap((selector) => {
      const node = document.querySelector(selector);
      if (!node) return [];
      return [{ selector, width: node.clientWidth, height: node.clientHeight, scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight }];
    });
    const controls = [...document.querySelectorAll(controlSelector)].filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== "hidden";
    }).map((node) => {
      const rect = node.getBoundingClientRect();
      const clips = [];
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const box = parent.getBoundingClientRect();
        if (["hidden", "clip", "auto", "scroll"].includes(style.overflowX) && (rect.left < box.left - 1 || rect.right > box.right + 1)) clips.push(parent.className || parent.tagName);
        if (["hidden", "clip", "auto", "scroll"].includes(style.overflowY) && (rect.top < box.top - 1 || rect.bottom > box.bottom + 1)) clips.push(parent.className || parent.tagName);
      }
      return { name: node.id || node.getAttribute("aria-label") || node.textContent?.trim().slice(0, 60), left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, clips };
    });
    return { viewport: { width: innerWidth, height: innerHeight }, roots, controls };
  }, { rootSelectors, controlSelector });
}

function verifyLayout(result, label) {
  for (const root of result.roots) {
    assert.ok(root.scrollWidth <= root.width + 1, `${label}: ${root.selector} horizontal overflow ${root.scrollWidth}/${root.width}`);
    assert.ok(root.scrollHeight <= root.height + 1, `${label}: ${root.selector} vertical overflow ${root.scrollHeight}/${root.height}`);
  }
  assert.ok(result.controls.length > 0, `${label}: no controls rendered`);
  for (const control of result.controls) {
    assert.ok(control.left >= -1 && control.top >= -1 && control.right <= result.viewport.width + 1 && control.bottom <= result.viewport.height + 1,
      `${label}: ${control.name} outside viewport (${JSON.stringify(control)})`);
    assert.equal(control.clips.length, 0, `${label}: ${control.name} clipped by ${control.clips.join(", ")}`);
  }
}

async function runCase(label, action) {
  try { await action(); console.log(`PASS ${label}`); }
  catch (error) { failures.push({ label, error: error.message }); console.error(`FAIL ${label}: ${error.message}`); }
}

// Exercise the visible, styled picker; the native select remains only as a
// backing value/compatibility bridge and must not be used to bypass the UI.
async function deviceTrigger(page, selectOrSelector) {
  const select = typeof selectOrSelector === "string" ? page.locator(selectOrSelector) : selectOrSelector;
  const id = await select.getAttribute("id");
  assert.ok(id, "device backing select has an id");
  assert.equal(await select.isVisible(), false, "native select is hidden; only branded controls are visible");
  return page.locator(`[data-device-trigger][data-device-select-id=${JSON.stringify(id)}]`);
}

async function chooseDevice(page, selectOrSelector, value) {
  const trigger = await deviceTrigger(page, selectOrSelector);
  await trigger.click();
  await auditPickerMenu(page, `${await trigger.getAttribute("aria-label")} menu choosing ${value || "default"}`);
  await page.locator(`.device-menu:visible [role=option][data-value=${JSON.stringify(value)}]`).click();
  await page.locator(".device-menu:visible").waitFor({ state: "hidden" });
}

async function auditPickerMenu(page, label) {
  const result = await page.locator(".device-menu:visible").evaluate((menu) => {
    const rect = menu.getBoundingClientRect();
    const trigger = document.querySelector(`[data-device-trigger][aria-controls="${menu.id}"]`);
    const anchor = trigger?.getBoundingClientRect();
    return {
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      width: menu.clientWidth, boxWidth: rect.width, scrollWidth: menu.scrollWidth,
      side: menu.dataset.side,
      trigger: anchor ? { left: anchor.left, top: anchor.top, right: anchor.right, bottom: anchor.bottom, width: anchor.width } : null,
      roots: [document.documentElement, document.body].map((root) => ({
        name: root.tagName, width: root.clientWidth, height: root.clientHeight,
        scrollWidth: root.scrollWidth, scrollHeight: root.scrollHeight,
      })),
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      hittable: menu.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, 24))),
      options: [...menu.querySelectorAll("[role=option]")].map((option) => ({
        text: option.textContent.trim(), width: option.clientWidth,
        scrollWidth: option.scrollWidth, height: option.clientHeight,
        scrollHeight: option.scrollHeight,
      })),
    };
  });
  assert.ok(result.left >= -1 && result.top >= -1 && result.right <= result.viewportWidth + 1 && result.bottom <= result.viewportHeight + 1,
    `${label}: menu outside viewport (${JSON.stringify(result)})`);
  assert.ok(result.scrollWidth <= result.width + 1, `${label}: menu has horizontal overflow`);
  assert.ok(result.trigger, `${label}: popup has its owning field`);
  assert.ok(Math.abs(result.boxWidth - result.trigger.width) <= 1, `${label}: menu width differs from field (${result.boxWidth}/${result.trigger.width})`);
  assert.ok(Math.abs(result.left - result.trigger.left) <= 1, `${label}: menu is detached horizontally from its field`);
  assert.ok(["top", "bottom"].includes(result.side), `${label}: dropdown has a declared direction`);
  const seam = result.side === "top"
    ? result.bottom - result.trigger.top - 1
    : result.top - result.trigger.bottom + 1;
  assert.ok(Math.abs(seam) <= 1, `${label}: dropdown has a gap or excess overlap (${seam})`);
  for (const root of result.roots) {
    assert.ok(root.scrollWidth <= root.width + 1, `${label}: ${root.name} horizontal overflow while menu is open`);
    assert.ok(root.scrollHeight <= root.height + 1, `${label}: ${root.name} vertical overflow while menu is open`);
  }
  assert.equal(result.hittable, true, `${label}: menu is visually clipped or covered at its click target`);
  assert.ok(result.options.length > 0, `${label}: no options`);
  for (const option of result.options) {
    assert.ok(option.scrollWidth <= option.width + 1, `${label}: option text overflows horizontally: ${option.text.slice(0, 60)}`);
    assert.ok(option.scrollHeight <= option.height + 1, `${label}: option text is clipped vertically: ${option.text.slice(0, 60)}`);
  }
  reports.push({ label, menu: result });
  return result;
}

async function keyboardPicker(page, selectOrSelector, screenshotName) {
  const select = typeof selectOrSelector === "string" ? page.locator(selectOrSelector) : selectOrSelector;
  const trigger = await deviceTrigger(page, select);
  const previous = await select.inputValue();
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await page.locator(".device-menu:visible").waitFor();
  assert.equal(await trigger.getAttribute("aria-expanded"), "true", "picker announces open state");
  await auditPickerMenu(page, `${screenshotName} open menu`);
  await page.screenshot({ path: path.join(outputDir, `${screenshotName}.png`) });
  const activeValue = async () => {
    const activeId = await trigger.getAttribute("aria-activedescendant");
    return page.locator(`[id=${JSON.stringify(activeId)}]`).getAttribute("data-value");
  };
  await page.keyboard.press("End");
  assert.equal(await activeValue(), "mic-fail", "End highlights final enabled device");
  await page.keyboard.press("ArrowUp");
  assert.equal(await activeValue(), "mic-2", "ArrowUp highlights previous device");
  await page.keyboard.press("ArrowDown");
  assert.equal(await activeValue(), "mic-fail", "ArrowDown highlights next device");
  await page.keyboard.press("Home");
  assert.equal(await activeValue(), "", "Home highlights default device");
  await page.keyboard.press("Enter");
  await page.locator(".device-menu:visible").waitFor({ state: "hidden" });
  await page.waitForFunction(({ id }) => document.getElementById(id)?.value === "", { id: await select.getAttribute("id") });
  assert.equal(await select.inputValue(), "", "Home selects system default");
  assert.equal(await trigger.evaluate((node) => document.activeElement === node), true, "selection restores trigger focus");
  await trigger.click();
  // Playwright's physical-key map does not include Cyrillic keys; emit the
  // same keydown events to exercise Russian typeahead without touching values.
  for (const character of "Второй") await trigger.dispatchEvent("keydown", { key: character, bubbles: true });
  await page.keyboard.press("Enter");
  await page.waitForFunction(({ id }) => document.getElementById(id)?.value === "mic-2", { id: await select.getAttribute("id") });
  assert.equal(await trigger.evaluate((node) => document.activeElement === node), true, "typeahead selection restores focus");
  await trigger.click();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Escape");
  await page.locator(".device-menu:visible").waitFor({ state: "hidden" });
  assert.equal(await select.inputValue(), "mic-2", "Escape cancels pending selection");
  assert.equal(await trigger.evaluate((node) => document.activeElement === node), true, "Escape restores picker focus");
  await trigger.click();
  const outside = page.locator("dialog[open] h2").first();
  if (await outside.count()) await outside.click();
  else await page.mouse.click(2, 2);
  await page.locator(".device-menu:visible").waitFor({ state: "hidden" });
  assert.equal(await select.inputValue(), "mic-2", "outside click cancels pending selection");
  if (previous && previous !== "mic-2") await chooseDevice(page, select, previous);
}

async function resizePicker(page, selectOrSelector, size, label) {
  await (await deviceTrigger(page, selectOrSelector)).click();
  await page.setViewportSize({ width: size[0], height: size[1] });
  await page.waitForFunction(() => {
    const menu = [...document.querySelectorAll(".device-menu")].find((node) => node.getBoundingClientRect().height > 0);
    if (!menu) return false;
    const box = menu.getBoundingClientRect();
    return box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
  });
  await auditPickerMenu(page, label);
  await page.screenshot({ path: path.join(outputDir, `${label.replaceAll(" ", "-")}.png`) });
  await page.keyboard.press("Escape");
}

const browser = await chromium.launch({ headless: true, channel: process.env.QA_BROWSER_CHANNEL || "chrome" });
try {
  if (!snapshotsOnly) {
  for (const size of (only === "desktop" ? [] : webSizes)) await runCase(`web ${size.join("x")}`, async () => {
    const { context, page, errors } = await contextFor(browser, size);
    try {
      await page.goto(webUrl, { waitUntil: "networkidle" });
      await page.locator(".nav-status-up").waitFor();
      const layout = await auditLayout(page, ["html", "body", ".hero", ".join-card"], ".join-card input, .join-card button:not(.device-menu-option)");
      reports.push({ label: `web ${size.join("x")}`, ...layout, errors });
      await page.screenshot({ path: path.join(outputDir, `web-${size.join("x")}.png`) });
      verifyLayout(layout, `web ${size.join("x")}`);
      assert.deepEqual(errors, [], "web runtime exceptions");
      const trigger = page.locator(".prejoin-devices-button");
      if (await trigger.isVisible()) {
        await trigger.click();
        await page.locator("dialog[open]").waitFor();
        const dialogLayout = await auditLayout(page, ["html", "body", "dialog[open]"], "dialog[open] button:not(.device-menu-option)");
        reports.push({ label: `web dialog ${size.join("x")}`, ...dialogLayout });
        verifyLayout(dialogLayout, `web dialog ${size.join("x")}`);
        assert.equal(await page.locator("dialog[open]").evaluate((node) => node.contains(document.activeElement)), true, "dialog receives focus");
        await keyboardPicker(page, page.locator("dialog[open] select").nth(0), `web-dialog-menu-${size.join("x")}`);
        await chooseDevice(page, page.locator("dialog[open] select").nth(0), "mic-2");
        await chooseDevice(page, page.locator("dialog[open] select").nth(2), "speaker-2");
        await page.waitForFunction(() => {
          const stored = JSON.parse(localStorage.getItem("saytosee:devices") || "{}");
          return stored.mic === "mic-2" && stored.speaker === "speaker-2";
        });
        await page.keyboard.press("Escape");
        await page.locator("dialog[open]").waitFor({ state: "hidden" });
        assert.equal(await trigger.evaluate((node) => node === document.activeElement), true, "Escape returns focus to trigger");
      } else {
        await keyboardPicker(page, page.locator(".prejoin-device-inline select").nth(0), `web-lobby-menu-${size.join("x")}`);
        await chooseDevice(page, page.locator(".prejoin-device-inline select").nth(0), "mic-2");
        await page.waitForFunction(() => JSON.parse(localStorage.getItem("saytosee:devices") || "{}").mic === "mic-2");
      }
      await page.getByRole("button", { name: "Создать новую комнату", exact: true }).click();
      await page.getByText("Введите имя, которое увидят участники", { exact: true }).waitFor();
      const errorLayout = await auditLayout(page, ["html", "body", ".hero", ".join-card"], ".join-card input, .join-card button:not(.device-menu-option)");
      reports.push({ label: `web validation error ${size.join("x")}`, ...errorLayout });
      verifyLayout(errorLayout, `web validation error ${size.join("x")}`);
    } finally { await context.close(); }
  });

  for (const size of (only === "web" ? [] : desktopSizes)) await runCase(`desktop ${size.join("x")}`, async () => {
    const { context, page, errors } = await contextFor(browser, size, true);
    try {
      await page.goto(desktopUrl, { waitUntil: "networkidle" });
      await page.locator("#device-mic option[value='mic-1']").waitFor({ state: "attached" });
      const layout = await auditLayout(page, ["html", "body", ".app-shell", "#lobby", ".lobby-content", ".join-card"], "#lobby input, #lobby button:not(.device-menu-option)");
      reports.push({ label: `desktop ${size.join("x")}`, ...layout, errors });
      await page.screenshot({ path: path.join(outputDir, `desktop-${size.join("x")}.png`) });
      verifyLayout(layout, `desktop ${size.join("x")}`);
      assert.deepEqual(errors, [], "desktop runtime exceptions");
      await keyboardPicker(page, "#device-mic", `desktop-lobby-menu-${size.join("x")}`);
      await page.locator("#create-button").click();
      await page.locator("#lobby-error").filter({ hasText: "Введите имя" }).waitFor();
      const errorLayout = await auditLayout(page, ["html", "body", ".app-shell", "#lobby", ".lobby-content", ".join-card"], "#lobby input, #lobby button:not(.device-menu-option)");
      reports.push({ label: `desktop validation error ${size.join("x")}`, ...errorLayout });
      verifyLayout(errorLayout, `desktop validation error ${size.join("x")}`);
    } finally { await context.close(); }
  });

  if (only !== "desktop") await runCase("web open picker resize and unavailable output", async () => {
    const { context, page, errors } = await contextFor(browser, [390, 844]);
    await context.addInitScript(() => { delete HTMLMediaElement.prototype.setSinkId; });
    try {
      await page.goto(webUrl, { waitUntil: "networkidle" });
      await page.locator(".prejoin-devices-button").click();
      await page.locator("dialog[open]").waitFor();
      const output = await deviceTrigger(page, page.locator("dialog[open] select").nth(2));
      assert.equal(await output.isDisabled(), true, "unsupported output is visibly disabled");
      await resizePicker(page, page.locator("dialog[open] select").nth(0), [320, 568], "web-dialog-menu-resize-320x568");
      await page.keyboard.press("Escape");
      await page.locator("dialog[open]").waitFor({ state: "hidden" });
      assert.deepEqual(errors, [], "web resize runtime exceptions");
    } finally { await context.close(); }
  });

  if (only !== "web") await runCase("desktop open picker resize and unavailable output", async () => {
    const { context, page, errors } = await contextFor(browser, [1164, 720], true);
    await context.addInitScript(() => { delete HTMLMediaElement.prototype.setSinkId; });
    try {
      await page.goto(desktopUrl, { waitUntil: "networkidle" });
      await page.locator("#device-mic option[value='mic-1']").waitFor({ state: "attached" });
      const output = await deviceTrigger(page, "#device-speaker");
      assert.equal(await output.isDisabled(), true, "unsupported Wails output is visibly disabled");
      await resizePicker(page, "#device-mic", [760, 562], "desktop-lobby-menu-resize-760x562");
      assert.deepEqual(errors, [], "desktop resize runtime exceptions");
    } finally { await context.close(); }
  });

  for (const desktop of [false, true].filter((desktop) => desktop ? only !== "web" : only !== "desktop")) {
    const label = `${desktop ? "desktop" : "web"} dialog without Popover API`;
    await runCase(label, async () => {
      const { context, page, errors } = await contextFor(browser, desktop ? [760, 562] : [320, 568], desktop);
      await context.addInitScript(() => {
        Object.defineProperty(HTMLElement.prototype, "showPopover", { configurable: true, value: undefined });
      });
      try {
        await page.goto(desktop ? desktopUrl : webUrl, { waitUntil: "networkidle" });
        if (desktop) {
          await page.locator("#display-name").fill("Алексей");
          await page.locator("#create-button").click();
          await page.waitForFunction(() => document.querySelector("#meeting")?.classList.contains("active"));
          await page.locator("#devices-control").click();
        } else await page.locator(".prejoin-devices-button").click();
        await page.locator("dialog[open]").waitFor();
        const select = desktop ? page.locator("#call-device-mic") : page.locator("dialog[open] select").nth(0);
        await (await deviceTrigger(page, select)).click();
        await auditPickerMenu(page, label);
        await page.screenshot({ path: path.join(outputDir, `${desktop ? "desktop" : "web"}-dialog-menu-fallback.png`) });
        await page.locator('.device-menu:visible [role=option][data-value="mic-2"]').click();
        await page.waitForFunction(() => JSON.parse(localStorage.getItem("saytosee:devices") || "{}").mic === "mic-2");
        assert.deepEqual(errors, [], `${label}: runtime exceptions`);
      } finally { await context.close(); }
    });
  }

  for (const desktop of [false, true].filter((desktop) => desktop ? only !== "web" : only !== "desktop")) {
    const label = `${desktop ? "desktop" : "web"} attached long output list flips above`;
    await runCase(label, async () => {
      const { context, page, errors } = await contextFor(browser, desktop ? [760, 562] : [1440, 900], desktop);
      try {
        await page.goto(desktop ? desktopUrl : webUrl, { waitUntil: "networkidle" });
        const select = desktop ? page.locator("#device-speaker") : page.locator(".prejoin-device-inline select").nth(2);
        await (await deviceTrigger(page, select)).click();
        const menu = await auditPickerMenu(page, label);
        assert.equal(menu.side, "top", `${label}: long list near bottom flips above while remaining joined`);
        await page.screenshot({ path: path.join(outputDir, `${desktop ? "desktop" : "web"}-attached-long-output-menu-above.png`) });
        await page.keyboard.press("Escape");
        assert.deepEqual(errors, [], `${label}: runtime exceptions`);
      } finally { await context.close(); }
    });
  }

  if (only !== "web") await runCase("desktop in-call switching and rollback", async () => {
    const { context, page, errors } = await contextFor(browser, [1000, 650], true);
    try {
      await page.goto(desktopUrl, { waitUntil: "networkidle" });
      await page.locator("#device-mic option[value='mic-1']").waitFor({ state: "attached" });
      await page.locator("#display-name").fill("Алексей");
      await page.locator("#create-button").click();
      await page.waitForFunction(() => document.querySelector("#meeting")?.classList.contains("active") && window.__qaRoom?.calls.some((call) => call[0] === "microphone"));
      assert.equal(await page.evaluate(() => window.__qaRoom.options.audioCaptureDefaults.deviceId.exact), "mic-1", "prejoin microphone used");
      const meetingLayout = await auditLayout(page, ["html", "body", "#meeting"], "#meeting button");
      verifyLayout(meetingLayout, "desktop meeting");
      await page.setViewportSize({ width: 760, height: 562 });
      const minimumLayout = await auditLayout(page, ["html", "body", "#meeting"], "#meeting button");
      verifyLayout(minimumLayout, "desktop meeting minimum 760x562");
      await page.screenshot({ path: path.join(outputDir, "desktop-meeting-760x562.png") });
      await page.locator("#audio-control").click();
      assert.equal(await page.evaluate(() => window.__qaRoom.localParticipant.isMicrophoneEnabled), false, "microphone muted");
      await page.locator("#devices-control").click();
      await page.locator("#devices-dialog[open]").waitFor();
      const dialogLayout = await auditLayout(page, ["html", "body", "#devices-dialog"], "#devices-dialog button:not(.device-menu-option)");
      verifyLayout(dialogLayout, "desktop meeting dialog");
      await page.screenshot({ path: path.join(outputDir, "desktop-meeting-devices.png") });
      await keyboardPicker(page, "#call-device-mic", "desktop-call-menu-760x562");
      await chooseDevice(page, "#call-device-mic", "mic-2");
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("saytosee:devices") || "{}").mic === "mic-2");
      assert.equal(await page.evaluate(() => window.__qaRoom.localParticipant.isMicrophoneEnabled), false, "muted microphone remains muted after switch");
      await chooseDevice(page, "#call-device-speaker", "speaker-2");
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("saytosee:devices") || "{}").speaker === "speaker-2");
      await chooseDevice(page, "#call-device-cam", "cam-2");
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("saytosee:devices") || "{}").cam === "cam-2");
      assert.equal(await page.evaluate(() => window.__qaRoom.localParticipant.isCameraEnabled), false, "disabled camera remains disabled after switch");
      await chooseDevice(page, "#call-device-mic", "mic-fail");
      await page.waitForFunction(() => document.querySelector("#devices-error")?.textContent?.includes("Не удалось"));
      assert.equal(await page.locator("#call-device-mic").inputValue(), "mic-2", "failed switch rolls UI back");
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("saytosee:devices") || "{}").mic), "mic-2", "failed switch keeps previous preference");
      assert.equal(await page.evaluate(() => window.__qaRoom.getActiveDevice("audioinput")), "mic-2", "failed switch restores SDK device");
      assert.equal(await page.evaluate(() => window.__qaRoom.localParticipant.isMicrophoneEnabled), false, "rollback preserves mute");
      const errorLayout = await auditLayout(page, ["html", "body", "#devices-dialog"], "#devices-dialog button:not(.device-menu-option)");
      verifyLayout(errorLayout, "desktop minimum meeting dialog with error");
      await page.keyboard.press("Escape");
      await page.locator("#devices-dialog[open]").waitFor({ state: "hidden" });
      assert.equal(await page.locator("#devices-control").evaluate((node) => node === document.activeElement), true, "desktop dialog returns focus");
      await page.evaluate(() => {
        window.__qaDevices = window.__qaDevices.filter((device) => device.deviceId !== "mic-2");
        navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
      });
      await page.waitForFunction(() => !JSON.parse(localStorage.getItem("saytosee:devices") || "{}").mic);
      assert.equal(await page.evaluate(() => window.__qaRoom.getActiveDevice("audioinput")), "default", "unplug falls back to system microphone");
      assert.equal(await page.evaluate(() => window.__qaRoom.localParticipant.isMicrophoneEnabled), false, "unplug keeps microphone muted");
      await page.locator("#devices-control").click();
      await chooseDevice(page, "#call-device-mic", "mic-1");
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("saytosee:devices") || "{}").mic === "mic-1");
      await page.keyboard.press("Escape");
      await page.locator("#audio-control").click();
      assert.equal(await page.evaluate(() => window.__qaRoom.localParticipant.isMicrophoneEnabled), true, "microphone re-enabled for unplug test");
      await page.evaluate(() => {
        window.__qaDevices = window.__qaDevices.filter((device) => device.kind !== "audioinput" && device.deviceId !== "speaker-2");
        navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
      });
      await page.waitForFunction(() => !JSON.parse(localStorage.getItem("saytosee:devices") || "{}").mic && !JSON.parse(localStorage.getItem("saytosee:devices") || "{}").speaker);
      assert.equal(await page.evaluate(() => window.__qaRoom.localParticipant.isMicrophoneEnabled), false, "no microphones disables capture");
      assert.equal(await page.locator("#audio-control").getAttribute("aria-pressed"), "false", "no microphones updates mute UI");
      assert.equal(await page.evaluate(() => window.__qaRoom.getActiveDevice("audiooutput")), "", "unplug output falls back to system device");
      await page.locator("#leave-control").click();
      await page.waitForFunction(() => document.querySelector("#lobby")?.classList.contains("active"));
      assert.equal(await page.locator("#device-mic").inputValue(), "", "lobby receives unplug fallback");
      assert.equal(await page.locator("#device-cam").inputValue(), "cam-2", "lobby receives in-call camera choice");
      assert.deepEqual(errors, [], "desktop call runtime exceptions");
      reports.push({ label: "desktop in-call switching", ...meetingLayout, minimum: minimumLayout, dialog: dialogLayout, error: errorLayout, calls: await page.evaluate(() => window.__qaRoom.calls) });
    } finally { await context.close(); }
  });
  }

  for (const desktop of [false, true].filter((desktop) => desktop ? only !== "web" : only !== "desktop")) {
    const label = `${desktop ? "desktop" : "web"} branded device snapshots`;
    await runCase(label, async () => {
      const { context, page, errors } = await contextFor(browser, desktop ? [1164, 720] : [1440, 900], desktop, true);
      try {
        await page.goto(desktop ? desktopUrl : webUrl, { waitUntil: "networkidle" });
        const lobbySelect = desktop ? page.locator("#device-mic") : page.locator(".prejoin-device-inline select").nth(0);
        await (await deviceTrigger(page, lobbySelect)).click();
        await auditPickerMenu(page, `${label}: lobby`);
        await page.screenshot({ path: path.join(outputDir, `${desktop ? "desktop" : "web"}-branded-lobby-menu.png`) });
        await page.keyboard.press("Escape");
        const cameraSelect = desktop ? page.locator("#device-cam") : page.locator(".prejoin-device-inline select").nth(1);
        await (await deviceTrigger(page, cameraSelect)).click();
        const cameraMenu = await auditPickerMenu(page, `${label}: attached camera dropdown`);
        assert.equal(cameraMenu.side, "bottom", `${label}: short camera list opens directly below its field`);
        await page.screenshot({ path: path.join(outputDir, `${desktop ? "desktop" : "web"}-attached-lobby-camera-menu.png`) });
        await page.keyboard.press("Escape");
        if (desktop) {
          await page.locator("#display-name").fill("Алексей");
          await page.locator("#create-button").click();
          await page.waitForFunction(() => document.querySelector("#meeting")?.classList.contains("active"));
          await page.locator("#devices-control").click();
        } else {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.locator(".prejoin-devices-button").click();
        }
        await page.locator("dialog[open]").waitFor();
        const alignment = await page.locator("dialog[open] .device-select").first().evaluate((field) => ({
          alignItems: getComputedStyle(field).alignItems,
          labelLeft: field.querySelector(":scope > span").getBoundingClientRect().left,
          controlLeft: field.querySelector("[data-device-trigger]").getBoundingClientRect().left,
        }));
        assert.equal(alignment.alignItems, "stretch", `${label}: shared field stretches children`);
        assert.ok(Math.abs(alignment.labelLeft - alignment.controlLeft) <= 1, `${label}: label aligns with control`);
        await page.screenshot({ path: path.join(outputDir, `${desktop ? "desktop" : "web"}-branded-device-dialog.png`) });
        const callSelect = desktop ? page.locator("#call-device-mic") : page.locator("dialog[open] select").nth(0);
        await (await deviceTrigger(page, callSelect)).click();
        await auditPickerMenu(page, `${label}: dialog`);
        await page.screenshot({ path: path.join(outputDir, `${desktop ? "desktop" : "web"}-branded-dialog-menu.png`) });
        assert.deepEqual(errors, [], `${label}: runtime exceptions`);
        reports.push({ label, alignment });
      } finally { await context.close(); }
    });
  }
} finally { await browser.close(); }

await writeFile(path.join(outputDir, snapshotsOnly ? "report-snapshots.json" : only ? `report-${only}.json` : "report.json"), JSON.stringify({ reports, failures }, null, 2));
console.log(`Reports: ${outputDir}; ${failures.length} failure(s)`);
if (failures.length) process.exitCode = 1;
