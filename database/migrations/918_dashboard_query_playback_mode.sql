-- Additive mode state; no activation, credential change or data conversion.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    IF COL_LENGTH(N'uqp.Dashboard',N'QuerySourceMaxRows') IS NULL
       OR COL_LENGTH(N'uqp.DashboardDataSource',N'QueryDefinitionId') IS NULL
        THROW 51018, 'DASHBOARD_QUERY_SOURCE_917_REQUIRED', 1;
    IF COL_LENGTH(N'uqp.Dashboard',N'QueryMode') IS NOT NULL
       OR COL_LENGTH(N'uqp.Dashboard',N'QueryModeVersion') IS NOT NULL
       OR COL_LENGTH(N'uqp.DashboardDisplayDevice',N'QueryModeGrantVersion') IS NOT NULL
       OR COL_LENGTH(N'uqp.DashboardDisplayDevice',N'DelegatorTokenVersion') IS NOT NULL
        THROW 51018, 'DASHBOARD_QUERY_MODE_ALREADY_OR_PARTIALLY_INSTALLED', 1;
    EXEC sys.sp_executesql N'
      ALTER TABLE uqp.Dashboard ADD
        QueryMode VARCHAR(24) NOT NULL CONSTRAINT DF_Dashboard_QueryMode DEFAULT (''LEGACY''),
        QueryModeVersion BIGINT NOT NULL CONSTRAINT DF_Dashboard_QueryModeVersion DEFAULT (0);
      ALTER TABLE uqp.Dashboard WITH CHECK ADD CONSTRAINT CK_Dashboard_QueryMode
        CHECK (QueryMode IN (''LEGACY'',''QUERY_ONLY'',''QUERY_ONLY_DISABLED'') AND
               QueryModeVersion >= 0 AND (QueryMode=''LEGACY'' OR QueryModeVersion > 0));
      ALTER TABLE uqp.DashboardDisplayDevice ADD QueryModeGrantVersion BIGINT NULL, DelegatorTokenVersion BIGINT NULL;
      ALTER TABLE uqp.DashboardDisplayDevice WITH CHECK ADD CONSTRAINT CK_DashboardDevice_QueryModeGrant
        CHECK ((QueryModeGrantVersion IS NULL AND DelegatorTokenVersion IS NULL) OR
          (QueryModeGrantVersion IS NOT NULL AND DelegatorTokenVersion IS NOT NULL AND QueryModeGrantVersion > 0 AND DelegatorTokenVersion > 0));
    ';
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
