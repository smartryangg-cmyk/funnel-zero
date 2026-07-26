const encoder = new TextEncoder();
// Cloudflare Workers currently caps Web Crypto PBKDF2 at 100,000 iterations.
const PASSWORD_ITERATIONS = 100_000;

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function randomId(): string {
  return crypto.randomUUID();
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toHex(new Uint8Array(digest));
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toBase64Url(new Uint8Array(digest));
}

export async function sealSecret(value: string, secret: string): Promise<string> {
  const key = await encryptionKey(secret);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(value)
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function openSecret(value: string, secret: string): Promise<string> {
  const [version, ivValue, ciphertextValue] = value.split(".");
  if (version !== "v1" || !ivValue || !ciphertextValue) {
    throw new Error("Segredo protegido inválido.");
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(ivValue) },
    await encryptionKey(secret),
    fromBase64Url(ciphertextValue)
  );
  return new TextDecoder().decode(plaintext);
}

export async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return toHex(new Uint8Array(signature));
}

export async function hashPassword(password: string): Promise<{
  hash: string;
  salt: string;
  iterations: number;
}> {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const bits = await derivePassword(password, saltBytes, PASSWORD_ITERATIONS);
  return {
    hash: toHex(bits),
    salt: toBase64Url(saltBytes),
    iterations: PASSWORD_ITERATIONS
  };
}

export async function verifyPassword(
  password: string,
  salt: string,
  iterations: number,
  expectedHash: string
): Promise<boolean> {
  const derived = await derivePassword(password, fromBase64Url(salt), iterations);
  const expected = fromHex(expectedHash);
  const derivedDigest = await crypto.subtle.digest("SHA-256", derived);
  const expectedDigest = await crypto.subtle.digest("SHA-256", expected);
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
  };
  return subtle.timingSafeEqual(derivedDigest, expectedDigest);
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits"
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt"
  ]);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return new Uint8Array();
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "="
  );
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
