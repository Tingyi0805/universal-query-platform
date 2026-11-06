// Read-only 926 catalog attestation. D1 does not gate or modify existing playback APIs.
export const deviceLifecycleSchemaSql = `
IF OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U') IS NULL
 THROW 51926,'DEVICE_LIFECYCLE_SCHEMA_REQUIRED',1;
IF (SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID(N'uqp.DashboardDisplayDevice') AND
 ((name=N'SuspendedAtUtc' AND system_type_id=42 AND user_type_id=42 AND scale=0 AND is_nullable=1 AND is_computed=0 AND default_object_id=0)
 OR (name=N'ReenrollmentRequired' AND system_type_id=104 AND user_type_id=104 AND is_nullable=1 AND is_computed=0 AND default_object_id=0)))<>2
 THROW 51926,'DEVICE_LIFECYCLE_COLUMN_CONFLICT',1;
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DashboardDisplayDevice')
 AND name=N'CK_DashboardDevice_LifecycleTerminal' AND is_disabled=0 AND is_not_trusted=0 AND is_not_for_replication=0
 AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(definition,N'[',N''),N']',N''),N'(',N''),N')',N''),N' ',N''),CHAR(13),N''),CHAR(10),N''),CHAR(9),N''))=N'casewhenrevokedatutcisnotnullandisactive<>0then0whenarchivedatutcisnotnullandisactive<>0then0else1end=1')
 THROW 51926,'DEVICE_LIFECYCLE_CONSTRAINT_CONFLICT',1;
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DashboardDisplayDevice')
 AND name=N'CK_DashboardDevice_LifecycleSuspended' AND is_disabled=0 AND is_not_trusted=0 AND is_not_for_replication=0
 AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(definition,N'[',N''),N']',N''),N'(',N''),N')',N''),N' ',N''),CHAR(13),N''),CHAR(10),N''),CHAR(9),N''))=N'casewhensuspendedatutcisnullthen1whenisactive=0andrevokedatutcisnullandarchivedatutcisnullandreenrollmentrequired=1andquerymodegrantversionisnullanddelegatortokenversionisnullthen1else0end=1')
 THROW 51926,'DEVICE_LIFECYCLE_CONSTRAINT_CONFLICT',1;
IF NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DashboardDisplayDevice')
 AND name=N'CK_DashboardDevice_LifecycleEnrollment' AND is_disabled=0 AND is_not_trusted=0 AND is_not_for_replication=0
 AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(definition,N'[',N''),N']',N''),N'(',N''),N')',N''),N' ',N''),CHAR(13),N''),CHAR(10),N''),CHAR(9),N''))=N'casewhenreenrollmentrequiredisnullthen1whenrevokedatutcisnotnullthen0whenarchivedatutcisnotnullthen0whensuspendedatutcisnotnullthen1whenisactive=1then1else0end=1')
 THROW 51926,'DEVICE_LIFECYCLE_CONSTRAINT_CONFLICT',1;
IF NOT EXISTS(SELECT 1 FROM sys.triggers t JOIN sys.sql_modules m ON m.object_id=t.object_id
 WHERE t.object_id=OBJECT_ID(N'uqp.TR_DashboardDevice_Lifecycle',N'TR')
 AND t.parent_id=OBJECT_ID(N'uqp.DashboardDisplayDevice') AND t.is_disabled=0 AND t.is_instead_of_trigger=0 AND t.is_not_for_replication=0
 AND (SELECT COUNT(*) FROM sys.trigger_events WHERE object_id=t.object_id)=1
 AND EXISTS(SELECT 1 FROM sys.trigger_events WHERE object_id=t.object_id AND type_desc=N'UPDATE')
 AND HASHBYTES('SHA2_256',LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(m.definition,N'[',N''),N']',N''),N' ',N''),CHAR(13),N''),CHAR(10),N''),CHAR(9),N'')))=0x0f3259251e812fdc2e3acc303e0c469cf2aaf4590035099336da72b0dae4abfb)
 THROW 51926,'DEVICE_LIFECYCLE_TRIGGER_CONFLICT',1;
`;

export async function requireDeviceLifecycleSchema(request: {query(sql: string): Promise<unknown>}) {
  await request.query(deviceLifecycleSchemaSql);
}
