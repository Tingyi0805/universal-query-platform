import bcrypt from "bcryptjs";
import sql from "mssql";
import { getPlatformDbPool } from "../../config/database.js";
import { findUserById } from "./auth.repository.js";
import { env } from "../../config/env.js";
import { hashPin, verifyPin, parsePinPepper } from "./pinVerifier.js";

const PIN_COST = 12;
export const DEFAULT_PIN_LENGTH = 6;

export function isAllowedPinLength(value: number): boolean {
  return Number.isInteger(value) && value >= 4 && value <= 12;
}

export function validateQuickPinLength(pin: string, length: number): boolean {
  return isAllowedPinLength(length) && pin.length === length && validateQuickPin(pin);
}

export async function getConfiguredPinLength(): Promise<number> {
  const pool = await getPlatformDbPool();
  if (!pool) return DEFAULT_PIN_LENGTH;
  const result = await pool.request().query("SELECT TOP (1) PinLength FROM uqp.QuickPinPolicy WHERE Id=1");
  const length = Number(result.recordset[0]?.PinLength);
  if(!isAllowedPinLength(length)) throw new Error("PIN_POLICY_INVALID");
  return length;
}
const blocked = new Set(["000000", "111111", "123456", "654321", "12345678", "87654321", "121212", "112233", "123123"]);

export function validateQuickPin(pin: string): boolean {
  return /^\d{4,12}$/.test(pin) && !blocked.has(pin) &&
    !/^(\d)\1+$/.test(pin) &&
    !("0123456789".includes(pin) || "9876543210".includes(pin)) &&
    !/^(\d{2})\1{1,5}$/.test(pin);
}

export type QuickPinDependencies = {
  getPool: typeof getPlatformDbPool;
  findUser: typeof findUserById;
  transaction: (pool: sql.ConnectionPool) => sql.Transaction;
  request: (tx: sql.Transaction) => sql.Request;
  compare: (value: string, hash: string) => Promise<boolean>;
  hash: (value: string) => Promise<string>;
  now: () => number;
};
export type PinMutationStatus = "OK" | "INVALID_CREDENTIALS" | "PIN_WEAK" | "PIN_LOCKED" | "PIN_POLICY_CHANGED" | "NOT_CONFIGURED";
export function createQuickPinService(deps: QuickPinDependencies) {
  async function mutate(userId: number, password: string, pin?: string): Promise<PinMutationStatus> {
    if(pin!==undefined && !validateQuickPin(pin)) return "PIN_WEAK";
    const user = await deps.findUser(userId);
    if(user===undefined) return "NOT_CONFIGURED";
    if(!user || !user.isActive || user.authProvider!=="LOCAL" || !user.passwordHash) return "INVALID_CREDENTIALS";
    const pool=await deps.getPool(); if(!pool) return "NOT_CONFIGURED";
    const tx=deps.transaction(pool); await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      // Policy lock precedes PIN row locks, matching the policy update transaction.
      const policy=await deps.request(tx).query("SELECT PinLength FROM uqp.QuickPinPolicy WITH (UPDLOCK,HOLDLOCK) WHERE Id=1");
      const length=Number(policy.recordset[0]?.PinLength);
      if(!isAllowedPinLength(length)) throw new Error("PIN_POLICY_INVALID");
      const current=await deps.request(tx).input("userId",sql.BigInt,userId)
        .query("SELECT IsActive,TokenVersion,PasswordHash FROM uqp.AppUser WITH (UPDLOCK,HOLDLOCK) WHERE Id=@userId");
      if(!current.recordset[0]?.IsActive || Number(current.recordset[0].TokenVersion)!==user.tokenVersion || current.recordset[0].PasswordHash!==user.passwordHash) {
        await tx.rollback();return "INVALID_CREDENTIALS";
      }
      const existing=await deps.request(tx).input("userId",sql.BigInt,userId)
        .query("SELECT * FROM uqp.UserQuickPin WITH (UPDLOCK,HOLDLOCK) WHERE UserId=@userId");
      const row=existing.recordset[0];
      if(row?.LockedUntilUtc && new Date(row.LockedUntilUtc).getTime()>deps.now()) {await tx.rollback();return "PIN_LOCKED";}
      if(!await deps.compare(password,user.passwordHash)) {
        if(row) await deps.request(tx).input("userId",sql.BigInt,userId).query(`
          UPDATE uqp.UserQuickPin SET FailedAttempts=CASE WHEN LockedUntilUtc<=SYSUTCDATETIME() THEN 1 ELSE FailedAttempts+1 END,
            LockedUntilUtc=CASE WHEN FailedAttempts>=4 AND (LockedUntilUtc IS NULL OR LockedUntilUtc>SYSUTCDATETIME())
              THEN DATEADD(MINUTE,15,SYSUTCDATETIME()) ELSE NULL END WHERE UserId=@userId`);
        await tx.commit();return "INVALID_CREDENTIALS";
      }
      if(pin!==undefined) {
        if(!validateQuickPinLength(pin,length)) {await tx.rollback();return "PIN_POLICY_CHANGED";}
        if(row?.PinHash && await deps.compare(pin,String(row.PinHash))) {await tx.rollback();return "PIN_WEAK";}
        const hash=await deps.hash(pin);
        await deps.request(tx).input("userId",sql.BigInt,userId).input("pinHash",sql.NVarChar(512),hash).query(`
          UPDATE uqp.UserQuickPin SET PinHash=@pinHash,PinVersion=PinVersion+1,IsEnabled=1,
            FailedAttempts=0,LockedUntilUtc=NULL,UpdatedAtUtc=SYSUTCDATETIME() WHERE UserId=@userId;
          IF @@ROWCOUNT=0 INSERT INTO uqp.UserQuickPin (UserId,PinHash,IsEnabled) VALUES (@userId,@pinHash,1);`);
      } else {
        await deps.request(tx).input("userId",sql.BigInt,userId).query(`UPDATE uqp.UserQuickPin SET IsEnabled=0,PinVersion=PinVersion+1,
          FailedAttempts=0,LockedUntilUtc=NULL,UpdatedAtUtc=SYSUTCDATETIME() WHERE UserId=@userId`);
      }
      await deps.request(tx).input("userId",sql.BigInt,userId).query(`UPDATE uqp.SharedWorkstationSession SET RevokedAtUtc=SYSUTCDATETIME()
        WHERE UserId=@userId AND RevokedAtUtc IS NULL`);
      await tx.commit();return "OK";
    } catch(error) {await tx.rollback().catch(()=>undefined);throw error;}
  }
  return { enrollQuickPin:(id:number,password:string,pin:string)=>mutate(id,password,pin),revokeQuickPin:(id:number,password:string)=>mutate(id,password) };
}
const service=createQuickPinService({getPool:getPlatformDbPool,findUser:findUserById,
  transaction:pool=>new sql.Transaction(pool),request:tx=>new sql.Request(tx),
  compare:(value,hash)=>hash.startsWith("$uqp-scrypt$")
    ? verifyPin(value,hash,parsePinPepper(env.WORKSTATION_PIN_PEPPER_ID,env.WORKSTATION_PIN_PEPPER))
    : bcrypt.compare(value,hash),
  // Existing installations keep enrollment working while runtime is disabled.
  // Once configured, new verifiers use scrypt. Runtime login never accepts bcrypt.
  hash:value=>env.WORKSTATION_PIN_RUNTIME || env.WORKSTATION_PIN_PEPPER || env.WORKSTATION_PIN_PEPPER_ID
    ? hashPin(value,parsePinPepper(env.WORKSTATION_PIN_PEPPER_ID,env.WORKSTATION_PIN_PEPPER))
    : bcrypt.hash(value,PIN_COST),now:()=>Date.now()});
export const {enrollQuickPin,revokeQuickPin}=service;
