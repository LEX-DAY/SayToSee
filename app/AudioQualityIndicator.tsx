"use client";

import { useParticipants } from "@livekit/components-react";
import { RemoteAudioTrack } from "livekit-client";
import { useEffect, useRef, useState } from "react";

type AudioStats = {
  timestamp: number;
  packetsReceived: number;
  packetsLost: number;
  packetsDiscarded: number;
  concealedSamples: number;
  totalSamplesReceived: number;
  jitter: number;
};

type Quality = {
  state: "waiting" | "good" | "warning" | "bad";
  text: string;
  title: string;
};

const waiting: Quality = {
  state: "waiting",
  text: "Аудио: ждём собеседника",
  title: "Статистика появится после получения удалённого аудиотрека",
};

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export default function AudioQualityIndicator() {
  const participants = useParticipants();
  const previous = useRef(new Map<string, AudioStats>());
  const [quality, setQuality] = useState<Quality>(waiting);

  useEffect(() => {
    let active = true;

    async function measure() {
      const tracks = participants.flatMap((participant) =>
        [...participant.audioTrackPublications.values()]
          .map((publication) => publication.track)
          .filter((track): track is RemoteAudioTrack =>
            track instanceof RemoteAudioTrack,
          ),
      );

      if (tracks.length === 0) {
        previous.current.clear();
        if (active) setQuality(waiting);
        return;
      }

      let received = 0;
      let lost = 0;
      let discarded = 0;
      let concealed = 0;
      let samples = 0;
      let maxJitterMs = 0;
      let intervals = 0;

      await Promise.all(
        tracks.map(async (track) => {
          const report = await track.getRTCStatsReport();
          report?.forEach((raw) => {
            const stat = raw as RTCStats & Partial<AudioStats> & {
              kind?: string;
              mediaType?: string;
            };
            if (
              stat.type !== "inbound-rtp" ||
              (stat.kind !== "audio" && stat.mediaType !== "audio")
            ) {
              return;
            }

            const current: AudioStats = {
              timestamp: toNumber(stat.timestamp),
              packetsReceived: toNumber(stat.packetsReceived),
              packetsLost: toNumber(stat.packetsLost),
              packetsDiscarded: toNumber(stat.packetsDiscarded),
              concealedSamples: toNumber(stat.concealedSamples),
              totalSamplesReceived: toNumber(stat.totalSamplesReceived),
              jitter: toNumber(stat.jitter),
            };
            const key = `${track.sid}:${stat.id}`;
            const before = previous.current.get(key);
            previous.current.set(key, current);

            if (!before || current.timestamp <= before.timestamp) return;

            received += Math.max(
              0,
              current.packetsReceived - before.packetsReceived,
            );
            lost += Math.max(0, current.packetsLost - before.packetsLost);
            discarded += Math.max(
              0,
              current.packetsDiscarded - before.packetsDiscarded,
            );
            concealed += Math.max(
              0,
              current.concealedSamples - before.concealedSamples,
            );
            samples += Math.max(
              0,
              current.totalSamplesReceived - before.totalSamplesReceived,
            );
            maxJitterMs = Math.max(maxJitterMs, current.jitter * 1000);
            intervals += 1;
          });
        }),
      );

      if (!active || intervals === 0) return;

      const packetTotal = received + lost;
      const lossPercent = packetTotal > 0 ? (lost / packetTotal) * 100 : 0;
      const plcPercent = samples > 0 ? (concealed / samples) * 100 : 0;
      const state: Quality["state"] =
        plcPercent >= 1 || lossPercent >= 3 || maxJitterMs >= 80
          ? "bad"
          : plcPercent >= 0.1 ||
              lossPercent >= 1 ||
              discarded > 0 ||
              maxJitterMs >= 40
            ? "warning"
            : "good";

      setQuality({
        state,
        text: `PLC ${plcPercent.toFixed(1)}% · потери ${lossPercent.toFixed(1)}% · ${Math.round(maxJitterMs)} мс`,
        title: `Скрыто семплов: ${concealed}; потеряно пакетов: ${lost}; отброшено поздних пакетов: ${discarded}`,
      });
    }

    void measure();
    const interval = window.setInterval(() => void measure(), 2_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [participants]);

  return (
    <span
      className={`audio-quality audio-quality-${quality.state}`}
      title={quality.title}
    >
      <i aria-hidden="true" />
      {quality.text}
    </span>
  );
}
