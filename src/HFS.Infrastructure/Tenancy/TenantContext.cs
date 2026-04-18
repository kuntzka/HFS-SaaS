using HFS.Domain.Interfaces;

namespace HFS.Infrastructure.Tenancy;

public class TenantContext : ITenantContext
{
    public Guid TenantId { get; set; }
    public string SchemaName { get; set; } = string.Empty;
}
