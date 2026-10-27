/** No platform configuration, .env or database import in this module. */
export const isolated926Machine = "uqp-h0-926-isolated";
export const isolated926Port = 14336;
export const isolated926Approval = "CREATE_DISPOSABLE_SYNTHETIC_926_ONLY";

export function isolated926Target(env: NodeJS.ProcessEnv) {
  if (env.UQP926_APPROVE !== isolated926Approval || !/^[0-9a-f]{32}$/.test(env.UQP926_RUN_ID ?? "") ||
      !env.UQP926_PASSWORD || env.UQP926_PASSWORD.length < 24) throw Error("ISOLATED_926_APPROVAL_REQUIRED");
  return Object.freeze({
    server: "127.0.0.1", port: isolated926Port, machine: isolated926Machine,
    database: "UQP926_" + env.UQP926_RUN_ID,
    runId: env.UQP926_RUN_ID,
  });
}

export function assertIsolated926Witness(row: Record<string, unknown>, machine: string) {
  if (row.Engine !== 15 || row.Machine !== machine || row.ServerName !== machine || row.DatabaseName !== "master" ||
      row.LoginName !== "sa" || row.UserDatabases !== 0 || row.IsSysadmin !== 1)
    throw Error("ISOLATED_926_IDENTITY_OR_EMPTY_INSTANCE_REQUIRED");
}
