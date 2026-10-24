import sql from "mssql";
import { getTokenSessionState } from "../auth/auth.repository.js";
import { requireSecuritySchema } from "../securityContract/securityContract.repository.js";
import { readDashboardApprovalEvidence } from "./dashboardApproval.repository.js";
import { queryModeSchemaReady } from "./dashboardQueryMode.repository.js";
import { createQuerySourceStore, defaultQuerySourceDependencies } from "./dashboardQuerySources.repository.js";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
import type { TransitionStore, TransitionTransaction } from "./dashboardTransition.service.js";

export const defaultTransitionDependencies = { ...defaultQuerySourceDependencies,
  session: getTokenSessionState, securitySchema: requireSecuritySchema, modeSchema: queryModeSchemaReady };

export function createDashboardTransitionStore(deps = defaultTransitionDependencies): TransitionStore {
  const store = createQuerySourceStore({ ...deps,
    extend(transaction, base) {
      const request = () => deps.createRequest(transaction);
      const scoped = (id: number) => request().input("id", sql.BigInt, id);
      return Object.assign(base, {
        async securityReady() {
          await deps.securitySchema(request());
          if (!await deps.modeSchema(request())) throw new QuerySourceError("QUERY_MODE_SCHEMA_REQUIRED", 503);
        },
        async actor(actor) {
          const session = await deps.session(actor.userId, transaction);
          if (!session?.isActive || session.tokenVersion !== actor.tokenVersion) throw new QuerySourceError("TOKEN_REVOKED", 401);
          if (!session.permissions.includes("DESIGN_QUERY")) throw new QuerySourceError("FORBIDDEN", 403);
        },
        approvalEvidence: (id: number) => readDashboardApprovalEvidence(id, request),
        async readDisableState(id) {
          // Stopping exposure must not depend on clinical Query validity or JSON parsing.
          const row = (await scoped(id).query("SELECT Id,IsActive,QueryMode FROM uqp.Dashboard WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id")).recordset[0];
          if (!row) throw new QuerySourceError("DASHBOARD_NOT_FOUND", 404);
          return { id, isActive: Boolean(row.IsActive), mode: String(row.QueryMode), version: await readDashboardApprovalEvidence(id, request) };
        },
        async disableLegacy(id) {
          const result = await scoped(id).query(`UPDATE uqp.Dashboard SET IsActive=0,UpdatedAtUtc=SYSUTCDATETIME()
            WHERE Id=@id AND IsActive=1 AND QueryMode='LEGACY'`);
          if (result.rowsAffected[0] !== 1) throw new QuerySourceError("DASHBOARD_TRANSITION_VERSION_CONFLICT");
        },
        async revokeCredentials(id) {
          // Retain device identities/settings and eligibility for later explicit Query-only
          // authorization; invalidate every old credential without issuing a replacement.
          await scoped(id).query(`UPDATE uqp.DashboardDisplayDevice
            SET TokenHash=CONVERT(CHAR(64),HASHBYTES('SHA2_256',CRYPT_GEN_RANDOM(32)),2),LastUsedAtUtc=NULL,
            QueryModeGrantVersion=NULL,DelegatorTokenVersion=NULL WHERE DashboardId=@id`);
        },
        async updateApprovalParameters(id, parameters) {
          const result = await scoped(id).input("parameters", sql.NVarChar(sql.MAX), JSON.stringify(parameters))
            .query("UPDATE uqp.Dashboard SET ParametersJson=@parameters,UpdatedAtUtc=SYSUTCDATETIME() WHERE Id=@id AND IsActive=0 AND QueryMode<>'QUERY_ONLY'");
          if (result.rowsAffected[0] !== 1) throw new QuerySourceError("DASHBOARD_TRANSITION_VERSION_CONFLICT");
        },
        async transitionAudit(id, actor, action, source) {
          await deps.writeAuditEvent({ eventType: `DASHBOARD_${action}`, userId: actor.userId,
            parameters: { dashboardId: id, ...(source ? { sourceId: source.id, sourceKey: source.sourceKey } : { credentialsInvalidated: true }) } }, transaction);
        },
      } satisfies Partial<TransitionTransaction>);
    },
  });
  return { transaction: work => store.transaction(tx => work(tx as TransitionTransaction)) };
}
export const dashboardTransitionStore = createDashboardTransitionStore();
