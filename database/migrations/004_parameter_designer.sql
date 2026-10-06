ALTER TABLE uqp.DatasetParameter ADD
    Placeholder         NVARCHAR(200) NULL,
    HelpText            NVARCHAR(500) NULL,
    OptionMode          NVARCHAR(20) NOT NULL CONSTRAINT DF_DatasetParameter_OptionMode DEFAULT ('NONE'),
    FixedOptionsJson    NVARCHAR(MAX) NULL,
    LookupDatasetId     BIGINT NULL,
    LookupValueField    NVARCHAR(128) NULL,
    LookupLabelField    NVARCHAR(128) NULL;
GO

ALTER TABLE uqp.DatasetParameter
ADD CONSTRAINT CK_DatasetParameter_OptionMode
CHECK (OptionMode IN ('NONE','FIXED','DATASET'));
GO

ALTER TABLE uqp.DatasetParameter
ADD CONSTRAINT FK_DatasetParameter_LookupDataset
FOREIGN KEY (LookupDatasetId) REFERENCES uqp.Dataset(Id);
GO
