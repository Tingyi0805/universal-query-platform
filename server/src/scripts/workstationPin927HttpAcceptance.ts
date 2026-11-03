// D1-only integration of two distinct Node processes and real HTTP PIN routes
// against the disposable SQL 927 schema. No application environment or data.
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import sql from "mssql";
import { hashPin } from "../modules/auth/pinVerifier.js";
import { hashDeviceSecret } from "../modules/auth/workstationCredential.service.js";
import { credentialCookie, sessionCookie, workstationCsrf } from "../modules/auth/workstationCookies.js";

type Worker = { child: ChildProcess; port: number };
const origin = "https://uqp-ci.invalid";
export async function verify927Http(pool: sql.ConnectionPool, dbName: string): Promise<void> {
  if (process.env.UQP_D1_SCOPE !== "DISPOSABLE_ONLY" ||
      !/^uqp-d1-[a-f0-9]{12}$/.test(process.env.UQP_D1_CONTAINER_NAME ?? "") ||
      !/^UQP_D1_PIN927_[a-f0-9]{12}$/.test(dbName) ||
      Object.keys(process.env).some(k => k.startsWith("PLATFORM_DB_") || k === "DOTENV_CONFIG_PATH"))
    throw Error("PIN_HTTP_DISPOSABLE_TARGET_REQUIRED");
  assert.equal((await pool.request().query("SELECT DB_NAME() AS Db")).recordset[0].Db, dbName);
  const pepper = { id: "ci-only-v1", key: Buffer.alloc(32, 27) };
  const pin = "739204", usernameA = "synthetic-927", usernameB = "synthetic-http-927";
  const hash = await hashPin(pin, pepper);
  const credId = randomUUID(), credSecret = randomBytes(32).toString("base64url");
  const credential = credId + "." + credSecret;
  const workstation = (await pool.request().query(
    "INSERT INTO uqp.SharedWorkstation(WorkstationCode,DisplayName,IsActive,PinLoginEnabled) OUTPUT INSERTED.Id VALUES(N'D1-PIN-HTTP-927',N'Synthetic HTTP',1,1)"
  )).recordset[0]?.Id;
  assert(Number.isSafeInteger(Number(workstation)));
  await pool.request().input("id", sql.BigInt, workstation).input("user", sql.BigInt, 8).query(
    "INSERT INTO uqp.SharedWorkstationUser(WorkstationId,UserId) VALUES(@id,@user)");
  await pool.request().input("id", sql.BigInt, workstation).input("user", sql.BigInt, 9).query(
    "INSERT INTO uqp.SharedWorkstationUser(WorkstationId,UserId) VALUES(@id,@user)");
  await pool.request().input("hash", sql.NVarChar(512), hash).query(
    "UPDATE uqp.UserQuickPin SET PinHash=@hash WHERE UserId=8");
  await pool.request().input("hash", sql.NVarChar(512), hash).query(
    "INSERT INTO uqp.AppUser(Id,Username) VALUES(9,N'synthetic-http-927'); INSERT INTO uqp.UserQuickPin(UserId,PinHash,IsEnabled) VALUES(9,@hash,1)");
  await pool.request().input("id", sql.UniqueIdentifier, credId)
    .input("workstation", sql.BigInt, workstation)
    .input("secret", sql.VarBinary(32), hashDeviceSecret(credSecret))
    .query("INSERT INTO uqp.SharedWorkstationCredential(Id,WorkstationId,SecretHash,CredentialVersion) VALUES(@id,@workstation,@secret,1)");
  const workers: Worker[] = [];
  const spawn = async (): Promise<Worker> => {
    const file = fileURLToPath(new URL("./workstationPin927HttpWorker.ts", import.meta.url));
    const child = fork(file, [], { execArgv: ["--import", "tsx"],
      env: { ...process.env, UQP_D1_PIN927_HTTP_DB: dbName },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    // Do not log worker stdout/stderr; SQL/HTTP secrets must never be printed.
    child.stdout?.resume(); child.stderr?.resume();
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("PIN_HTTP_WORKER_START_TIMEOUT")), 20000);
      const finish = (fn: () => void) => { clearTimeout(timer); child.off("message", onMessage); child.off("exit", onExit); fn(); };
      const onMessage = (msg: unknown) => {
        if (msg && typeof msg === "object" && (msg as { kind?: string }).kind === "ready" &&
            Number.isInteger((msg as {port?:number}).port)) finish(() => resolve((msg as {port:number}).port));
        if (msg && typeof msg === "object" && (msg as { kind?: string }).kind === "failed") finish(() => reject(Error("PIN_HTTP_WORKER_START_FAILED")));
      };
      const onExit = () => finish(() => reject(Error("PIN_HTTP_WORKER_EARLY_EXIT")));
      child.on("message", onMessage); child.once("exit", onExit);
    });
    return { child, port };
  };
  const call = async (w: Worker, path: string, method: "GET" | "POST", token?: string,
    body?: {username:string;pin:string}) => {
    const cookies = `${credentialCookie}=${credential}${token ? `; ${sessionCookie}=${token}` : ""}`;
    return fetch(`http://127.0.0.1:${w.port}${path}`, {
      method, headers: { host: "uqp-ci.invalid", origin, cookie: cookies,
        ...(method === "POST" ? {
          "content-type": "application/json",
          "x-workstation-csrf": workstationCsrf(pepper.key, credential, token ?? null),
        } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
  };
  const cookieOf = (response: Response) => {
    const raw = response.headers.get("set-cookie");
    const match = raw && new RegExp(`(?:^|,)\\s*${sessionCookie}=([^;]+)`).exec(raw);
    assert(match, "PIN_SESSION_COOKIE_REQUIRED");
    return match[1]!;
  };
  try {
    workers.push(await spawn());
    workers.push(await spawn());
    const [a,b] = workers;
    assert(a && b && a.child.pid !== b.child.pid);
    const first = await call(a, "/login", "POST", undefined, { username: usernameA, pin });
    assert.equal(first.status, 200);
    const tokenA = cookieOf(first);
    const readOther = await call(b, "/session", "GET", tokenA);
    assert.equal(readOther.status, 200);
    assert.equal((await readOther.json()).user?.id, 8);
    const second = await call(b, "/switch", "POST", tokenA, { username: usernameB, pin });
    assert.equal(second.status, 200);
    const tokenB = cookieOf(second);
    const oldSession = await call(a, "/session", "GET", tokenA);
    assert.equal((await oldSession.json()).user, null);
    assert.equal((await (await call(a, "/session", "GET", tokenB)).json()).user?.id, 9);
    // Force phase-two login Audit failure on node A; phase-one revocation must
    // remain durable even though the new session insert rolls back.
    a.child.send("fail-next-success-audit");
    const bad = await call(a, "/switch", "POST", tokenB, { username: usernameA, pin });
    assert.equal(bad.status, 503);
    assert.equal((await (await call(b, "/session", "GET", tokenB)).json()).user, null);
    assert.equal((await pool.request().input("id",sql.BigInt,workstation).query(
      "SELECT COUNT(*) AS N FROM uqp.SharedWorkstationSession WHERE WorkstationId=@id AND RevokedAtUtc IS NULL"
    )).recordset[0].N, 0);
    // Concurrent independent processes: stale response must not restore old
    // session, and at most one active session may remain after both finish.
    const [r1,r2] = await Promise.all([
      call(a, "/login", "POST", undefined, { username: usernameA, pin }),
      call(b, "/switch", "POST", undefined, { username: usernameB, pin }),
    ]);
    assert([200,409].includes(r1.status));
    assert([200,409].includes(r2.status));
    assert(r1.status === 200 || r2.status === 200);
    assert.equal((await pool.request().input("id",sql.BigInt,workstation).query(
      "SELECT COUNT(*) AS N FROM uqp.SharedWorkstationSession WHERE WorkstationId=@id AND RevokedAtUtc IS NULL"
    )).recordset[0].N, 1);
    const validTokens = [r1,r2].filter(r => r.status === 200).map(cookieOf);
    const active = await Promise.all(validTokens.map(async token => (await (await call(a, "/session", "GET", token)).json()).user));
    assert.equal(active.filter(u => u !== null).length, 1);
    console.log("PIN_927_HTTP_TWO_PROCESS_LOGIN_SWITCH_AUDIT_FAILURE_STALE_SESSION_PASS (synthetic loopback HTTP; TLS metadata surrogate, no production RBAC)");
  } finally {
    await Promise.all(workers.map(async ({child}) => {
      if (child.exitCode !== null) return;
      child.send("shutdown");
      await Promise.race([
        new Promise<void>(resolve => child.once("exit", () => resolve())),
        new Promise<void>(resolve => setTimeout(resolve, 3000)),
      ]);
      if (child.exitCode === null) child.kill();
    }));
  }
}
