-- Dedicated reviewed installer ONLY. Not scanned by db:migrate. No historical grants.
SET XACT_ABORT ON;
IF OBJECT_ID(N'uqp.Dataset',N'U') IS NULL OR COL_LENGTH('uqp.Dataset','DefinitionRowVersion') IS NULL
 OR COL_LENGTH('uqp.DataSource','ConfigurationRowVersion') IS NULL
 OR OBJECT_ID(N'uqp.DatasetPatientAuditConfig',N'U') IS NULL
 OR COL_LENGTH('uqp.DatasetSensitiveColumn','CustomMaskJson') IS NULL
 OR OBJECT_ID(N'uqp.DatasetSensitivePolicyVersion',N'U') IS NULL OR OBJECT_ID(N'uqp.AuditLog',N'U') IS NULL
 THROW 51925,'DISPLAY_BASELINE_REQUIRED',1;
CREATE TABLE uqp.DatasetPublicDisplayPolicy (
 DatasetId BIGINT NOT NULL CONSTRAINT PK_DatasetPublicDisplayPolicy PRIMARY KEY,
 DataSourceId BIGINT NOT NULL,
 DefinitionVersion BINARY(8) NOT NULL,
 ConfigurationVersion BINARY(8) NOT NULL,
 SensitivityVersion BIGINT NOT NULL,
 GrantsJson NVARCHAR(MAX) NOT NULL,
 ConfirmedBy BIGINT NOT NULL,
 ConfirmedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_PublicDisplay_Confirmed DEFAULT SYSUTCDATETIME(),
 UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_PublicDisplay_Updated DEFAULT SYSUTCDATETIME(),
 RequestId UNIQUEIDENTIFIER NOT NULL,
 RequestDigest CHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
 AuditLogId BIGINT NOT NULL,
 RowVersion ROWVERSION NOT NULL,
 CONSTRAINT FK_PublicDisplay_Dataset FOREIGN KEY(DatasetId) REFERENCES uqp.Dataset(Id) ON DELETE CASCADE,
 CONSTRAINT CK_PublicDisplay_Values CHECK(SensitivityVersion>0 AND ConfirmedBy>0 AND AuditLogId>0),
 CONSTRAINT CK_PublicDisplay_Json CHECK(ISJSON(GrantsJson)=1 AND DATALENGTH(GrantsJson)<=262144),
 CONSTRAINT UQ_PublicDisplay_Request UNIQUE(RequestId)
);
CREATE TABLE uqp.DatasetMaskTemplate (
 Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DatasetMaskTemplate PRIMARY KEY,
 Name NVARCHAR(100) COLLATE Latin1_General_100_BIN2 NOT NULL,
 AliasesJson NVARCHAR(4000) NOT NULL,
 MaskMode VARCHAR(16) NOT NULL,
 CustomMaskJson NVARCHAR(256) NULL,
 SuggestedPublicAllowed BIT NOT NULL CONSTRAINT DF_MaskTemplate_Public DEFAULT(0),
 IsActive BIT NOT NULL CONSTRAINT DF_MaskTemplate_Active DEFAULT(1),
 Revision BIGINT NOT NULL CONSTRAINT DF_MaskTemplate_Revision DEFAULT(1),
 CreatedBy BIGINT NULL,
 UpdatedBy BIGINT NULL,
 CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_MaskTemplate_Created DEFAULT SYSUTCDATETIME(),
 UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_MaskTemplate_Updated DEFAULT SYSUTCDATETIME(),
 RowVersion ROWVERSION NOT NULL,
 CONSTRAINT UQ_MaskTemplate_Name UNIQUE(Name),
 CONSTRAINT CK_MaskTemplate_Revision CHECK(Revision>0),
 CONSTRAINT CK_MaskTemplate_Aliases CHECK(ISJSON(AliasesJson)=1),
 CONSTRAINT CK_MaskTemplate_Mode CHECK(MaskMode IN ('NONE','CUSTOM','FULL','OMIT')),
 CONSTRAINT CK_MaskTemplate_Custom CHECK((MaskMode='CUSTOM' AND CustomMaskJson IS NOT NULL AND ISJSON(CustomMaskJson)=1) OR (MaskMode<>'CUSTOM' AND CustomMaskJson IS NULL)),
 CONSTRAINT CK_MaskTemplate_Public CHECK(MaskMode<>'OMIT' OR SuggestedPublicAllowed=0)
);
-- Historical application evidence, not authority. No Dataset FK: retain evidence
-- after Dataset deletion without changing the existing Dataset delete contract.
CREATE TABLE uqp.DatasetMaskTemplateUse (
 Id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_DatasetMaskTemplateUse PRIMARY KEY,
 DatasetId BIGINT NOT NULL,
 ColumnName NVARCHAR(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
 TemplateId BIGINT NOT NULL,
 TemplateRevision BIGINT NOT NULL,
 SensitivityVersion BIGINT NOT NULL,
 AppliedBy BIGINT NOT NULL,
 AppliedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_MaskTemplateUse_Applied DEFAULT SYSUTCDATETIME(),
 CONSTRAINT FK_MaskTemplateUse_Template FOREIGN KEY(TemplateId) REFERENCES uqp.DatasetMaskTemplate(Id),
 CONSTRAINT CK_MaskTemplateUse_Values CHECK(DatasetId>0 AND TemplateRevision>0 AND SensitivityVersion>0 AND AppliedBy>0)
);
CREATE INDEX IX_MaskTemplateUse_Template ON uqp.DatasetMaskTemplateUse(TemplateId,DatasetId) INCLUDE(ColumnName,TemplateRevision,SensitivityVersion);
CREATE INDEX IX_MaskTemplateUse_Dataset ON uqp.DatasetMaskTemplateUse(DatasetId,ColumnName,Id);
-- Suggestions only. Never copy these rows into any Dataset or public confirmation.
INSERT uqp.DatasetMaskTemplate(Name,AliasesJson,MaskMode,CustomMaskJson) VALUES
 (N'患者姓名',N'["姓名","PATIENT_NAME","PATNAME","PAT_NAME"]','CUSTOM',N'{"prefix":1,"suffix":1,"symbol":"○"}'),
 (N'病歷號',N'["病歷號","MRN","REGNO"]','CUSTOM',N'{"prefix":0,"suffix":4,"symbol":"*"}'),
 (N'電話',N'["電話","PHONE","MOBILE"]','CUSTOM',N'{"prefix":3,"suffix":3,"symbol":"○"}'),
 (N'身分證字號',N'["身分證字號","IDNO","NATIONAL_ID"]','OMIT',NULL),
 (N'生日',N'["生日","DOB","BIRTH_DATE"]','OMIT',NULL),
 (N'地址',N'["地址","ADDRESS"]','OMIT',NULL),
 (N'住院床號',N'["BED","BEDNO"]','FULL',NULL),
 (N'診斷資訊',N'["DIAGNOSIS","ICD_CODE"]','OMIT',NULL);
