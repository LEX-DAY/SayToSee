import { jwtVerify, SignJWT } from "jose";

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
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();

  if (!serverUrl || !apiKey || !apiSecret) {
    throw new Error(
      "Сервис видеосвязи ещё не настроен. Добавьте LIVEKIT_URL, LIVEKIT_API_KEY и LIVEKIT_API_SECRET.",
    );
  }

  if (!/^wss?:\/\//.test(serverUrl)) {
    throw new Error("LIVEKIT_URL должен начинаться с wss://");
  }

  return { serverUrl, apiKey, apiSecret };
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

export async function signRoomCredential({
  room,
  role,
  apiSecret,
}: {
  room: string;
  role: "invite" | "host";
  apiSecret: string;
}) {
  return new SignJWT({ room, role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("calltocall")
    .setAudience("calltocall-room")
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secretKey(apiSecret));
}

export async function verifyRoomCredential({
  token,
  room,
  role,
  apiSecret,
}: {
  token?: string;
  room: string;
  role: "invite" | "host";
  apiSecret: string;
}) {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secretKey(apiSecret), {
      issuer: "calltocall",
      audience: "calltocall-room",
    });
    return payload.room === room && payload.role === role;
  } catch {
    return false;
  }
}

export function liveKitHttpUrl(serverUrl: string) {
  return serverUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}
