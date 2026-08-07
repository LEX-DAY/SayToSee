import { NextResponse } from "next/server";
import {
  getLiveKitConfig,
  signLiveKitToken,
} from "../../../lib/livekit-auth";
import {
  formatMeetingKey,
  getMeetingAuthSecret,
  meetingRoomFromKey,
  verifyMeetingKey,
  verifyRoomCredential,
} from "../../../lib/media-auth";

type TokenRequest = {
  key?: string;
  name?: string;
  hostCredential?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TokenRequest;
    const meetingKey = body.key?.trim() ?? "";
    const name = body.name?.trim().slice(0, 40) ?? "";
    if (!name) {
      return NextResponse.json(
        { error: "Введите имя, которое увидят участники." },
        { status: 400 },
      );
    }

    const authSecret = getMeetingAuthSecret();
    if (!(await verifyMeetingKey(meetingKey, authSecret))) {
      return NextResponse.json(
        { error: "Ключ встречи недействителен или срок его действия истёк." },
        { status: 403 },
      );
    }

    const room = meetingRoomFromKey(meetingKey);
    const isHost = await verifyRoomCredential({
      token: body.hostCredential,
      room,
      role: "host",
      apiSecret: authSecret,
    });
    const { serverUrl, apiKey, apiSecret } = getLiveKitConfig();
    const token = await signLiveKitToken({
      apiKey,
      apiSecret,
      identity: `${isHost ? "host" : "guest"}-${crypto.randomUUID()}`,
      name,
      role: isHost ? "host" : "guest",
      grant: {
        room,
        roomJoin: true,
        roomAdmin: isHost,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      },
    });

    return NextResponse.json({
      token,
      serverUrl,
      isHost,
      room,
      key: formatMeetingKey(meetingKey),
    });
  } catch (reason) {
    const message =
      reason instanceof Error ? reason.message : "Не удалось войти во встречу";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
