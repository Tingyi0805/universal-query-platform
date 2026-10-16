import assert from "node:assert/strict";
import test from "node:test";
import pino from "pino";
import { loggerOptions } from "./logger.js";
test("device headers, PIN and one-time credentials never appear in structured logs", () => {
  let output = "";
  const logger = pino({ ...loggerOptions, level: "info" }, { write(chunk: string) { output += chunk; } });
  logger.info({ req: { headers: { "x-dashboard-device-token": "synthetic-device-token", "x-workstation-credential": "synthetic-workstation-secret", authorization: "synthetic-bearer" } },
    pinHash:"synthetic-pin-hash", passwordHash:"synthetic-password-hash", secretHash:"synthetic-secret-hash", tokenHash:"synthetic-token-hash", pin: "synthetic-pin", token: "synthetic-returned-token", secret: "synthetic-issued-secret", password: "synthetic-password" });
  for (const value of ["synthetic-pin-hash","synthetic-password-hash","synthetic-secret-hash","synthetic-token-hash","synthetic-device-token", "synthetic-workstation-secret", "synthetic-bearer", "synthetic-pin", "synthetic-returned-token", "synthetic-issued-secret", "synthetic-password"]) {
    assert.equal(output.includes(value), false);
  }
  assert.match(output, /REDACTED/);
});
