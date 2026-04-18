using HFS.Domain.Interfaces;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;

namespace HFS.Infrastructure.Data;

/// <summary>
/// Opens a SQL connection and replaces {schema} placeholder in queries with the current tenant's schema name.
/// </summary>
public class SqlConnectionFactory(IConfiguration config, ITenantContext tenantContext)
{
    private string ConnectionString => config.GetConnectionString("Default")
        ?? throw new InvalidOperationException("ConnectionStrings:Default not configured.");

    public SqlConnection CreateConnection()
    {
        return new SqlConnection(ConnectionString);
    }

    /// <summary>
    /// Substitutes the {schema} placeholder with the current tenant's validated schema name.
    /// Schema names are validated to [a-z0-9_]+ in TenantResolutionMiddleware before being stored.
    /// </summary>
    public string Sql(string sql) => sql.Replace("{schema}", tenantContext.SchemaName);
}
