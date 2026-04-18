namespace HFS.Domain.Interfaces;

public interface ITenantContext
{
    Guid TenantId { get; }
    string SchemaName { get; }
}
