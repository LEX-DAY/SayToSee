"use client";

import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoConference,
  useParticipants,
  useRoomContext,
} from "@livekit/components-react";
import { Check, Copy, Users } from "lucide-react";
import Image from "next/image";
import { AudioPresets, RoomEvent, VideoPresets } from "livekit-client";
import { useEffect, useMemo, useState } from "react";
import AudioQualityIndicator from "./AudioQualityIndicator";
import type { MeetingSession } from "./CallApp";

function roomLabel(room: string) {
  return (
    room
      .replace(/^ctc-/, "")
      .toUpperCase()
      .match(/.{1,4}/g)
      ?.join("-") ?? ""
  );
}

export default function MeetingRoom({
  session,
  onLeave,
}: {
  session: MeetingSession;
  onLeave: () => void;
}) {
  return (
    <div className="meeting-shell" data-lk-theme="default">
      <LiveKitRoom
        token={session.token}
        serverUrl={session.serverUrl}
        connect
        audio={session.audioEnabled}
        video={session.videoEnabled}
        onDisconnected={onLeave}
        options={{
          adaptiveStream: true,
          dynacast: true,
          audioCaptureDefaults: {
            autoGainControl: false,
            channelCount: { ideal: 1 },
            echoCancellation: true,
            noiseSuppression: true,
          },
          videoCaptureDefaults: {
            resolution: VideoPresets.h540.resolution,
          },
          publishDefaults: {
            audioPreset: AudioPresets.music,
            dtx: false,
            forceStereo: false,
            red: true,
            simulcast: true,
            videoCodec: "vp8",
            videoEncoding: VideoPresets.h540.encoding,
            videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
          },
        }}
      >
        <MeetingChrome session={session} onLeave={onLeave} />
        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  );
}

function MeetingChrome({
  session,
  onLeave,
}: {
  session: MeetingSession;
  onLeave: () => void;
}) {
  const participants = useParticipants();
  const room = useRoomContext();
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const interval = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(interval);
  }, []);

  const time = useMemo(() => {
    const minutes = Math.floor(elapsed / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (elapsed % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, [elapsed]);

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(session.inviteUrl);
    } catch {
      const input = document.createElement("textarea");
      input.value = session.inviteUrl;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  useEffect(() => {
    const handleDisconnect = () => onLeave();
    room.on(RoomEvent.Disconnected, handleDisconnect);
    return () => {
      room.off(RoomEvent.Disconnected, handleDisconnect);
    };
  }, [onLeave, room]);

  return (
    <div className="meeting-layout">
      <header className="meeting-header">
        <div className="meeting-brand">
          <Image className="brand-mark mini" src="/saytosee-mark.png" alt="" width={30} height={25} />
          <span>SayToSee</span>
        </div>
        <div className="meeting-meta">
          <span className="live-pill">
            <i />
            {time}
          </span>
          <span className="meeting-code">
            Встреча {roomLabel(session.room)}
          </span>
        </div>
        <div className="header-actions">
          <span className="participant-count">
            <Users size={16} />
            {participants.length}/10
          </span>
          <button
            className="copy-button"
            onClick={() => void copyInvite()}
            title={session.inviteUrl}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "Скопировано" : "Копировать ссылку"}
          </button>
        </div>
      </header>

      <div className="conference-wrap">
        <VideoConference />
      </div>

      <div className="meeting-note">
        <AudioQualityIndicator />
        <span className="meeting-role">
          {session.isHost
            ? "Вы организатор · адаптивный WebRTC через SFU"
            : "Защищённое WebRTC-соединение установлено"}
        </span>
      </div>
    </div>
  );
}
