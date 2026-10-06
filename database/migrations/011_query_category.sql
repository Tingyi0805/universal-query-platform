IF OBJECT_ID('uqp.QueryCategory', 'U') IS NULL
BEGIN
    CREATE TABLE uqp.QueryCategory (
        Id              BIGINT IDENTITY(1,1) PRIMARY KEY,
        Code            NVARCHAR(100) NOT NULL,
        Name            NVARCHAR(100) NOT NULL,
        SortOrder       INT NOT NULL CONSTRAINT DF_QueryCategory_SortOrder DEFAULT (0),
        IsActive        BIT NOT NULL CONSTRAINT DF_QueryCategory_Active DEFAULT (1),
        CreatedAtUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_QueryCategory_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAtUtc    DATETIME2(0) NOT NULL CONSTRAINT DF_QueryCategory_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT UQ_QueryCategory_Code UNIQUE (Code),
        CONSTRAINT UQ_QueryCategory_Name UNIQUE (Name)
    );
END
GO

;WITH ExistingCategories AS (
    SELECT DISTINCT LTRIM(RTRIM(Category)) AS Name
    FROM uqp.QueryDefinition
    WHERE Category IS NOT NULL
      AND LTRIM(RTRIM(Category)) <> ''
),
MissingCategories AS (
    SELECT e.Name,
           ROW_NUMBER() OVER (ORDER BY e.Name) AS RowNo
    FROM ExistingCategories e
    WHERE NOT EXISTS (
        SELECT 1
        FROM uqp.QueryCategory c
        WHERE c.Name = e.Name
    )
)
INSERT INTO uqp.QueryCategory (Code, Name, SortOrder, IsActive)
SELECT
    CONCAT('CAT_', FORMAT(ABS(CHECKSUM(NEWID())), '0000000000')),
    Name,
    RowNo * 10,
    1
FROM MissingCategories;
GO

IF COL_LENGTH('uqp.QueryDefinition', 'CategoryId') IS NULL
BEGIN
    ALTER TABLE uqp.QueryDefinition
    ADD CategoryId BIGINT NULL;
END
GO

UPDATE q
SET CategoryId = c.Id
FROM uqp.QueryDefinition q
INNER JOIN uqp.QueryCategory c
    ON c.Name = LTRIM(RTRIM(q.Category))
WHERE q.CategoryId IS NULL
  AND q.Category IS NOT NULL
  AND LTRIM(RTRIM(q.Category)) <> '';
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_QueryDefinition_Category'
      AND parent_object_id = OBJECT_ID('uqp.QueryDefinition')
)
BEGIN
    ALTER TABLE uqp.QueryDefinition
    ADD CONSTRAINT FK_QueryDefinition_Category
    FOREIGN KEY (CategoryId) REFERENCES uqp.QueryCategory(Id);
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_QueryDefinition_CategoryId'
      AND object_id = OBJECT_ID('uqp.QueryDefinition')
)
BEGIN
    CREATE INDEX IX_QueryDefinition_CategoryId
    ON uqp.QueryDefinition(CategoryId);
END
GO
