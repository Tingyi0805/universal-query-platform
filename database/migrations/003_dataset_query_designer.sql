CREATE TABLE uqp.Dataset (
    Id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    Code            NVARCHAR(100) NOT NULL,
    Name            NVARCHAR(200) NOT NULL,
    Description     NVARCHAR(1000) NULL,
    DataSourceId    BIGINT NOT NULL,
    SqlText         NVARCHAR(MAX) NOT NULL,
    MaxRows         INT NOT NULL CONSTRAINT DF_Dataset_MaxRows DEFAULT (500),
    QueryTimeoutSec INT NULL,
    IsActive        BIT NOT NULL CONSTRAINT DF_Dataset_IsActive DEFAULT (1),
    CreatedAtUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_Dataset_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAtUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_Dataset_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_Dataset_Code UNIQUE (Code),
    CONSTRAINT FK_Dataset_DataSource FOREIGN KEY (DataSourceId) REFERENCES uqp.DataSource(Id),
    CONSTRAINT CK_Dataset_MaxRows CHECK (MaxRows BETWEEN 1 AND 10000),
    CONSTRAINT CK_Dataset_QueryTimeout CHECK (QueryTimeoutSec IS NULL OR QueryTimeoutSec BETWEEN 1 AND 3600)
);
GO

CREATE TABLE uqp.DatasetParameter (
    Id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    DatasetId       BIGINT NOT NULL,
    Name            NVARCHAR(100) NOT NULL,
    Label           NVARCHAR(200) NOT NULL,
    DataType        NVARCHAR(20) NOT NULL,
    ControlType     NVARCHAR(30) NOT NULL,
    IsRequired      BIT NOT NULL CONSTRAINT DF_DatasetParameter_Required DEFAULT (0),
    DefaultValue    NVARCHAR(1000) NULL,
    DisplayOrder    INT NOT NULL CONSTRAINT DF_DatasetParameter_Order DEFAULT (0),
    CONSTRAINT FK_DatasetParameter_Dataset FOREIGN KEY (DatasetId) REFERENCES uqp.Dataset(Id) ON DELETE CASCADE,
    CONSTRAINT UQ_DatasetParameter_Name UNIQUE (DatasetId, Name),
    CONSTRAINT CK_DatasetParameter_DataType CHECK (DataType IN ('STRING','NUMBER','DATE','DATETIME','BOOLEAN')),
    CONSTRAINT CK_DatasetParameter_ControlType CHECK (ControlType IN ('TEXT','NUMBER','DATE','DATETIME','SELECT','MULTISELECT','CHECKBOX'))
);
GO
