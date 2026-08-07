import { NextResponse } from "next/server";
import {
  getLiveKitConfig,
  signLiveKitToken,
} from "../../../lib/livekit-auth";
import {
  createMeetingKey,
  getMeetingAuthSecret,
  meetingRoomFromKey,
  signRoomCredential,
} from "../../../lib/media-auth";

export async function POST() {
  try {
    const authSecret = getMeetingAuthSecret();
    const { httpUrl, apiKey, apiSecret } = getLiveKitConfig();
    const meetingKey = await createMeetingKey(authSecret);
    const room = meetingRoomFromKey(meetingKey);
    const serviceToken = await signLiveKitToken({
      apiKey,
      apiSecret,
      identity: `saytosee-service-${crypto.randomUUID()}`,
      grant: { roomCreate: true },
      ttl: "2m",
    });

    const createResponse = await fetch(
      `${httpUrl}/twirp/livekit.RoomService/CreateRoom`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${serviceToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: room,
          emptyTimeout: 300,
          departureTimeout: 20,
          maxParticipants: 10,
        }),
      },
    );

    if (!createResponse.ok) {
      console.error(
        "LiveKit CreateRoom failed",
        createResponse.status,
        await createResponse.text(),
      );
      return NextResponse.json(
        { error: "WebRTC-сервер не смог создать комнату. Попробуйте ещё раз." },
        { status: 502 },
      );
    }

    const hostCredential = await signRoomCredential({
      room,
      role: "host",
      apiSecret: authSecret,
    });
    const publicOrigin =
      process.env.APP_PUBLIC_URL?.trim() || "https://89.169.153.186";
    const inviteUrl = new URL("/", publicOrigin);
    inviteUrl.searchParams.set("key", meetingKey);

    return NextResponse.json({
      room,
      key: meetingKey,
      inviteUrl: inviteUrl.toString(),
      hostCredential,
    });
  } catch (reason) {
    const message =
      reason instanceof Error ? reason.message : "Не удалось создать встречу";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
