-- Read-only post-deployment verification for migration 910.
-- Run in the platform database after applying 910. No patient data is queried.
SET NOCOUNT ON;
IF OBJECT_ID(N'uqp.DatasetSensitiveColumn', N'U') IS NULL
    THROW 51101, 'MISSING_DATASET_SENSITIVE_COLUMN', 1;
IF OBJECT_ID(N'uqp.DatasetSensitivePolicyVersion', N'U') IS NULL
    THROW 51102, 'MISSING_DATASET_SENSITIVE_POLICY_VERSION', 1;
IF OBJECT_ID(N'uqp.AuditLog', N'U') IS NULL
    THROW 51103, 'MISSING_AUDIT_LOG', 1;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'uqp.DatasetSensitiveColumn') AND name=N'IX_DatasetSensitiveColumn_Type')
    THROW 51104, 'MISSING_SENSITIVITY_TYPE_INDEX', 1;
IF EXISTS (
    SELECT 1 FROM uqp.DatasetSensitiveColumn
    WHERE SensitivityType <> 'OTHER' AND DeviceMaskMode='NONE'
)
    THROW 51105, 'SENSITIVE_COLUMN_WITH_RAW_DEVICE_MASK', 1;
IF EXISTS (
    SELECT 1 FROM uqp.DatasetSensitivePolicyVersion
    WHERE VersionNumber < 0
)
    THROW 51106, 'INVALID_SENSITIVITY_VERSION', 1;
IF EXISTS (
    SELECT 1 FROM uqp.DatasetSensitiveColumn AS c
    LEFT JOIN uqp.Dataset AS d ON d.Id=c.DatasetId
    WHERE d.Id IS NULL
)
    THROW 51107, 'ORPHAN_SENSITIVITY_RULE', 1;
SELECT N'PASS' AS VerificationStatus,
       (SELECT COUNT_BIG(*) FROM uqp.DatasetSensitiveColumn) AS SensitiveColumnRuleCount,
       (SELECT COUNT_BIG(*) FROM uqp.DatasetSensitivePolicyVersion) AS VersionRowCount;
