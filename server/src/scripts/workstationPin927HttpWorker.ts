// D1-only subprocess: an independent Node process with its own SQL connection pool.
// The test server binds 127.0.0.1 and emulates the trusted HTTPS boundary for
// route validation; it is NOT a production HTTPS/TLS acceptance test.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import sql from "mssql";
import { createWorkstationPinState } from "../modules/auth/workstationPinState.repository.js";
import { createWorkstationSessions } from "../modules/auth/workstationSession.repository.js";
import { createWorkstationPinService } from "../modules/auth/workstationPin.service.js";
import { createWorkstationPinRouter } from "../modules/auth/workstationPin.routes.js";
import { verifyPin, type PinPepper } from "../modules/auth/pinVerifier.js";

async function main() {
  const machine = process.env.UQP_D1_CONTAINER_NAME;
  const dbName = process.env.UQP_D1_PIN927_HTTP_DB;
  if (process.env.UQP_D1_SCOPE !== "DISPOSABLE_ONLY" ||
      !/^uqp-d1-[a-f0-9]{12}$/.test(machine ?? "") ||
      !/^UQP_D1_PIN927_[a-f0-9]{12}$/.test(dbName ?? "") ||
      !process.env.UQP_D1_SQL_PASSWORD ||
      Object.keys(process.env).some(k => k.startsWith("PLATFORM_DB_") || k === "DOTENV_CONFIG_PATH"))
    throw Error("PIN_HTTP_DISPOSABLE_GUARD");
  const pool = await new sql.ConnectionPool({
    server: "127.0.0.1", port: 14336, user: "sa",
    password: process.env.UQP_D1_SQL_PASSWORD, database: dbName,
    connectionTimeout: 5000, requestTimeout: 15000,
    options: { encrypt: true, trustServerCertificate: true },
    pool: { max: 5, min: 0 },
  }).connect();
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const identity = (await pool.request().query(
      "SELECT CONVERT(nvarchar(128),SERVERPROPERTY('MachineName')) AS Machine,DB_NAME() AS Db"
    )).recordset[0];
    assert.equal(identity.Machine, machine);
    assert.equal(identity.Db, dbName);
    const pepper: PinPepper = { id: "ci-only-v1", key: Buffer.alloc(32, 27) };
    const sessions = createWorkstationSessions({
      enabled: () => true, getPool: async () => pool,
      request: tx => new sql.Request(tx),
      // RBAC itself is outside this synthetic SQL fixture. Enforce minimal
      // identity/TokenVersion but never assert this tests production RBAC.
      userState: async () => ({ isActive: true, tokenVersion: 1,
        permissions: ["VIEW_QUERY", "EXECUTE_QUERY", "MANAGE_USERS"] }),
    });
    const state = createWorkstationPinState({
      enabled: () => true, getPool: async () => pool,
      transaction: p => new sql.Transaction(p),
      request: tx => new sql.Request(tx),
    });
    let auditSeq = 0;
    let failSuccessAudit = false;
    const service = createWorkstationPinService({
      enabled: () => true,
      pepper: () => pepper, sessions, state, verify: verifyPin,
      token: () => randomUUID() + "." + randomBytes(32).toString("base64url"),
      audit: async (input, tx) => {
        if (failSuccessAudit && input.eventType === "AUTH_PIN_LOGIN_SUCCESS") {
          failSuccessAudit = false;
          throw Error("SYNTHETIC_LOGIN_AUDIT_ABORT");
        }
        // The synthetic fixture has only an AuditLog(Id) table. Real
        // application Audit repository is covered by its own acceptance tests.
        const id = 100000000000 + process.pid * 100000 + (++auditSeq);
        await new sql.Request(tx).input("id", sql.BigInt, id)
          .query("INSERT INTO uqp.AuditLog(Id) VALUES(@id)");
        return id;
      },
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      // Loopback-only TLS metadata surrogate; not reachable on the network.
      Object.assign(req.socket, { encrypted: true });
      req.headers.host = "uqp-ci.invalid";
      next();
    });
    app.use(createWorkstationPinRouter({
      enabled: () => true, origin: () => "https://uqp-ci.invalid",
      key: () => pepper.key, sessions, service,
    }));
    server = createServer(app);
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    process.on("message", value => {
      if (value === "fail-next-success-audit") failSuccessAudit = true;
      if (value === "shutdown") {
        server?.closeAllConnections();
        server?.close(() => { void pool.close().then(() => process.exit(0)); });
      }
    });
    process.send?.({ kind: "ready", port });
    // Keep accepting loopback HTTP/IPC until the parent explicitly shuts down.
  } catch (error) {
    server?.closeAllConnections();
    server?.close();
    await pool.close();
    throw error;
  }
}
void main().catch(() => {
  process.send?.({ kind: "failed", code: "PIN_HTTP_WORKER_FAILED" });
  process.exitCode = 1;
});
