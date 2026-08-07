import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("uses LiveKit WebRTC with a single UDP mux port and TCP fallback", async () => {
  const [packageJson, compose, nextConfig] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("docker-compose.yml", root), "utf8"),
    readFile(new URL("next.config.ts", root), "utf8"),
  ]);

  assert.match(packageJson, /@livekit\/components-react/);
  assert.match(packageJson, /livekit-client/);
  assert.match(nextConfig, /output:\s*"standalone"/);
  assert.match(compose, /livekit\/livekit-server:v1\.13\.1/);
  assert.match(compose, /udp_port:\s*7882/);
  assert.match(compose, /tcp_port:\s*7881/);
  assert.match(compose, /congestion_control:/);
  assert.match(compose, /allow_tcp_fallback:\s*true/);
  assert.match(compose, /active_red_encoding:\s*true/);
  assert.match(compose, /"7882:7882\/udp"/);
  assert.match(compose, /"7881:7881\/tcp"/);
  assert.doesNotMatch(compose, /^\s{2}relay:/m);
});

test("proxies secure LiveKit signaling and APIs through the app origin", async () => {
  const [caddy, vmCompose] = await Promise.all([
    readFile(new URL("infra/Caddyfile.vm", root), "utf8"),
    readFile(new URL("docker-compose.vm.yml", root), "utf8"),
  ]);

  assert.match(caddy, /@livekit path \/rtc \/rtc\/\* \/twirp\/\*/);
  assert.match(caddy, /reverse_proxy @livekit 127\.0\.0\.1:7880/);
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:3000/);
  assert.match(vmCompose, /- livekit/);
  assert.match(vmCompose, /network_mode:\s*host/);
  assert.match(vmCompose, /ports:\s*!override \[\]/);
});

test("enables adaptive WebRTC and copies a key-based invitation link", async () => {
  const [callApp, meetingRoom] = await Promise.all([
    readFile(new URL("app/CallApp.tsx", root), "utf8"),
    readFile(new URL("app/MeetingRoom.tsx", root), "utf8"),
  ]);

  assert.match(callApp, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(callApp, /searchParams\.set\("key", data\.key\)/);
  assert.match(callApp, /inviteUrl: inviteUrl\.toString\(\)/);
  assert.match(meetingRoom, /<LiveKitRoom/);
  assert.match(meetingRoom, /adaptiveStream:\s*true/);
  assert.match(meetingRoom, /dynacast:\s*true/);
  assert.match(meetingRoom, /simulcast:\s*true/);
  assert.match(meetingRoom, /audioPreset:\s*AudioPresets\.music/);
  assert.match(meetingRoom, /dtx:\s*false/);
  assert.match(meetingRoom, /autoGainControl:\s*false/);
  assert.match(meetingRoom, /red:\s*true/);
  assert.match(meetingRoom, /videoEncoding:\s*VideoPresets\.h540\.encoding/);
  const qualityIndicator = await readFile(
    new URL("app/AudioQualityIndicator.tsx", root),
    "utf8",
  );
  assert.match(qualityIndicator, /concealedSamples/);
  assert.match(qualityIndicator, /packetsLost/);
  assert.match(qualityIndicator, /PLC/);
  assert.match(
    meetingRoom,
    /navigator\.clipboard\.writeText\(session\.inviteUrl\)/,
  );
  assert.match(meetingRoom, /Копировать ссылку/);
});

test("creates capped LiveKit rooms and issues WebRTC tokens for signed keys", async () => {
  const [roomsRoute, tokenRoute, meetingAuth, liveKitAuth] =
    await Promise.all([
      readFile(new URL("app/api/rooms/route.ts", root), "utf8"),
      readFile(new URL("app/api/token/route.ts", root), "utf8"),
      readFile(new URL("lib/media-auth.ts", root), "utf8"),
      readFile(new URL("lib/livekit-auth.ts", root), "utf8"),
    ]);

  assert.match(roomsRoute, /RoomService\/CreateRoom/);
  assert.match(roomsRoute, /maxParticipants:\s*10/);
  assert.match(roomsRoute, /process\.env\.APP_PUBLIC_URL/);
  assert.match(roomsRoute, /https:\/\/89\.169\.153\.186/);
  assert.match(roomsRoute, /inviteUrl\.searchParams\.set\("key", meetingKey\)/);
  assert.match(tokenRoute, /verifyMeetingKey/);
  assert.match(tokenRoute, /signLiveKitToken/);
  assert.match(tokenRoute, /roomJoin:\s*true/);
  assert.match(meetingAuth, /MEETING_KEY_TTL_MINUTES\s*=\s*24\s*\*\s*60/);
  assert.match(liveKitAuth, /LIVEKIT_INTERNAL_URL/);
});
