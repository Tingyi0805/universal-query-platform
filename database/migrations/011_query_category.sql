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
GO

;WITH ExistingCategories AS (
    SELECT DISTINCT LTRIM(RTRIM(Category)) AS Name
    FROM uqp.QueryDefinition
    WHERE Category IS NOT NULL
      AND LTRIM(RTRIM(Category)) <> ''
)
INSERT INTO uqp.QueryCategory (Code, Name, SortOrder, IsActive)
SELECT
    CONCAT('CAT_', RIGHT('000000' + CAST(ROW_NUMBER() OVER (ORDER BY Name) AS VARCHAR(6)), 6)),
    Name,
    ROW_NUMBER() OVER (ORDER BY Name) * 10,
    1
FROM ExistingCategories;
GO

ALTER TABLE uqp.QueryDefinition
ADD CategoryId BIGINT NULL;
GO

UPDATE q
SET CategoryId = c.Id
FROM uqp.QueryDefinition q
INNER JOIN uqp.QueryCategory c
    ON c.Name = LTRIM(RTRIM(q.Category))
WHERE q.Category IS NOT NULL
  AND LTRIM(RTRIM(q.Category)) <> '';
GO

ALTER TABLE uqp.QueryDefinition
ADD CONSTRAINT FK_QueryDefinition_Category
FOREIGN KEY (CategoryId) REFERENCES uqp.QueryCategory(Id);
GO

CREATE INDEX IX_QueryDefinition_CategoryId
ON uqp.QueryDefinition(CategoryId);
GO
