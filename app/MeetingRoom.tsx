"use client";

import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoConference,
  useParticipants,
  useRoomContext,
} from "@livekit/components-react";
import { Check, Copy, Users } from "lucide-react";
import { RoomEvent } from "livekit-client";
import { useEffect, useMemo, useState } from "react";
import type { MeetingSession } from "./CallApp";

function roomLabel(room: string) {
  return room.replace(/^ctc-/, "").toUpperCase();
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
          videoCaptureDefaults: {
            resolution: { width: 1280, height: 720, frameRate: 24 },
          },
          publishDefaults: {
            simulcast: true,
            videoCodec: "vp8",
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
    await navigator.clipboard.writeText(session.inviteUrl);
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
          <span className="brand-mark mini">
            <span />
            <span />
          </span>
          <span>CalltoCall</span>
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
          <button className="copy-button" onClick={() => void copyInvite()}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "Скопировано" : "Пригласить"}
          </button>
        </div>
      </header>

      <div className="conference-wrap">
        <VideoConference />
      </div>

      <div className="meeting-note">
        <span className="status-dot" />
        {session.isHost
          ? "Вы организатор · нагрузка распределена через SFU"
          : "Защищённое соединение установлено"}
      </div>
    </div>
  );
}
