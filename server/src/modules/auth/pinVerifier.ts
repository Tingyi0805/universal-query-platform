import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export type PinPepper = { id: string; key: Buffer };
const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const prefix = "$uqp-scrypt$1$";
let active = 0;

/** Read external configuration only; never generate or persist a production pepper. */
export function parsePinPepper(id?: string, encoded?: string): PinPepper {
  if (!id || !/^[a-zA-Z0-9_-]{1,32}$/.test(id) || !encoded ||
      !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error("PIN_PEPPER_NOT_CONFIGURED");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) throw new Error("PIN_PEPPER_NOT_CONFIGURED");
  return { id, key };
}

function validPepper(pepper: PinPepper) {
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(pepper.id) || pepper.key.length !== 32)
    throw new Error("PIN_PEPPER_NOT_CONFIGURED");
}

async function derive(pin: string, salt: Buffer, pepper: PinPepper): Promise<Buffer> {
  // Bound memory consumption before submitting work to the libuv pool.
  if (active >= 2) throw new Error("PIN_VERIFIER_BUSY");
  active++;
  const input = createHmac("sha256", pepper.key).update("uqp:pin:v1\0").update(pin, "utf8").digest();
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(input, salt, 32, parameters, (error, key) => error ? reject(new Error("PIN_VERIFIER_FAILED")) : resolve(key));
    });
  } finally {
    input.fill(0);
    active--;
  }
}

export async function hashPin(pin: string, pepper: PinPepper): Promise<string> {
  validPepper(pepper);
  if (!/^\d{4,12}$/.test(pin)) throw new Error("PIN_FORMAT_INVALID");
  const salt = randomBytes(16);
  const key = await derive(pin, salt, pepper);
  try {
    return `${prefix}${pepper.id}$32768$8$3$${salt.toString("base64url")}$${key.toString("base64url")}`;
  } finally { key.fill(0); }
}

/** Only this fixed format is accepted: database values cannot raise KDF cost. */
export async function verifyPin(pin: string, encoded: string, pepper: PinPepper): Promise<boolean> {
  validPepper(pepper);
  if (!/^\d{4,12}$/.test(pin) || encoded.length > 200) return false;
  const match = /^\$uqp-scrypt\$1\$([a-zA-Z0-9_-]{1,32})\$32768\$8\$3\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/.exec(encoded);
  if (!match || match[1] !== pepper.id) return false;
  const salt = Buffer.from(match[2]!, "base64url"), expected = Buffer.from(match[3]!, "base64url");
  if (salt.toString("base64url") !== match[2] || expected.toString("base64url") !== match[3]) return false;
  const actual = await derive(pin, salt, pepper);
  try { return timingSafeEqual(actual, expected); }
  finally { actual.fill(0); expected.fill(0); }
}

export function isScryptPinHash(value: string): boolean { return value.startsWith(prefix); }
