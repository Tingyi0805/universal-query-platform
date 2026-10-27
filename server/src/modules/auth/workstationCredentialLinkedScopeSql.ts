/**
 * H0-5C-2J: conservative SQL scope discovery (read-only).
 * 926 operator state links ONE current legacy operator session to the device.
 * This does not prove ownership of all other legacy sessions or mixed writers.
 * No UPDATE, DELETE, route or runtime authority is provided.
 */
export const credentialLinkedOperatorScopeSql = Object.freeze({
  lockScopedOperator: `
SELECT CONVERT(VARCHAR(20), os.WorkstationId) AS WorkstationId,
       CONVERT(VARCHAR(36), os.DeviceSessionId) AS DeviceSessionId,
       CONVERT(VARCHAR(36), os.OperatorSessionId) AS OperatorSessionId,
       CONVERT(VARCHAR(20), os.Generation) AS Generation,
       CONVERT(VARCHAR(36), os.Incarnation) AS Incarnation,
       LOWER(CONVERT(VARCHAR(16),os.RowVersion,2)) AS Revision
FROM uqp.SharedWorkstationOperatorState os WITH (UPDLOCK,HOLDLOCK)
JOIN uqp.SharedWorkstationDeviceSession ds WITH (UPDLOCK,HOLDLOCK)
  ON ds.Id=os.DeviceSessionId AND ds.WorkstationId=os.WorkstationId
WHERE os.WorkstationId=CONVERT(BIGINT,@workstationId)
  AND ds.CredentialId=@credentialId;`,
  lockLinkedLegacy: `
SELECT CONVERT(VARCHAR(36), ls.Id) AS SessionId
FROM uqp.SharedWorkstationSession ls WITH (UPDLOCK,HOLDLOCK)
JOIN uqp.SharedWorkstationOperatorState os WITH (UPDLOCK,HOLDLOCK)
  ON os.OperatorSessionId=ls.Id AND os.WorkstationId=ls.WorkstationId
JOIN uqp.SharedWorkstationDeviceSession ds WITH (UPDLOCK,HOLDLOCK)
  ON ds.Id=os.DeviceSessionId AND ds.WorkstationId=os.WorkstationId
WHERE os.WorkstationId=CONVERT(BIGINT,@workstationId)
  AND ds.CredentialId=@credentialId AND ls.RevokedAtUtc IS NULL;`,
  legacyCoverage: "ONLY_CURRENT_LINKED_OPERATOR" as const,
  unlinkedLegacySessionsProven: false as const,
  allHistoricalSessionsMapped: false as const,
  transactionWriterReady: false as const,
  runtimeEnabled: false as const,
});
