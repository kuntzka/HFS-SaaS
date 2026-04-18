IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'shared')
    EXEC('CREATE SCHEMA shared');

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID('shared.tenants'))
BEGIN
    CREATE TABLE shared.tenants (
        tenant_id    UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        slug         NVARCHAR(100)    NOT NULL,
        display_name NVARCHAR(255)    NOT NULL,
        schema_name  NVARCHAR(100)    NOT NULL,
        is_active    BIT              NOT NULL DEFAULT 1,
        created_at   DATETIME2        NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT uq_tenants_slug        UNIQUE (slug),
        CONSTRAINT uq_tenants_schema_name UNIQUE (schema_name)
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE object_id = OBJECT_ID('shared.tenant_settings'))
BEGIN
    CREATE TABLE shared.tenant_settings (
        tenant_id              UNIQUEIDENTIFIER NOT NULL PRIMARY KEY
                                   REFERENCES shared.tenants(tenant_id),
        gl_cash_acct           NVARCHAR(20)     NOT NULL DEFAULT '11100',
        excluded_employee_ids  NVARCHAR(MAX)    NOT NULL DEFAULT '[]',
        accounting_adapter     NVARCHAR(50)     NOT NULL DEFAULT 'HfsLegacyCsv'
    );
END
