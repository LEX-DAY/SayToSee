import { NextResponse } from "next/server";
import {
  getLiveKitConfig,
  signLiveKitToken,
  verifyRoomCredential,
} from "../../../lib/livekit-auth";

type TokenRequest = {
  room?: string;
  name?: string;
  invite?: string;
  hostCredential?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TokenRequest;
    const room = body.room?.trim() ?? "";
    const name = body.name?.trim().slice(0, 40) ?? "";
    if (!/^ctc-[a-z0-9]{9}$/.test(room) || !name) {
      return NextResponse.json(
        { error: "Проверьте имя и ссылку на встречу." },
        { status: 400 },
      );
    }

    const { serverUrl, apiKey, apiSecret } = getLiveKitConfig();
    const inviteValid = await verifyRoomCredential({
      token: body.invite,
      room,
      role: "invite",
      apiSecret,
    });
    if (!inviteValid) {
      return NextResponse.json(
        { error: "Ссылка недействительна или срок её действия истёк." },
        { status: 403 },
      );
    }

    const isHost = await verifyRoomCredential({
      token: body.hostCredential,
      room,
      role: "host",
      apiSecret,
    });
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

    return NextResponse.json({ token, serverUrl, isHost });
  } catch (reason) {
    const message =
      reason instanceof Error ? reason.message : "Не удалось войти во встречу";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
