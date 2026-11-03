import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import type { ConfirmedDatasetDeliverySnapshot } from "../dataset/datasetDeliveryPolicy.repository.js";

/** Conservative minimum assurance: only explicitly classified OTHER datasets
 * without patient configuration. Masking never upgrades PIN assurance.
 * Uses the existing confirmed sensitivity version, not a second ACL/policy table.
 */
export async function readPinQueryPolicy(datasetId: number, tx?: sql.Transaction) {
  const pool = tx ? null : await getPlatformDbPool();
  if (!tx && !pool) throw new Error("PIN_QUERY_POLICY_UNAVAILABLE");
  const request = tx ? new sql.Request(tx) : pool!.request();
  const result = await request.input("id", sql.BigInt, datasetId).query(`
    SELECT c.ColumnName,c.SensitivityType,CONVERT(varchar(20),v.VersionNumber) AS Version
    FROM uqp.DatasetSensitivePolicyVersion v WITH (HOLDLOCK)
    JOIN uqp.DatasetSensitiveColumn c WITH (HOLDLOCK) ON c.DatasetId=v.DatasetId
    WHERE v.DatasetId=@id ORDER BY c.ColumnName;`);
  return result.recordset as { ColumnName: string; SensitivityType: string; Version: string }[];
}
export function pinQueryPolicyAllows(snapshot: ConfirmedDatasetDeliverySnapshot, rows: Awaited<ReturnType<typeof readPinQueryPolicy>>) {
  if (snapshot.patientAudit.configured || snapshot.patientAudit.enabled || snapshot.policy.patientAuditOnlyColumns?.length || !rows.length) return false;
  const names = rows.map(r => r.ColumnName.toUpperCase()).sort();
  return rows.every(r => r.SensitivityType === "OTHER" && r.Version === snapshot.sensitivityVersion)
    && new Set(names).size === names.length
    && JSON.stringify(names) === JSON.stringify(snapshot.policy.rules.map(r => r.columnName.toUpperCase()).sort());
}
