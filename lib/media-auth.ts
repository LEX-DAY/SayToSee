import { jwtVerify, SignJWT } from "jose";

const MEETING_KEY_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const MEETING_KEY_TTL_MINUTES = 24 * 60;
const MEETING_KEY_TIME_MODULUS = 1 << 20;

function secretKey(secret: string) {
  return new TextEncoder().encode(secret);
}

function encodeBase32(value: number, length: number) {
  let encoded = "";
  for (let index = 0; index < length; index += 1) {
    encoded = MEETING_KEY_ALPHABET[value % 32] + encoded;
    value = Math.floor(value / 32);
  }
  return encoded;
}

function decodeBase32(value: string) {
  let decoded = 0;
  for (const character of value) {
    const digit = MEETING_KEY_ALPHABET.indexOf(character);
    if (digit < 0) return null;
    decoded = decoded * 32 + digit;
  }
  return decoded;
}

async function signMeetingKeyPayload(payload: string, apiSecret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    secretKey(apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  );
  return (
    signature[0] * 2 ** 32 +
    signature[1] * 2 ** 24 +
    signature[2] * 2 ** 16 +
    signature[3] * 2 ** 8 +
    signature[4]
  );
}

export function normalizeMeetingKey(key: string) {
  return key
    .trim()
    .toLowerCase()
    .replaceAll("o", "0")
    .replace(/[il]/g, "1")
    .replace(/[\s-]/g, "");
}

export function formatMeetingKey(key: string) {
  const normalized = normalizeMeetingKey(key).toUpperCase();
  return normalized.match(/.{1,4}/g)?.join("-") ?? "";
}

export function meetingRoomFromKey(key: string) {
  return `ctc-${normalizeMeetingKey(key)}`;
}

export async function createMeetingKey(apiSecret: string) {
  const issuedAt =
    Math.floor(Date.now() / 60_000) % MEETING_KEY_TIME_MODULUS;
  const random = crypto.getRandomValues(new Uint32Array(1))[0] & 0xfffff;
  const payloadValue = issuedAt * MEETING_KEY_TIME_MODULUS + random;
  const payload = encodeBase32(payloadValue, 8);
  const signature = await signMeetingKeyPayload(payload, apiSecret);
  return formatMeetingKey(payload + encodeBase32(signature, 8));
}

export async function verifyMeetingKey(key: string, apiSecret: string) {
  const normalized = normalizeMeetingKey(key);
  if (normalized.length !== 16) return false;

  const payload = normalized.slice(0, 8);
  const payloadValue = decodeBase32(payload);
  const suppliedSignature = decodeBase32(normalized.slice(8, 16));
  if (payloadValue === null || suppliedSignature === null) return false;

  const issuedAt = Math.floor(payloadValue / MEETING_KEY_TIME_MODULUS);
  const now = Math.floor(Date.now() / 60_000) % MEETING_KEY_TIME_MODULUS;
  const age =
    (now - issuedAt + MEETING_KEY_TIME_MODULUS) %
    MEETING_KEY_TIME_MODULUS;
  if (age > MEETING_KEY_TTL_MINUTES) return false;

  const expectedSignature = await signMeetingKeyPayload(payload, apiSecret);
  return suppliedSignature === expectedSignature;
}

export function getMeetingAuthSecret() {
  const authSecret = process.env.MEDIA_AUTH_SECRET?.trim();

  if (!authSecret) {
    throw new Error(
      "Секрет подписания встреч не настроен. Укажите MEDIA_AUTH_SECRET.",
    );
  }

  return authSecret;
}

export async function signRoomCredential({
  room,
  role,
  apiSecret,
}: {
  room: string;
  role: "host";
  apiSecret: string;
}) {
  return new SignJWT({ room, role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("saytosee")
    .setAudience("saytosee-room")
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
  role: "host";
  apiSecret: string;
}) {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secretKey(apiSecret), {
      issuer: "saytosee",
      audience: "saytosee-room",
    });
    return payload.room === room && payload.role === role;
  } catch {
    return false;
  }
}
