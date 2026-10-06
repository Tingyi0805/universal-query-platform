CREATE TABLE uqp.DatasetColumn (
    DatasetId       BIGINT NOT NULL,
    ColumnName      NVARCHAR(256) NOT NULL,
    DataType        NVARCHAR(100) NULL,
    Ordinal         INT NOT NULL,
    UpdatedAtUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_DatasetColumn_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_DatasetColumn PRIMARY KEY (DatasetId, ColumnName),
    CONSTRAINT FK_DatasetColumn_Dataset FOREIGN KEY (DatasetId) REFERENCES uqp.Dataset(Id) ON DELETE CASCADE
);
GO

CREATE TABLE uqp.ReportColumn (
    QueryDefinitionId   BIGINT NOT NULL,
    ColumnName          NVARCHAR(256) NOT NULL,
    DisplayLabel        NVARCHAR(256) NOT NULL,
    DisplayOrder        INT NOT NULL,
    IsVisible           BIT NOT NULL CONSTRAINT DF_ReportColumn_Visible DEFAULT (1),
    Width               INT NULL,
    DisplayFormat       NVARCHAR(100) NULL,
    Alignment           NVARCHAR(10) NOT NULL CONSTRAINT DF_ReportColumn_Alignment DEFAULT ('LEFT'),
    GroupOrder          INT NULL,
    AggregateType       NVARCHAR(10) NOT NULL CONSTRAINT DF_ReportColumn_Aggregate DEFAULT ('NONE'),
    CONSTRAINT PK_ReportColumn PRIMARY KEY (QueryDefinitionId, ColumnName),
    CONSTRAINT FK_ReportColumn_Query FOREIGN KEY (QueryDefinitionId) REFERENCES uqp.QueryDefinition(Id) ON DELETE CASCADE,
    CONSTRAINT CK_ReportColumn_Alignment CHECK (Alignment IN ('LEFT','CENTER','RIGHT')),
    CONSTRAINT CK_ReportColumn_Aggregate CHECK (AggregateType IN ('NONE','SUM','AVG','MIN','MAX','COUNT')),
    CONSTRAINT CK_ReportColumn_Width CHECK (Width IS NULL OR Width BETWEEN 40 AND 1000)
);
GO
