using Dapper;

namespace HFS.Infrastructure.Data;

public record RouteDto(int RouteId, string RouteCode, string? Description);
public record ServiceTypeDto(int ServiceTypeId, string ServiceName, string? GlAccount, bool IsActive);
public record FrequencyCodeDto(string FrequencyCode, string Description, int ChangeFactor);
public record PayTypeDto(int PayTypeId, string PayTypeName);
public record SalesTaxDto(int SalesTaxId, string Description, decimal TaxRate, string? StateCode);
public record OffsetCodeDto(int OffsetCodeId, string OffsetCode, string? Description, int ArOffset);

public class ReferenceDataRepository(SqlConnectionFactory db)
{
    public async Task<IEnumerable<RouteDto>> GetRoutesAsync()
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<RouteDto>(
            db.Sql("SELECT route_id AS RouteId, route_code AS RouteCode, description AS Description FROM {schema}.route ORDER BY route_code"));
    }

    public async Task<IEnumerable<ServiceTypeDto>> GetServiceTypesAsync()
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<ServiceTypeDto>(
            db.Sql("SELECT service_type_id AS ServiceTypeId, service_name AS ServiceName, gl_account AS GlAccount, is_active AS IsActive FROM {schema}.service_type ORDER BY service_name"));
    }

    public async Task<IEnumerable<FrequencyCodeDto>> GetFrequencyCodesAsync()
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<FrequencyCodeDto>(
            db.Sql("SELECT frequency_code AS FrequencyCode, description AS Description, change_factor AS ChangeFactor FROM {schema}.frequency_code ORDER BY change_factor"));
    }

    public async Task<IEnumerable<PayTypeDto>> GetPayTypesAsync()
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<PayTypeDto>(
            db.Sql("SELECT pay_type_id AS PayTypeId, pay_type_name AS PayTypeName FROM {schema}.pay_type ORDER BY pay_type_id"));
    }

    public async Task<IEnumerable<SalesTaxDto>> GetSalesTaxesAsync()
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<SalesTaxDto>(
            db.Sql("SELECT sales_tax_id AS SalesTaxId, description AS Description, tax_rate AS TaxRate, state_code AS StateCode FROM {schema}.sales_tax ORDER BY description"));
    }

    public async Task<IEnumerable<OffsetCodeDto>> GetOffsetCodesAsync()
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<OffsetCodeDto>(
            db.Sql("SELECT offset_code_id AS OffsetCodeId, offset_code AS OffsetCode, description AS Description, ar_offset AS ArOffset FROM {schema}.offset_code ORDER BY offset_code"));
    }
}
