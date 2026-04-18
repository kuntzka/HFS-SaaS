using HFS.Domain.Interfaces;
using HFS.Infrastructure.Data;
using HFS.Infrastructure.Migrations;
using HFS.Infrastructure.Tenancy;
using Microsoft.Extensions.DependencyInjection;

namespace HFS.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services)
    {
        // Tenant context is scoped — one per HTTP request
        services.AddScoped<TenantContext>();
        services.AddScoped<ITenantContext>(sp => sp.GetRequiredService<TenantContext>());

        services.AddScoped<TenantRepository>();
        services.AddScoped<SqlConnectionFactory>();
        services.AddSingleton<MigrationRunner>();

        return services;
    }
}
