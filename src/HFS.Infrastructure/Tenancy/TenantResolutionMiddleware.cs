using System.Security.Claims;
using HFS.Infrastructure.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace HFS.Infrastructure.Tenancy;

public class TenantResolutionMiddleware(RequestDelegate next, ILogger<TenantResolutionMiddleware> logger)
{
    private static readonly System.Text.RegularExpressions.Regex SchemaNamePattern =
        new("^[a-z0-9_]+$", System.Text.RegularExpressions.RegexOptions.Compiled);

    public async Task InvokeAsync(HttpContext context, TenantContext tenantContext, TenantRepository tenantRepo)
    {
        // Skip tenant resolution for paths that don't need it
        var path = context.Request.Path.Value ?? "";
        if (path.StartsWith("/health") || path.StartsWith("/auth/login") || path.StartsWith("/auth/refresh"))
        {
            await next(context);
            return;
        }

        string? slug = null;

        // 1. JWT claim (preferred — set after login)
        var tenantIdClaim = context.User.FindFirst("tenant_slug")?.Value;
        if (!string.IsNullOrEmpty(tenantIdClaim))
            slug = tenantIdClaim;

        // 2. Subdomain: acme.hfs.app → "acme"
        if (slug == null)
        {
            var host = context.Request.Host.Host;
            var parts = host.Split('.');
            if (parts.Length >= 3)
                slug = parts[0];
        }

        // 3. Explicit header (internal tooling / testing)
        if (slug == null)
            slug = context.Request.Headers["X-Tenant-Slug"].FirstOrDefault();

        if (slug == null)
        {
            context.Response.StatusCode = 400;
            await context.Response.WriteAsync("Tenant could not be determined.");
            return;
        }

        var tenant = await tenantRepo.FindBySlugAsync(slug);
        if (tenant == null || !tenant.IsActive)
        {
            context.Response.StatusCode = 404;
            await context.Response.WriteAsync($"Tenant '{slug}' not found or inactive.");
            return;
        }

        if (!SchemaNamePattern.IsMatch(tenant.SchemaName))
        {
            logger.LogError("Tenant {Slug} has invalid schema name '{Schema}'", slug, tenant.SchemaName);
            context.Response.StatusCode = 500;
            await context.Response.WriteAsync("Tenant configuration error.");
            return;
        }

        tenantContext.TenantId = tenant.TenantId;
        tenantContext.SchemaName = tenant.SchemaName;

        await next(context);
    }
}
