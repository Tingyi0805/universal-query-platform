CREATE TABLE uqp.DataSource (
    Id                      BIGINT IDENTITY(1,1) PRIMARY KEY,
    Code                    NVARCHAR(100) NOT NULL,
    Name                    NVARCHAR(200) NOT NULL,
    Type                    NVARCHAR(20) NOT NULL,
    Host                    NVARCHAR(255) NOT NULL,
    Port                    INT NOT NULL,
    DatabaseName            NVARCHAR(255) NULL,
    OracleServiceName       NVARCHAR(255) NULL,
    OracleConnectionMode    NVARCHAR(20) NULL,
    Username                NVARCHAR(200) NOT NULL,
    EncryptedPassword       NVARCHAR(2000) NOT NULL,
    ConnectionTimeoutSec    INT NOT NULL CONSTRAINT DF_DataSource_ConnectionTimeout DEFAULT (10),
    QueryTimeoutSec         INT NOT NULL CONSTRAINT DF_DataSource_QueryTimeout DEFAULT (30),
    EncryptConnection       BIT NOT NULL CONSTRAINT DF_DataSource_Encrypt DEFAULT (0),
    TrustServerCertificate  BIT NOT NULL CONSTRAINT DF_DataSource_TrustCertificate DEFAULT (1),
    IsActive                BIT NOT NULL CONSTRAINT DF_DataSource_IsActive DEFAULT (1),
    CreatedAtUtc            DATETIME2(0) NOT NULL CONSTRAINT DF_DataSource_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAtUtc            DATETIME2(0) NOT NULL CONSTRAINT DF_DataSource_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_DataSource_Code UNIQUE (Code),
    CONSTRAINT CK_DataSource_Type CHECK (Type IN ('SQLSERVER','ORACLE')),
    CONSTRAINT CK_DataSource_OracleMode CHECK (
      OracleConnectionMode IS NULL OR OracleConnectionMode IN ('SERVICE_NAME','SID')
    ),
    CONSTRAINT CK_DataSource_Port CHECK (Port BETWEEN 1 AND 65535),
    CONSTRAINT CK_DataSource_ConnectionTimeout CHECK (ConnectionTimeoutSec BETWEEN 1 AND 300),
    CONSTRAINT CK_DataSource_QueryTimeout CHECK (QueryTimeoutSec BETWEEN 1 AND 3600)
);
GO
