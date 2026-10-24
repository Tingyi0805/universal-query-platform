import type { PublicDisplayPolicy, PublicDisplayGrant } from "./datasetPublicDisplayPolicy.js";
import type { DatasetSensitiveColumn } from "./datasetSensitiveColumn.repository.js";
import { confirmDatasetPublicDisplay, publicDisplayDigest } from "./datasetPublicDisplayConfirmation.js";

/** Persistence-neutral transaction contract. No production table access is enabled.
 * A future SQL Server adapter must lock both policy and sensitivity revision
 * in one SERIALIZABLE transaction and commit the audit record atomically. */
export interface DatasetPublicDisplayWriter {
  transaction<T>(datasetId: number, work: (tx: {
    readSensitivity(): Promise<{ version: number; columns: DatasetSensitiveColumn[] }>;
    readPolicy(): Promise<PublicDisplayPolicy | null>;
    writePolicy(policy: PublicDisplayPolicy): Promise<void>;
    auditConfirmation(actorId: number, policyDigest: string): Promise<void>;
  }) => Promise<T>): Promise<T>;
}
export async function saveDatasetPublicDisplayConfirmation(
  writer: DatasetPublicDisplayWriter, datasetId: number, actorId: number,
  input: { expectedSensitivityVersion: number; expectedPolicyDigest: string | null; grants: PublicDisplayGrant[] },
): Promise<{ policy: PublicDisplayPolicy; digest: string }> {
  if (!Number.isSafeInteger(datasetId) || datasetId < 1 || !Number.isSafeInteger(actorId) || actorId < 1)
    throw new Error("PUBLIC_DISPLAY_ACTOR_INVALID");
  return writer.transaction(datasetId, async tx => {
    const [sensitivity, previous] = await Promise.all([tx.readSensitivity(), tx.readPolicy()]);
    const policy = confirmDatasetPublicDisplay(sensitivity, previous, input);
    const digest = publicDisplayDigest(policy);
    if (!digest) throw new Error("PUBLIC_DISPLAY_DIGEST_INVALID");
    await tx.writePolicy(policy);
    await tx.auditConfirmation(actorId, digest);
    return { policy, digest };
  });
}
