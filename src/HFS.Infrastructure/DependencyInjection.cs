using Dapper;
using HFS.Application.Interfaces;
using HFS.Domain.Interfaces;
using HFS.Infrastructure.Background;
using HFS.Infrastructure.Data;
using HFS.Infrastructure.Export;
using HFS.Infrastructure.Identity;
using HFS.Infrastructure.Migrations;
using HFS.Infrastructure.Reporting;
using HFS.Infrastructure.Tenancy;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace HFS.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration config)
    {
        SqlMapper.AddTypeHandler(new DateOnlyTypeHandler());
        SqlMapper.AddTypeHandler(new NullableDateOnlyTypeHandler());

        // Tenant context — scoped per HTTP request
        services.AddScoped<TenantContext>();
        services.AddScoped<ITenantContext>(sp => sp.GetRequiredService<TenantContext>());

        services.AddScoped<TenantRepository>();
        services.AddScoped<SqlConnectionFactory>();
        services.AddScoped<CustomerRepository>();
        services.AddScoped<ReferenceDataRepository>();
        services.AddScoped<ScheduleRepository>();
        services.AddScoped<InvoiceRepository>();
        services.AddScoped<CommissionRepository>();
        services.AddScoped<InventoryRepository>();
        services.AddScoped<EmployeeRepository>();
        services.AddScoped<ReportRepository>();
        services.AddScoped<ReportService>();
        services.AddScoped<ExportRepository>();
        services.AddScoped<IAccountingExportAdapter, HfsLegacyCsvAdapter>();
        services.AddScoped<ExportService>();
        services.AddHostedService<InventoryCheckService>();
        services.AddSingleton<MigrationRunner>();
        services.AddScoped<JwtTokenService>();

        // Identity DbContext — uses tenant schema, one cached model per schema
        services.AddDbContext<HfsIdentityDbContext>(options =>
        {
            options.UseSqlServer(config.GetConnectionString("Default"));
            options.ReplaceService<IModelCacheKeyFactory, TenantModelCacheKeyFactory>();
        });

        services.AddIdentityCore<HfsUser>(opt =>
            {
                opt.Password.RequireDigit = true;
                opt.Password.RequiredLength = 8;
                opt.Password.RequireNonAlphanumeric = false;
            })
            .AddRoles<IdentityRole>()
            .AddEntityFrameworkStores<HfsIdentityDbContext>()
            .AddDefaultTokenProviders();

        return services;
    }
}
