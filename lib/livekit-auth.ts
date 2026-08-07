import { SignJWT } from "jose";

type VideoGrant = {
  room?: string;
  roomCreate?: boolean;
  roomJoin?: boolean;
  roomAdmin?: boolean;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
};

function secretKey(secret: string) {
  return new TextEncoder().encode(secret);
}

export function getLiveKitConfig() {
  const serverUrl = process.env.LIVEKIT_URL?.trim();
  const internalUrl = process.env.LIVEKIT_INTERNAL_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();

  if (!serverUrl || !apiKey || !apiSecret) {
    throw new Error(
      "WebRTC-сервер не настроен. Укажите LIVEKIT_URL, LIVEKIT_API_KEY и LIVEKIT_API_SECRET.",
    );
  }

  if (!/^wss?:\/\//.test(serverUrl)) {
    throw new Error("LIVEKIT_URL должен начинаться с ws:// или wss://");
  }

  return {
    serverUrl,
    apiKey,
    apiSecret,
    httpUrl: internalUrl || liveKitHttpUrl(serverUrl),
  };
}

export async function signLiveKitToken({
  apiKey,
  apiSecret,
  identity,
  name,
  grant,
  role,
  ttl = "2h",
}: {
  apiKey: string;
  apiSecret: string;
  identity: string;
  name?: string;
  grant: VideoGrant;
  role?: "host" | "guest";
  ttl?: string;
}) {
  return new SignJWT({
    name,
    video: grant,
    metadata: role ? JSON.stringify({ role }) : undefined,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(apiKey)
    .setSubject(identity)
    .setIssuedAt()
    .setNotBefore("0s")
    .setExpirationTime(ttl)
    .sign(secretKey(apiSecret));
}

export function liveKitHttpUrl(serverUrl: string) {
  return serverUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}
