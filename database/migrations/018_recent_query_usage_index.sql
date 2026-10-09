IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name='IX_AuditLog_User_Query_Event_Status_CreatedAtUtc'
      AND object_id=OBJECT_ID('uqp.AuditLog')
)
BEGIN
    CREATE INDEX IX_AuditLog_User_Query_Event_Status_CreatedAtUtc
    ON uqp.AuditLog (
        UserId,
        QueryDefinitionId,
        EventType,
        Status,
        CreatedAtUtc DESC
    )
    WHERE UserId IS NOT NULL
      AND QueryDefinitionId IS NOT NULL;
END
GO
