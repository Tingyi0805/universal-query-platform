import crypto from "node:crypto";
import { env } from "../config/env.js";

const VERSION = "v1";

function getKey(): Buffer {
  if (!env.DATASOURCE_ENCRYPTION_KEY) {
    throw new Error("DATASOURCE_ENCRYPTION_NOT_CONFIGURED");
  }

  const key = Buffer.from(env.DATASOURCE_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error("DATASOURCE_ENCRYPTION_KEY_INVALID");
  }
  return key;
}

export function encryptSecret(plainText: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const cipherText = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    cipherText.toString("base64"),
  ].join(".");
}

export function decryptSecret(payload: string): string {
  const key = getKey();
  const [version, ivB64, tagB64, cipherB64] = payload.split(".");
  if (version !== VERSION || !ivB64 || !tagB64 || !cipherB64) {
    throw new Error("DATASOURCE_SECRET_INVALID");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(cipherB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
