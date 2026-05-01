using Dapper;
using HFS.Application.Commissions;
using HFS.Domain.Interfaces;
using System.Text.Json;

namespace HFS.Infrastructure.Data;

public record CommissionServiceRow(
    int CustomerSvcId,
    int CustomerId,
    int ServiceTypeId,
    string ServiceTypeName,
    decimal ServicePrice,
    int ServiceQty,
    string FrequencyCode,
    short StartWeek,
    DateOnly? FirstServiceDate,
    int? EmployeeId,
    string EmployeeName,
    string CompanyName,
    int Distance,
    int CustomerType,
    bool YnCommission,
    bool CommissionPaid
);

public record ServiceItemRuleRow(int Id, decimal Rate);
public record ServiceCalcRuleRow(int Id, decimal Percent);
public record ServiceWeekRuleRow(int Id, decimal Percent);
public record AccountMgrRuleRow(int Id, decimal Percent, int PayrollFlag);

public class CommissionRepository(SqlConnectionFactory db, ITenantContext tenantCtx)
{
    public async Task<IEnumerable<CommissionServiceRow>> GetServicesForCommissionAsync(int customerId)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<CommissionServiceRow>(db.Sql("""
            SELECT
                cs.customer_svc_id    AS CustomerSvcId,
                cs.customer_id        AS CustomerId,
                cs.service_type_id    AS ServiceTypeId,
                st.service_name       AS ServiceTypeName,
                cs.service_price      AS ServicePrice,
                cs.service_qty        AS ServiceQty,
                cs.frequency_code     AS FrequencyCode,
                cs.start_week         AS StartWeek,
                cs.first_service_date AS FirstServiceDate,
                c.employee_id         AS EmployeeId,
                ISNULL(e.first_name + ' ' + e.last_name, '') AS EmployeeName,
                c.company_name        AS CompanyName,
                ISNULL(c.distance, 22)   AS Distance,
                ISNULL(c.customer_type, 5) AS CustomerType,
                st.yn_commission      AS YnCommission,
                cs.commission_paid    AS CommissionPaid
            FROM {schema}.customer_service cs
            JOIN {schema}.service_type st ON cs.service_type_id = st.service_type_id
            JOIN {schema}.customer c ON cs.customer_id = c.customer_id
            LEFT JOIN {schema}.employee e ON c.employee_id = e.employee_id
            WHERE cs.customer_id = @customerId AND cs.is_active = 1
            """), new { customerId });
    }

    public async Task<int> GetCustomerIdByInvoiceAsync(int invoiceNumber)
    {
        using var conn = db.CreateConnection();
        return await conn.ExecuteScalarAsync<int>(db.Sql(
            "SELECT customer_id FROM {schema}.invoice WHERE invoice_number = @invoiceNumber"),
            new { invoiceNumber });
    }

    public async Task<int> GetEmployeeExperienceAsync(int employeeId, DateTime serviceDate)
    {
        using var conn = db.CreateConnection();
        var startDate = await conn.ExecuteScalarAsync<DateTime?>(db.Sql(
            "SELECT MIN(start_date) FROM {schema}.employee_activity_period WHERE employee_id = @employeeId"),
            new { employeeId });
        if (!startDate.HasValue) return 0;
        int yrs = serviceDate.Year - startDate.Value.Year;
        if (serviceDate.Month < startDate.Value.Month ||
            (serviceDate.Month == startDate.Value.Month && serviceDate.Day < startDate.Value.Day))
            yrs--;
        return Math.Max(0, yrs);
    }

    // SAC tier 1: item rule by service type + site type (customer type)
    public async Task<ServiceItemRuleRow?> GetServiceItemRuleAsync(int serviceTypeId, int siteType)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<ServiceItemRuleRow>(db.Sql("""
            SELECT id AS Id, rate AS Rate
            FROM {schema}.service_item_rule
            WHERE service_type_id = @serviceTypeId AND site_type = @siteType
            """), new { serviceTypeId, siteType });
    }

    // SAC tier 2: calc rule by service type, distance >= min_distance, seniority >= min_seniority
    public async Task<ServiceCalcRuleRow?> GetServiceCalcRuleAsync(int serviceTypeId, int distance, int seniority)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<ServiceCalcRuleRow>(db.Sql("""
            SELECT id AS Id, [percent] AS Percent
            FROM {schema}.service_calc_rule
            WHERE service_type_id = @serviceTypeId
              AND min_distance <= @distance
              AND min_seniority <= @seniority
            ORDER BY min_seniority DESC, min_distance DESC
            """), new { serviceTypeId, distance, seniority });
    }

    // SAC tier 3: week rule by service type + week range
    public async Task<ServiceWeekRuleRow?> GetServiceWeekRuleAsync(int serviceTypeId, int weekId)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<ServiceWeekRuleRow>(db.Sql("""
            SELECT id AS Id, [percent] AS Percent
            FROM {schema}.service_week_rule
            WHERE service_type_id = @serviceTypeId
              AND start_week <= @weekId AND end_week >= @weekId
            """), new { serviceTypeId, weekId });
    }

    // AMC: one call per fallback level — employeeId=0 means any, serviceTypeId=0 means any, weekId=0 means any range
    public async Task<AccountMgrRuleRow?> GetAccountMgrRuleAsync(int employeeId, int weekId, int serviceTypeId)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryFirstOrDefaultAsync<AccountMgrRuleRow>(db.Sql("""
            SELECT r.id AS Id, d.[percent] AS Percent, d.payroll_flag AS PayrollFlag
            FROM {schema}.account_mgr_rule r
            JOIN {schema}.account_mgr_rule_detail d ON r.id = d.account_mgr_rule_id
            WHERE r.employee_id = @employeeId
              AND d.start_week <= @weekId AND d.end_week >= @weekId
              AND r.service_type_id = @serviceTypeId
            """), new { employeeId, weekId, serviceTypeId });
    }

    public async Task<IReadOnlyList<int>> GetExcludedEmployeeIdsAsync()
    {
        using var conn = db.CreateConnection();
        var json = await conn.ExecuteScalarAsync<string?>(
            "SELECT excluded_employee_ids FROM shared.tenant_settings WHERE tenant_id = @tenantId",
            new { tenantId = tenantCtx.TenantId });
        if (string.IsNullOrEmpty(json)) return [];
        return JsonSerializer.Deserialize<List<int>>(json) ?? [];
    }

    public async Task DeleteExistingCommissionsAsync(
        int invoiceNumber, int customerSvcId, string employeeName,
        int payrollType, string serviceTypeName, string frequencyCode, short startWeek)
    {
        using var conn = db.CreateConnection();
        await conn.ExecuteAsync(db.Sql("""
            DELETE FROM {schema}.commission
            WHERE invoice_number = @invoiceNumber
              AND customer_svc_id = @customerSvcId
              AND employee_name = @employeeName
              AND payroll_type = @payrollType
              AND service_type_name = @serviceTypeName
              AND frequency_code = @frequencyCode
              AND start_week = @startWeek
            """), new { invoiceNumber, customerSvcId, employeeName, payrollType, serviceTypeName, frequencyCode, startWeek });
    }

    public async Task InsertCommissionAsync(
        int invoiceNumber, int customerSvcId, int customerId, string companyName,
        int? employeeId, string employeeName, int payrollType, decimal commissionAmount,
        decimal servicePrice, string serviceTypeName, DateOnly serviceDate,
        int weekNumber, string frequencyCode, short startWeek)
    {
        using var conn = db.CreateConnection();
        await conn.ExecuteAsync(db.Sql("""
            INSERT INTO {schema}.commission
                (invoice_number, customer_svc_id, customer_id, company_name,
                 employee_id, employee_name, payroll_type, commission_amount,
                 service_price, service_type_name, service_date,
                 week_number, frequency_code, start_week, calculated_at)
            VALUES
                (@invoiceNumber, @customerSvcId, @customerId, @companyName,
                 @employeeId, @employeeName, @payrollType, @commissionAmount,
                 @servicePrice, @serviceTypeName, @serviceDate,
                 @weekNumber, @frequencyCode, @startWeek, GETUTCDATE())
            """), new {
                invoiceNumber, customerSvcId, customerId, companyName,
                employeeId, employeeName, payrollType, commissionAmount,
                servicePrice, serviceTypeName, serviceDate, weekNumber, frequencyCode, startWeek
            });
    }

    public async Task UpdateFirstCommissionFlagAsync(int customerSvcId)
    {
        using var conn = db.CreateConnection();
        await conn.ExecuteAsync(db.Sql("""
            UPDATE {schema}.customer_service
            SET commission_paid = 1
            WHERE customer_svc_id = @customerSvcId
            """), new { customerSvcId });
    }

    public async Task<IEnumerable<CommissionListItem>> GetByInvoiceAsync(int invoiceNumber)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<CommissionListItem>(db.Sql("""
            SELECT id AS Id, invoice_number AS InvoiceNumber, customer_id AS CustomerId,
                   company_name AS CompanyName, employee_id AS EmployeeId,
                   employee_name AS EmployeeName, payroll_type AS PayrollType,
                   commission_amount AS CommissionAmount, service_price AS ServicePrice,
                   service_type_name AS ServiceTypeName, service_date AS ServiceDate,
                   week_number AS WeekNumber, frequency_code AS FrequencyCode, start_week AS StartWeek
            FROM {schema}.commission
            WHERE invoice_number = @invoiceNumber
            ORDER BY id
            """), new { invoiceNumber });
    }

    public async Task<IEnumerable<CommissionListItem>> GetByDateRangeAsync(
        DateOnly from, DateOnly to, int? payrollType)
    {
        using var conn = db.CreateConnection();
        var sql = """
            SELECT id AS Id, invoice_number AS InvoiceNumber, customer_id AS CustomerId,
                   company_name AS CompanyName, employee_id AS EmployeeId,
                   employee_name AS EmployeeName, payroll_type AS PayrollType,
                   commission_amount AS CommissionAmount, service_price AS ServicePrice,
                   service_type_name AS ServiceTypeName, service_date AS ServiceDate,
                   week_number AS WeekNumber, frequency_code AS FrequencyCode, start_week AS StartWeek
            FROM {schema}.commission
            WHERE service_date >= @from AND service_date <= @to
            """;
        if (payrollType.HasValue) sql += " AND payroll_type = @payrollType";
        sql += " ORDER BY service_date, company_name";
        return await conn.QueryAsync<CommissionListItem>(db.Sql(sql), new { from, to, payrollType });
    }

    public async Task DeleteByInvoiceAsync(int invoiceNumber)
    {
        using var conn = db.CreateConnection();
        await conn.ExecuteAsync(db.Sql(
            "DELETE FROM {schema}.commission WHERE invoice_number = @invoiceNumber"),
            new { invoiceNumber });
    }

    public async Task<string> GetEmployeeNameAsync(int employeeId)
    {
        using var conn = db.CreateConnection();
        return await conn.ExecuteScalarAsync<string?>(db.Sql(
            "SELECT first_name + ' ' + last_name FROM {schema}.employee WHERE employee_id = @employeeId"),
            new { employeeId }) ?? "";
    }
}
