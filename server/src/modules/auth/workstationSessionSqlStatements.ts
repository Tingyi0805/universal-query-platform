/**
 * H0-5B isolated SQL statement contract; NOT a runtime Repository adapter.
 * All values must be bound by a future repository-owned SERIALIZABLE transaction.
 * No pool, network, migration or production path imports this module.
 */
export const deviceRenewalCasSql = `
SET NOCOUNT ON;
DECLARE @changed TABLE (Revision BINARY(8) NOT NULL);
UPDATE ds WITH (UPDLOCK, HOLDLOCK)
SET RenewalCounter = @nextCounter,
    LastActivityAtUtc = @lastActivityUtc,
    IdleExpiresAtUtc = @idleExpiresUtc
OUTPUT INSERTED.RowVersion INTO @changed(Revision)
FROM uqp.SharedWorkstationDeviceSession AS ds
INNER JOIN uqp.SharedWorkstation AS w WITH (UPDLOCK, HOLDLOCK)
  ON w.Id = ds.WorkstationId
INNER JOIN uqp.SharedWorkstationCredential AS c WITH (UPDLOCK, HOLDLOCK)
  ON c.Id = ds.CredentialId AND c.WorkstationId = ds.WorkstationId
WHERE ds.Id = @sessionId
  AND ds.WorkstationId = @workstationId
  AND ds.CredentialId = @credentialId
  AND ds.RowVersion = @expectedRevision
  AND ds.RenewalCounter = @expectedCounter
  AND ds.RenewalCounter < 9223372036854775807
  AND @nextCounter = ds.RenewalCounter + CONVERT(BIGINT, 1)
  AND ds.RevokedAtUtc IS NULL
  AND ds.IdleExpiresAtUtc > SYSUTCDATETIME()
  AND ds.AbsoluteExpiresAtUtc > SYSUTCDATETIME()
  AND @lastActivityUtc >= ds.LastActivityAtUtc
  AND @idleExpiresUtc > @lastActivityUtc
  AND @idleExpiresUtc <= ds.AbsoluteExpiresAtUtc
  AND w.IsActive = 1
  AND w.RetiredAtUtc IS NULL
  AND w.CredentialVersion = ds.BoundCredentialVersion
  AND c.IsRevoked = 0
  AND c.CredentialVersion = ds.BoundCredentialVersion;
SELECT CONVERT(VARCHAR(16), Revision, 2) AS NewRevision FROM @changed;
` as const;

/**
 * Audit insertion is deliberately not included: existing AuditLog schema and
 * mandatory atomic Decision writer must be reviewed before wiring this SQL.
 */
export const renewalCasRequiredBindings = Object.freeze([
  "sessionId", "workstationId", "credentialId", "expectedRevision",
  "expectedCounter", "nextCounter", "lastActivityUtc", "idleExpiresUtc",
] as const);
