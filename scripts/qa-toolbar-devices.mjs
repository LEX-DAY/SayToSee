import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

// Mount the installed React VideoConference and real, disconnected Room. No transport
// is connected and media capture is denied; SDK selection remains unmocked.
const require = createRequire(import.meta.url);
const { build } = require("../desktop/frontend/node_modules/esbuild");
const runtimeModules = process.env.CODEX_QA_NODE_MODULES ||
  "C:/Users/ange1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const { chromium } = require(path.join(runtimeModules, "playwright"));
const outputDir = path.resolve("work/qa-toolbar-devices");
await mkdir(outputDir, { recursive: true });

const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { VideoConference, RoomContext } from '@livekit/components-react';
import { Room } from 'livekit-client';
import '@livekit/components-styles';
import './app/globals.css';
const room = new Room();
room.localParticipant.permissions = { canPublish: true, canPublishData: true, canSubscribe: true, canPublishSources: [] };
window.__qaRoom = room;
createRoot(document.getElementById('root')).render(
  <RoomContext.Provider value={room}>
    <div className="meeting-shell" data-lk-theme="default">
      <div className="meeting-layout">
        <header className="meeting-header"><span className="meeting-brand">SayToSee</span></header>
        <div className="conference-wrap"><VideoConference /></div>
        <footer className="meeting-note">Защищённая встреча</footer>
      </div>
    </div>
  </RoomContext.Provider>
);
`;
const bundle = await build({
  stdin: { contents: fixture, loader: "tsx", sourcefile: "qa-toolbar.tsx", resolveDir: process.cwd() },
  bundle: true, write: false, outdir: outputDir, platform: "browser", format: "iife",
  jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).contents;
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css")).contents;
const server = createServer((request, response) => {
  if (request.url === "/app.js") { response.writeHead(200, { "Content-Type": "application/javascript" }); response.end(js); }
  else if (request.url === "/app.css") { response.writeHead(200, { "Content-Type": "text/css" }); response.end(css); }
  else { response.writeHead(200, { "Content-Type": "text/html" }); response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root" style="height:100%"></div><script src="/app.js"></script></body></html>'); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: process.env.QA_BROWSER_CHANNEL || "chrome" });
const reports = [];
try {
  for (const [width, height] of [[1280, 800], [760, 600], [390, 844], [320, 568], [390, 360], [844, 390]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript(() => {
      const events = new EventTarget();
      const devices = [
        { kind: "audioinput", deviceId: "default", groupId: "usb", label: "По умолчанию — Микрофон (3- USB Audio Device) (0d8c:0012)" },
        { kind: "audioinput", deviceId: "mic-2", groupId: "poly", label: "Оборудование — Динамик телефона с отменой эха (Poly Calisto 5300 Series) (047f:015b)" },
        { kind: "audioinput", deviceId: "mic-3", groupId: "poly", label: "Микрофон (3- USB Audio Device) (0d8c:0012)" },
        { kind: "videoinput", deviceId: "cam-1", groupId: "camera-1", label: "LEX DAY (Виртуальная камера Windows)" },
        { kind: "videoinput", deviceId: "cam-2", groupId: "camera-2", label: "Logitech HD Webcam C270" },
      ];
      window.__qaCaptureRequests = 0;
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
        enumerateDevices: async () => devices.map((device) => ({ ...device, toJSON: () => ({ ...device }) })),
        getUserMedia: async () => { window.__qaCaptureRequests++; throw new Error("QA: actual capture forbidden"); },
        getDisplayMedia: async () => { window.__qaCaptureRequests++; throw new Error("QA: actual capture forbidden"); },
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
      }});
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    const groups = page.locator(".lk-control-bar .lk-button-group");
    await groups.nth(0).locator(".lk-media-device-select li").nth(1).waitFor({ state: "attached" });
    for (const [index, deviceId] of [[0, "mic-2"], [1, "cam-2"]]) {
      const group = groups.nth(index);
      const trigger = group.locator(".lk-button-menu");
      await trigger.click();
      const menu = group.locator(".lk-device-menu");
      await menu.waitFor({ state: "visible" });
      await trigger.focus();
      await page.keyboard.press("Tab");
      assert.equal(await group.locator('.lk-media-device-select li > button').first().evaluate((button) => document.activeElement === button), true);
      assert.equal(await group.locator('.lk-media-device-select li > button').first().evaluate((button) => getComputedStyle(button).outlineWidth), "2px");
      const geometry = await group.evaluate((group) => {
        const rect = group.getBoundingClientRect();
        const menu = group.querySelector(".lk-device-menu");
        const list = menu.getBoundingClientRect();
        const activeButton = menu.querySelector('[data-lk-active="true"] > button');
        return {
          group: { left: rect.left, right: rect.right, top: rect.top, width: rect.width },
          menu: { left: list.left, right: list.right, top: list.top, bottom: list.bottom, width: list.width },
          shadow: getComputedStyle(menu).boxShadow,
          selectedColor: activeButton ? getComputedStyle(activeButton).backgroundColor : null,
          selectedMark: activeButton ? getComputedStyle(activeButton, "::after").content : null,
          rootOverflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
          controlBoundsValid: [...document.querySelectorAll('.lk-control-bar > button, .lk-control-bar .lk-button-group > button, .lk-control-bar .lk-button-group-menu > button')].filter((button) => getComputedStyle(button).visibility !== 'hidden' && button.getBoundingClientRect().width > 0).every((button) => {
            const bounds = button.getBoundingClientRect();
            return bounds.width > 0 && bounds.height > 0 && bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight;
          }),
        };
      });
      await page.screenshot({ path: path.join(outputDir, `${width}x${height}-${index === 0 ? "microphone" : "camera"}.png`) });
      assert(Math.abs(geometry.menu.left - geometry.group.left) < 1.1, `left edge mismatch ${width}/${index}`);
      assert(Math.abs(geometry.menu.right - geometry.group.right) < 1.1, `right edge mismatch ${width}/${index}`);
      assert(Math.abs(geometry.menu.bottom - geometry.group.top) < 1.1, `detached seam ${width}/${index}`);
      assert(geometry.menu.top >= 0, `menu outside screen ${width}/${index}`);
      assert(geometry.menu.left >= 0 && geometry.menu.right <= width, `horizontal overflow ${width}/${index}`);
      assert.equal(geometry.shadow, "none");
      assert.equal(geometry.rootOverflow, false);
      assert.equal(geometry.controlBoundsValid, true, `toolbar outside viewport ${width}x${height}/${index}`);
      if (width <= 760) assert(geometry.group.width >= 110, `unreadably narrow menu ${width}/${index}`);
      if (index === 0) {
        assert.equal(geometry.selectedColor, "rgb(216, 240, 228)");
        assert.equal(geometry.selectedMark, '\"\"');
      }
      await group.locator(`li[id="${deviceId}"] > button`).click();
      await page.waitForFunction(({ kind, deviceId }) => window.__qaRoom.getActiveDevice(kind) === deviceId,
        { kind: index === 0 ? "audioinput" : "videoinput", deviceId });
      await trigger.waitFor({ state: "visible" });
      assert.equal(await trigger.getAttribute("aria-pressed"), "false");
      assert.equal(await page.evaluate(() => window.__qaRoom.localParticipant.isMicrophoneEnabled), false);
      assert.equal(await page.evaluate(() => window.__qaRoom.localParticipant.isCameraEnabled), false);
      await trigger.click();
      await page.locator('.meeting-brand').click({ position: { x: 5, y: 5 } });
      assert.equal(await trigger.getAttribute("aria-pressed"), "false");
      reports.push({ viewport: [width, height], kind: index === 0 ? "microphone" : "camera", ...geometry });
    }
    assert.equal(await page.evaluate(() => window.__qaCaptureRequests), 0);
    assert.deepEqual(errors, []);
    await context.close();
  }
  await writeFile(path.join(outputDir, "report.json"), JSON.stringify(reports, null, 2));
  console.log(`PASS: ${reports.length} real LiveKit VideoConference cases: joined edges, readable widths, viewport/control containment, green selection, SDK switch, muted tracks preserved, no capture.`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
