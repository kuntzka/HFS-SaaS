using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;

namespace HFS.Infrastructure.Data;

public record TenantRecord(Guid TenantId, string Slug, string SchemaName, bool IsActive);

public class TenantRepository(IConfiguration config)
{
    private string ConnectionString => config.GetConnectionString("Default")
        ?? throw new InvalidOperationException("ConnectionStrings:Default not configured.");

    public async Task<TenantRecord?> FindBySlugAsync(string slug)
    {
        await using var conn = new SqlConnection(ConnectionString);
        return await conn.QuerySingleOrDefaultAsync<TenantRecord>(
            "SELECT tenant_id AS TenantId, slug AS Slug, schema_name AS SchemaName, is_active AS IsActive " +
            "FROM shared.tenants WHERE slug = @slug",
            new { slug });
    }

    public async Task<TenantRecord?> FindByIdAsync(Guid tenantId)
    {
        await using var conn = new SqlConnection(ConnectionString);
        return await conn.QuerySingleOrDefaultAsync<TenantRecord>(
            "SELECT tenant_id AS TenantId, slug AS Slug, schema_name AS SchemaName, is_active AS IsActive " +
            "FROM shared.tenants WHERE tenant_id = @tenantId",
            new { tenantId });
    }
}
