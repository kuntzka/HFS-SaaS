using DbUp;
using DbUp.Engine;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace HFS.Infrastructure.Migrations;

public class MigrationRunner(IConfiguration config, ILogger<MigrationRunner> logger)
{
    private string ConnectionString => config.GetConnectionString("Default")
        ?? throw new InvalidOperationException("ConnectionStrings:Default not configured.");

    public void RunSharedMigrations()
    {
        var upgrader = DeployChanges.To
            .SqlDatabase(ConnectionString)
            .WithScriptsEmbeddedInAssembly(
                typeof(MigrationRunner).Assembly,
                s => s.Contains(".Scripts.Shared."))
            .WithTransactionPerScript()
            .LogToNowhere()
            .Build();

        var result = upgrader.PerformUpgrade();
        if (!result.Successful)
        {
            logger.LogError(result.Error, "Shared schema migration failed");
            throw new InvalidOperationException("Shared schema migration failed.", result.Error);
        }

        logger.LogInformation("Shared schema migrations applied successfully");
    }

    public void RunTenantMigrations(string schemaName)
    {
        var upgrader = DeployChanges.To
            .SqlDatabase(ConnectionString)
            .WithScriptsEmbeddedInAssembly(
                typeof(MigrationRunner).Assembly,
                s => s.Contains(".Scripts.Tenant."))
            .WithVariablesEnabled()
            .WithVariable("SCHEMA", schemaName)
            // Store DbUp journal in shared schema so it's schema-qualified per tenant
            .JournalToSqlTable("shared", $"dbup_journal_{schemaName}")
            .WithTransactionPerScript()
            .LogToNowhere()
            .Build();

        var result = upgrader.PerformUpgrade();
        if (!result.Successful)
        {
            logger.LogError(result.Error, "Tenant {Schema} migration failed", schemaName);
            throw new InvalidOperationException($"Migration failed for tenant schema '{schemaName}'.", result.Error);
        }

        logger.LogInformation("Tenant {Schema} migrations applied successfully", schemaName);
    }
}
