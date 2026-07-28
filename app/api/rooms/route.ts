import { NextResponse } from "next/server";
import {
  getLiveKitConfig,
  liveKitHttpUrl,
  signLiveKitToken,
  signRoomCredential,
} from "../../../lib/livekit-auth";

function createRoomName() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  const code = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join(
    "",
  );
  return `ctc-${code}`;
}

export async function POST(request: Request) {
  try {
    const { serverUrl, apiKey, apiSecret } = getLiveKitConfig();
    const room = createRoomName();
    const serviceToken = await signLiveKitToken({
      apiKey,
      apiSecret,
      identity: `calltocall-service-${crypto.randomUUID()}`,
      grant: { roomCreate: true },
      ttl: "2m",
    });

    const createResponse = await fetch(
      `${liveKitHttpUrl(serverUrl)}/twirp/livekit.RoomService/CreateRoom`,
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
      const details = await createResponse.text();
      console.error("LiveKit CreateRoom failed", createResponse.status, details);
      return NextResponse.json(
        { error: "Медиасервер не смог создать комнату. Попробуйте ещё раз." },
        { status: 502 },
      );
    }

    const [invite, hostCredential] = await Promise.all([
      signRoomCredential({ room, role: "invite", apiSecret }),
      signRoomCredential({ room, role: "host", apiSecret }),
    ]);
    const origin = new URL(request.url).origin;
    const inviteUrl = `${origin}/?room=${encodeURIComponent(room)}&invite=${encodeURIComponent(invite)}`;

    return NextResponse.json({
      room,
      invite,
      inviteUrl,
      hostCredential,
    });
  } catch (reason) {
    const message =
      reason instanceof Error ? reason.message : "Не удалось создать встречу";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
