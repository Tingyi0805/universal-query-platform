-- Dataset-level sensitivity policy. Apply after the existing Dataset schema migrations.
IF OBJECT_ID(N'uqp.Dataset', N'U') IS NULL
    THROW 51011, 'DATASET_MIGRATION_REQUIRED', 1;
IF OBJECT_ID(N'uqp.DatasetSensitiveColumn', N'U') IS NULL
BEGIN
    CREATE TABLE uqp.DatasetSensitiveColumn (
        DatasetId BIGINT NOT NULL,
        ColumnName NVARCHAR(256) NOT NULL,
        SensitivityType NVARCHAR(64) NOT NULL,
        DeviceMaskMode VARCHAR(16) NOT NULL,
        UpdatedByUserId BIGINT NULL,
        UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_DatasetSensitiveColumn_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_DatasetSensitiveColumn PRIMARY KEY (DatasetId, ColumnName),
        CONSTRAINT FK_DatasetSensitiveColumn_Dataset FOREIGN KEY (DatasetId) REFERENCES uqp.Dataset(Id),
        CONSTRAINT CK_DatasetSensitiveColumn_Mask CHECK (DeviceMaskMode IN ('NONE','NAME','MRN','PHONE','GENERIC','FULL','OMIT')),
        CONSTRAINT CK_DatasetSensitiveColumn_SensitiveNotRaw CHECK (SensitivityType='OTHER' OR DeviceMaskMode <> 'NONE')
    );
END;
