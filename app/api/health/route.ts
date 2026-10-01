import { NextResponse } from "next/server";
import { getLiveKitConfig, signLiveKitToken } from "../../../lib/livekit-auth";

export const dynamic = "force-dynamic";

/**
 * Лёгкая проверка доступности LiveKit SFU для индикатора на лендинге:
 * подписанный service-токен на один вызов ListRooms с таймаутом 4 c.
 */
export async function GET() {
  try {
    const { httpUrl, apiKey, apiSecret } = getLiveKitConfig();
    const serviceToken = await signLiveKitToken({
      apiKey,
      apiSecret,
      identity: `saytosee-health-${crypto.randomUUID()}`,
      grant: { roomList: true },
      ttl: "1m",
    });
    const response = await fetch(
      `${httpUrl}/twirp/livekit.RoomService/ListRooms`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${serviceToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!response.ok) {
      return NextResponse.json(
        { ok: false, error: "livekit-unreachable" },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: "livekit-unreachable" },
      { status: 503 },
    );
  }
}
