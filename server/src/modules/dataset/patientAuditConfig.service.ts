import type sql from "mssql";
import { createHash } from "node:crypto";
import { nextConfigurationVersion, parseConfigurationVersion } from "../securityContract/securityContract.js";
import type { PatientAuditKeyring } from "../audit/patientAuditKeyring.js";

export class PatientAuditError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
export type AuditDefinition = { sqlText: string; dataSourceId: number };
export type PatientConfig = { isEnabled: boolean; patientKeyColumn: string; version: string };
export type PatientMetadata = { definitionHash: string; columns: string[] };
export type PatientState = { definition: AuditDefinition; config: PatientConfig | null;
  metadata: PatientMetadata | null; nameColumns: string[] };
export type PatientConfigInput = { expectedVersion: string; isEnabled: true; patientKeyColumn: string; identifierConfirmed: true };
export interface PatientAuditTransaction {
  read(id: number): Promise<PatientState>;
  save(id: number, config: PatientConfig): Promise<void>;
  metadata(id: number, value: PatientMetadata | null): Promise<void>;
  audit(id: number, userId: number, config: PatientConfig, context: { ipAddress?: string | null; userAgent?: string | null }): Promise<void>;
}
export interface PatientAuditStore { transaction<T>(run: (tx: PatientAuditTransaction) => Promise<T>, transaction?: sql.Transaction): Promise<T> }
export const definitionHash = (definition: AuditDefinition) => createHash("sha256")
  .update(JSON.stringify([definition.dataSourceId, definition.sqlText])).digest("hex");

export function confirmedAliases(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 4096 && value.every(name =>
    typeof name === "string" && name.length > 0 && name.length <= 128 && name.trim() === name && !/[\x00-\x1f\x7f]/.test(name)) &&
    new Set(value.map(name => name.toUpperCase())).size === value.length;
}
export function describePatientState(state: PatientState, keyAvailable: boolean) {
  const metadataStatus = !state.metadata || state.metadata.definitionHash !== definitionHash(state.definition)
    ? "METADATA_UNCONFIRMED" : !confirmedAliases(state.metadata.columns) ? "METADATA_AMBIGUOUS" : "CONFIRMED";
  const columns = metadataStatus === "CONFIRMED" ? state.metadata!.columns : [];
  const config = state.config;
  const validKey = config && columns.includes(config.patientKeyColumn) &&
    !state.nameColumns.some(name => name.toUpperCase() === config.patientKeyColumn.toUpperCase());
  const status = !config ? "NOT_CONFIGURED" : !config.isEnabled ? "DISABLED" : !keyAvailable ? "KEY_UNAVAILABLE" :
    metadataStatus !== "CONFIRMED" ? metadataStatus : !validKey ? "PATIENT_KEY_INVALID" : "CONFIRMED";
  return { config, version: config?.version ?? "0", status, metadataStatus, columns };
}

export function createPatientAuditService(store: PatientAuditStore, keyring: () => PatientAuditKeyring) {
  const keyStatus = () => { try { return { available: true, version: keyring().activeVersion }; }
    catch { return { available: false, version: null }; } };
  return {
    get: (id: number) => store.transaction(async tx => describePatientState(await tx.read(id), keyStatus().available)),
    put: (id: number, input: PatientConfigInput, userId: number, context: { ipAddress?: string | null; userAgent?: string | null } = {}) =>
      store.transaction(async tx => {
        parseConfigurationVersion(input.expectedVersion);
        if (input.isEnabled !== true || input.identifierConfirmed !== true)
          throw new PatientAuditError("PATIENT_AUDIT_CONFIRMATION_REQUIRED", 400);
        const state = await tx.read(id);
        if (input.expectedVersion !== (state.config?.version ?? "0")) throw new PatientAuditError("PATIENT_AUDIT_VERSION_CONFLICT");
        const view = describePatientState(state, keyStatus().available);
        if (!keyStatus().available) throw new PatientAuditError("PATIENT_AUDIT_KEY_UNAVAILABLE", 503);
        if (view.metadataStatus !== "CONFIRMED") throw new PatientAuditError(view.metadataStatus);
        if (!view.columns.includes(input.patientKeyColumn) || state.nameColumns.some(name => name.toUpperCase() === input.patientKeyColumn.toUpperCase()))
          throw new PatientAuditError("PATIENT_KEY_INVALID", 400);
        const config: PatientConfig = { isEnabled: true, patientKeyColumn: input.patientKeyColumn, version: nextConfigurationVersion(input.expectedVersion) };
        await tx.save(id, config);
        await tx.audit(id, userId, config, context);
        return describePatientState({ ...state, config }, true);
      }),
    recordPreview: (id: number, executed: AuditDefinition, aliases: string[], userId: number,
      context: { ipAddress?: string | null; userAgent?: string | null } = {}) => store.transaction(async tx => {
      const state = await tx.read(id);
      // Compare values, not normalized SQL or just a caller-supplied hash.
      const exact = state.definition.sqlText === executed.sqlText && state.definition.dataSourceId === executed.dataSourceId;
      const metadata = exact && confirmedAliases(aliases) ? { definitionHash: definitionHash(state.definition), columns: aliases } : null;
      // Epoch advances on proof changes too, preventing A→missing→A cache resurrection.
      if (state.config && JSON.stringify(metadata) !== JSON.stringify(state.metadata)) {
        const config = { ...state.config, version: nextConfigurationVersion(state.config.version) };
        await tx.save(id, config);
        await tx.audit(id, userId, config, context);
      }
      await tx.metadata(id, metadata);
    }),
    dashboardState: (id: number, transaction?: sql.Transaction) => store.transaction(async tx => {
      const state = await tx.read(id); const keys = keyStatus();
      const view = describePatientState(state, keys.available);
      return { ...view, fingerprint: createHash("sha256").update(JSON.stringify([state.config, state.metadata, definitionHash(state.definition), state.nameColumns, keys])).digest("hex") };
    }, transaction),
    requireDisclosure: (id: number) => store.transaction(async tx => {
      const state = await tx.read(id);
      const view = describePatientState(state, keyStatus().available);
      if (view.status !== "CONFIRMED") throw new PatientAuditError("PATIENT_AUDIT_NOT_CONFIRMED", 503);
      return { config: state.config!, keyring: keyring() };
    }),
  };
}
