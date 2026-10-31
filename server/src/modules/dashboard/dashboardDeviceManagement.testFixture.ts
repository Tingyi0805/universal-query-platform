import { createDeviceEnrollmentService } from "./dashboardDeviceEnrollment.service.js";
import { revokeDashboardQueryDevice } from "./dashboardQueryMode.repository.js";
import assert from "node:assert/strict";
import { serialize, deserialize } from "node:v8";
import sql from "mssql";
import { SecurityContractError } from "../securityContract/securityContract.js";
import { createDeviceManagementStore, defaultDeviceManagementDependencies } from "./dashboardDeviceManagement.repository.js";
import { createDeviceManagementService } from "./dashboardDeviceManagement.service.js";
const copy = <T>(v: T): T => deserialize(serialize(v));
const actor = { userId: 1, tokenVersion: 1 };
type Row = Record<string, any>;
export function deviceManagementFixture() {
  let db = { sequence: 3n, parent: { Id: 1, Name: "Synthetic", QueryDefinitionId: 20, ParametersJson: "{}", IsActive: false, QueryMode: "LEGACY", QueryModeVersion: 0,
    QuerySourceMaxRows: 100, RefreshSeconds: 30, PageSize: 10, PageSeconds: 15, UpdatedAtUtc: "2026-10-20T00:00:00Z", DisplayMode: "TABLE",
    ShowClock: true, ShowPageNumber: true, ShowCountdown: true, ApprovalRowVersion: Buffer.from("0000000000000001", "hex") } as Row,
    devices: [{ Id: 7, DashboardId: 1, DeviceName: "Synthetic", CreatedByUserId: 2, SharedWorkstationId: 3, IsActive: true, ExpiresAtUtc: null, RevokedAtUtc: null,
      ArchivedAtUtc: null, EnforceIpRestriction: true, AllowedIp: "192.0.2.2", AllowedCidr: null, TokenHash: "a".repeat(64), QueryModeGrantVersion: 1, DelegatorTokenVersion: 1 }] as Row[],
    placements: [] as Row[], audits: [] as Row[] };
  let staged = copy(db), queue = Promise.resolve();
  const control = { enabled: true, schema: true, modeSchema: true, deviceSchema: true, pool: true, failAt: "", deniedUser: 0, account: true,
    permissions: ["DESIGN_QUERY", "EXECUTE_QUERY"], tokenVersion: 1, workstation: true, query: true, policy: true, policyReads: 0, policyFailAtRead: 0, patientAudit: false, statements: [] as string[], events: [] as string[] };
  const fail = (at: string) => { if (control.failAt === at) throw new Error("synthetic-private-diagnostic"); };
  let currentTx: sql.Transaction;
  const deps: typeof defaultDeviceManagementDependencies = { ...defaultDeviceManagementDependencies,
    getPool: async () => control.pool ? {} as sql.ConnectionPool : null,
    createTransaction: () => {
      let release = () => {};
      const tx = { begin: async (level: number) => { assert.equal(level, sql.ISOLATION_LEVEL.SERIALIZABLE); const previous = queue;
        queue = new Promise<void>(resolve => { release = resolve; }); await previous; currentTx = tx; staged = copy(db); control.events.push("begin"); },
        commit: async () => { fail("commit"); db = copy(staged); control.events.push("commit"); release(); },
        rollback: async () => { staged = copy(db); control.events.push("rollback"); release(); } } as unknown as sql.Transaction;
      return tx;
    },
    securitySchema: async () => { if (!control.schema) throw new SecurityContractError("SECURITY_SCHEMA_REQUIRED"); },
    modeSchema: async () => control.modeSchema, deviceSchema: async () => control.deviceSchema,
    lifecycleSchema: async () => { fail("lifecycle-schema"); },
    publicDisplay: async (tx,_id) => { assert.equal(tx,currentTx);control.policyReads++;if(control.policyReads===control.policyFailAtRead)throw new Error("POLICY_CHANGED");fail("policy");return {status:control.policy?"CONFIRMED":"STALE",sensitivityVersion:1,
      policy:{confirmed:control.policy,sensitivityVersion:1,grants:[{columnName:"DISPLAY",permitted:true} ]}} as any; },
    session: async (id, tx) => { assert.equal(tx, currentTx); return { isActive: control.account && id !== control.deniedUser, tokenVersion: control.tokenVersion, permissions: control.permissions } as any; },
    getEffectiveQueryAccess: async (id, _q, tx) => { assert.equal(tx, currentTx); return id !== control.deniedUser && control.query ? { canView: true, canExecute: true } as any : null; },
    getDataset: async (_id, tx) => { assert.equal(tx, currentTx); return { id: 2, isActive: true, isArchived: false, sqlText: "SELECT 1" } as any; },
    listDatasetParameters: async (_id, tx) => { assert.equal(tx, currentTx); return []; },
    writeAuditEvent: async (input, tx) => { assert.equal(tx, currentTx); staged.audits.push(copy(input)); fail("audit"); return control.failAt === "audit-evidence" ? NaN : staged.audits.length; },
    createRequest: tx => {
      assert.equal(tx, currentTx); const v: Row = {};
      return { input(name: string, _type: unknown, value: unknown) { v[name] = value; return this; }, async query(s: string) {
        control.statements.push(s);
        if (s.includes("CK_DashboardDataSource_QueryBoundLimit")) return { recordset: [{ Ready: true }] };
        if (s.includes("AS Suspended,")) return {recordset:[{Suspended:8,Pending:1}]};
        if (s.includes("DEVICE_LIFECYCLE_TRIGGER_CONFLICT")) { fail("lifecycle-schema"); return {recordset:[]}; }
        if (s.includes("SET IsActive=0,RevokedAtUtc=SYSUTCDATETIME()")) {
          assert.match(s,/SuspendedAtUtc=NULL,ReenrollmentRequired=NULL/);
          assert.doesNotMatch(s,/AND IsActive=1/);
          const d=staged.devices.find(d=>d.Id===v.deviceId && d.DashboardId===v.id && !d.RevokedAtUtc && !d.ArchivedAtUtc);
          if(!d)return {rowsAffected:[0]};
          Object.assign(d,{IsActive:false,RevokedAtUtc:new Date(Math.floor(Date.now()/1000)*1000).toISOString(),SuspendedAtUtc:null,
            ReenrollmentRequired:null,TokenHash:"f".repeat(64),QueryModeGrantVersion:null,DelegatorTokenVersion:null});
          return {rowsAffected:[1]};
        }
        if (s.includes("DECLARE @credential TABLE")) {
          assert.match(s,/OUTPUT INSERTED.Id INTO @credential/);assert.match(s,/SuspendedAtUtc IS NULL/);assert.match(s,/AND ReenrollmentRequired=1/);
          const d=staged.devices.find(d=>d.Id===v.deviceId&&d.DashboardId===v.dashboardId),issue=s.includes("SET TokenHash=@hash");
          const now=new Date(Math.round(Date.now()/1000)*1000).toISOString();
          if(!d||!d.IsActive||d.RevokedAtUtc||d.ArchivedAtUtc||d.SuspendedAtUtc||d.ReenrollmentRequired!==true||d.ExpiresAtUtc&&Date.parse(d.ExpiresAtUtc)<=Date.now()||
            !issue&&(d.TokenHash.toLowerCase()!==v.hash||d.QueryModeGrantVersion!==v.modeVersion||d.DelegatorTokenVersion!==v.ownerVersion))return {recordset:[]};
          if(issue)Object.assign(d,{TokenHash:v.hash,QueryModeGrantVersion:v.modeVersion,DelegatorTokenVersion:v.ownerVersion,ReenrollmentRequired:true});
          else d.ReenrollmentRequired=false;
          fail("credential");return {recordset:[{Id:d.Id,EventTime:now}]};
        }
        if (s.includes("FROM uqp.DatasetPatientAuditConfig")) return {recordset:control.patientAudit?[{IsEnabled:true,PatientKeyColumn:null}]:[]};
        if (s.includes("DECLARE @eventTime")) {
          assert.match(s, /OUTPUT INSERTED.Id INTO @changed/);
          assert.match(s, /CRYPT_GEN_RANDOM\(32\)/);
          assert.match(s, /RevokedAtUtc IS NULL AND ArchivedAtUtc IS NULL/);
          const d = staged.devices.find(d => d.Id === v.deviceId && d.DashboardId === v.dashboardId);
          const suspend = s.includes("SuspendedAtUtc=@eventTime"), time = new Date(Math.round(Date.now()/1000)*1000).toISOString();
          if (!d || d.RevokedAtUtc || d.ArchivedAtUtc || d.ExpiresAtUtc && Date.parse(d.ExpiresAtUtc)<=Date.now() ||
            (suspend ? !d.IsActive || d.SuspendedAtUtc : d.IsActive || !d.SuspendedAtUtc || d.ReenrollmentRequired !== true)) return {recordset:[]};
          Object.assign(d,{IsActive:!suspend,SuspendedAtUtc:suspend?time:null,ReenrollmentRequired:true,
            TokenHash:suspend?"d".repeat(64):"e".repeat(64),QueryModeGrantVersion:null,DelegatorTokenVersion:null});
          fail("lifecycle"); return {recordset:[{Id:d.Id,EventTime:time}]};
        }
        if (s.startsWith("SELECT * FROM uqp.Dashboard WITH")) { assert.match(s, /UPDLOCK,HOLDLOCK/); return { recordset: v.dashboardId === 1 ? [copy(staged.parent)] : [] }; }
        if (s.startsWith("SELECT * FROM uqp.DashboardDataSource") || s.includes("SELECT w.ConfigJson") || s.startsWith("SELECT Id,SourceKey,DatasetId,ApprovalRowVersion")) return { recordset: [] };
        if (s.startsWith("SELECT QueryDefinitionId,ApprovalRowVersion")) return { recordset: [copy(staged.parent)] };
        if (s.includes("FROM uqp.DashboardDisplayDevice WITH")) { assert.match(s, /UPDLOCK,HOLDLOCK/); return { recordset: copy(staged.devices) }; }
        if (s.startsWith("SELECT p.* FROM uqp.DashboardDevicePlaybackSettings")) { assert.match(s, /UPDLOCK,HOLDLOCK/); return { recordset: copy(staged.placements) }; }
        if (s.startsWith("SELECT Id,DatasetId,IsPublished")) return { recordset: control.query ? [{ Id: 20, DatasetId: 2, IsPublished: true, IsActive: true, IsArchived: false }] : [] };
        if (s.includes("FROM uqp.SharedWorkstation WITH")) return { recordset: [{ IsActive: control.workstation, RetiredAtUtc: null, PurposeCode: "DASHBOARD" }] };
        if(/UPDATE\s+uqp\.DashboardDisplayDevice\s+SET ExpiresAtUtc=DATEADD/.test(s)){
          assert.match(s,/ArchivedAtUtc IS NULL/);assert.match(s,/RevokedAtUtc IS NULL/);assert.match(s,/ExpiresAtUtc>SYSUTCDATETIME/);assert.match(s,/DATEADD\(DAY,365,SYSUTCDATETIME/);
          assert.doesNotMatch(s.split("OUTPUT")[0]!,/TokenHash=|QueryModeGrantVersion=|DelegatorTokenVersion=|IsActive=/);
          const d=staged.devices.find(d=>d.Id===v.deviceId&&d.DashboardId===v.dashboardId)!;
          if(control.failAt==="renew-expired")return{recordset:[]};
          d.ExpiresAtUtc=new Date(Date.parse(d.ExpiresAtUtc)+v.extendDays*86400000).toISOString();fail("renew");return{recordset:[copy(d)]};
        }
        if (s.startsWith("INSERT INTO uqp.DashboardDisplayDevice")) {
          assert.match(s, /CRYPT_GEN_RANDOM\(32\)/); assert.match(s, /NULL,1,@expiresAtUtc/); assert.doesNotMatch(s, /OUTPUT INSERTED\.\*/);
          staged.devices.push({ Id: 8, DashboardId: v.dashboardId, DeviceName: v.deviceName, CreatedByUserId: v.ownerId, SharedWorkstationId: null,
            IsActive: true, ExpiresAtUtc: v.expiresAtUtc, EnforceIpRestriction: v.enforceIpRestriction, AllowedIp: v.allowedIp, AllowedCidr: v.allowedCidr,
            TokenHash: "b".repeat(64), QueryModeGrantVersion: null, DelegatorTokenVersion: null, RevokedAtUtc: null, ArchivedAtUtc: null });
          fail("create"); return { recordset: [{ Id: 8 }] };
        }
        if (s.startsWith("UPDATE uqp.DashboardDisplayDevice SET")) {
          assert.match(s, /RevokedAtUtc IS NULL AND ArchivedAtUtc IS NULL/); assert.match(s, /ExpiresAtUtc>SYSUTCDATETIME/);
          assert.doesNotMatch(s.split("WHERE")[0]!, /CreatedByUserId=|SharedWorkstationId=|IsActive=|RevokedAtUtc=/);
          Object.assign(staged.devices.find(d => d.Id === v.deviceId && d.DashboardId === v.dashboardId)!, { DeviceName: v.deviceName, EnforceIpRestriction: v.enforceIpRestriction,
            AllowedIp: v.allowedIp, AllowedCidr: v.allowedCidr, ExpiresAtUtc: v.expiresAtUtc, TokenHash: "c".repeat(64), QueryModeGrantVersion: null, DelegatorTokenVersion: null, LastUsedAtUtc: null });
          if(s.includes("ReenrollmentRequired=1,"))staged.devices.find(d=>d.Id===v.deviceId)!.ReenrollmentRequired=true;
          fail("metadata"); return { rowsAffected: [control.failAt === "rowcount" ? 0 : 1] };
        }
        if (s.includes("UPDATE uqp.DashboardDevicePlaybackSettings SET")) {
          assert.match(s, /RevokedAtUtc IS NULL AND ArchivedAtUtc IS NULL/); assert.doesNotMatch(s, /TokenHash=|ParametersJson|ColumnMask/);
          staged.placements = [{ DashboardId: v.dashboardId, DeviceId: v.deviceId, Browser: v.browser, ScreenNumber: v.screenNumber, Fullscreen: v.fullscreen,
            WindowX: v.windowX, WindowY: v.windowY, WindowWidth: v.windowWidth, WindowHeight: v.windowHeight }]; fail("placement"); return { rowsAffected: [1] };
        }
        if (s.startsWith("UPDATE uqp.Dashboard SET UpdatedAtUtc")) { staged.parent.ApprovalRowVersion = Buffer.from((staged.sequence++).toString(16).padStart(16, "0"), "hex"); fail("touch"); return { rowsAffected: [1] }; }
        throw new Error("unexpected synthetic SQL");
      } } as unknown as sql.Request;
    },
  };
  const store=createDeviceManagementStore(deps);
  const service = createDeviceManagementService(store, () => control.enabled);
  const revoke=()=>store.transaction(async tx=>{await tx.readState(1);await tx.records(1);await revokeDashboardQueryDevice(1,7,deps.createRequest(currentTx));});
  const enrollment=createDeviceEnrollmentService(store,()=>control.enabled);
  return { service, enrollment, revoke, deps, control, db: () => db, snapshot: () => copy(db), version: async () => (await service.read(1, actor)).version };
}
