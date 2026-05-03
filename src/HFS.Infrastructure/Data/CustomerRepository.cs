using Dapper;
using HFS.Domain.Entities;

namespace HFS.Infrastructure.Data;

public record CustomerListItem(
    int CustomerId,
    string CompanyName,
    string? Phone,
    string? RouteCode,
    string? PayTypeName,
    bool IsActive);

public record CustomerDetail(
    int CustomerId,
    string CompanyName,
    string? Address1,
    string? Address2,
    string? City,
    string? StateCode,
    string? Zip,
    string? BillingAddress1,
    string? BillingAddress2,
    string? BillingCity,
    string? BillingStateCode,
    string? BillingZip,
    string? Phone,
    int? PayTypeId,
    string? PayTypeName,
    int? RouteId,
    string? RouteCode,
    int? EmployeeId,
    string? EmployeeName,
    int? OffsetCodeId,
    string? OffsetCode,
    int ArOffset,
    int? Distance,
    int CustomerType,
    bool CallFirst,
    bool IsTest,
    bool IsConsolidatedBilling,
    bool IsActive,
    DateTime CreatedAt);

public record CustomerServiceDetail(
    int CustomerSvcId,
    int CustomerId,
    int ServiceTypeId,
    string ServiceName,
    string FrequencyCode,
    string FrequencyDescription,
    decimal ServicePrice,
    int ServiceQty,
    short StartWeek,
    DateOnly? FirstServiceDate,
    DateOnly? LastServiceDate,
    int? SalesTaxId,
    string? TaxDescription,
    bool CommissionPaid,
    string? Comments,
    bool IsActive);

public class CustomerRepository(SqlConnectionFactory db)
{
    private const string CustomerJoins = """
        FROM {schema}.customer c
        LEFT JOIN {schema}.route r       ON c.route_id = r.route_id
        LEFT JOIN {schema}.pay_type p    ON c.pay_type_id = p.pay_type_id
        LEFT JOIN {schema}.employee e    ON c.employee_id = e.employee_id
        LEFT JOIN {schema}.offset_code o ON c.offset_code_id = o.offset_code_id
        """;

    public async Task<IEnumerable<CustomerListItem>> SearchAsync(string? search, bool includeInactive = false)
    {
        using var conn = db.CreateConnection();
        var where = includeInactive ? "" : "AND c.is_active = 1";
        if (!string.IsNullOrWhiteSpace(search))
            where += " AND c.company_name LIKE @search + '%'";

        return await conn.QueryAsync<CustomerListItem>(
            db.Sql($"""
                SELECT c.customer_id AS CustomerId, c.company_name AS CompanyName,
                       c.phone AS Phone, r.route_code AS RouteCode,
                       p.pay_type_name AS PayTypeName, c.is_active AS IsActive
                {CustomerJoins}
                WHERE 1=1 {where}
                ORDER BY c.company_name
                """),
            new { search });
    }

    public async Task<CustomerDetail?> GetByIdAsync(int customerId)
    {
        using var conn = db.CreateConnection();
        return await conn.QuerySingleOrDefaultAsync<CustomerDetail>(
            db.Sql($"""
                SELECT c.customer_id AS CustomerId, c.company_name AS CompanyName,
                       c.address1 AS Address1, c.address2 AS Address2,
                       c.city AS City, c.state_code AS StateCode, c.zip AS Zip,
                       c.billing_address1 AS BillingAddress1, c.billing_address2 AS BillingAddress2,
                       c.billing_city AS BillingCity, c.billing_state_code AS BillingStateCode,
                       c.billing_zip AS BillingZip, c.phone AS Phone,
                       c.pay_type_id AS PayTypeId, p.pay_type_name AS PayTypeName,
                       c.route_id AS RouteId, r.route_code AS RouteCode,
                       c.employee_id AS EmployeeId,
                       CASE WHEN e.employee_id IS NULL THEN NULL
                            ELSE e.first_name + ' ' + e.last_name END AS EmployeeName,
                       c.offset_code_id AS OffsetCodeId, o.offset_code AS OffsetCode,
                       c.ar_offset AS ArOffset, c.distance AS Distance,
                       c.customer_type AS CustomerType, c.call_first AS CallFirst,
                       c.is_test AS IsTest, c.is_consolidated_billing AS IsConsolidatedBilling,
                       c.is_active AS IsActive, c.created_at AS CreatedAt
                {CustomerJoins}
                WHERE c.customer_id = @customerId
                """),
            new { customerId });
    }

    public async Task<int> CreateAsync(Customer c)
    {
        using var conn = db.CreateConnection();
        return await conn.ExecuteScalarAsync<int>(
            db.Sql("""
                INSERT INTO {schema}.customer
                    (company_name, address1, address2, city, state_code, zip,
                     billing_address1, billing_address2, billing_city, billing_state_code, billing_zip,
                     phone, pay_type_id, route_id, employee_id, offset_code_id,
                     ar_offset, distance, customer_type, call_first, is_test, is_consolidated_billing, is_active)
                OUTPUT INSERTED.customer_id
                VALUES
                    (@CompanyName, @Address1, @Address2, @City, @StateCode, @Zip,
                     @BillingAddress1, @BillingAddress2, @BillingCity, @BillingStateCode, @BillingZip,
                     @Phone, @PayTypeId, @RouteId, @EmployeeId, @OffsetCodeId,
                     @ArOffset, @Distance, @CustomerType, @CallFirst, @IsTest, @IsConsolidatedBilling, @IsActive)
                """), c);
    }

    public async Task<bool> UpdateAsync(Customer c)
    {
        using var conn = db.CreateConnection();
        var rows = await conn.ExecuteAsync(
            db.Sql("""
                UPDATE {schema}.customer SET
                    company_name = @CompanyName, address1 = @Address1, address2 = @Address2,
                    city = @City, state_code = @StateCode, zip = @Zip,
                    billing_address1 = @BillingAddress1, billing_address2 = @BillingAddress2,
                    billing_city = @BillingCity, billing_state_code = @BillingStateCode,
                    billing_zip = @BillingZip, phone = @Phone,
                    pay_type_id = @PayTypeId, route_id = @RouteId,
                    employee_id = @EmployeeId, offset_code_id = @OffsetCodeId,
                    ar_offset = @ArOffset, distance = @Distance,
                    customer_type = @CustomerType, call_first = @CallFirst,
                    is_test = @IsTest, is_consolidated_billing = @IsConsolidatedBilling,
                    is_active = @IsActive
                WHERE customer_id = @CustomerId
                """), c);
        return rows > 0;
    }

    public async Task<IEnumerable<CustomerServiceDetail>> GetServicesAsync(int customerId)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<CustomerServiceDetail>(
            db.Sql("""
                SELECT cs.customer_svc_id AS CustomerSvcId, cs.customer_id AS CustomerId,
                       cs.service_type_id AS ServiceTypeId, st.service_name AS ServiceName,
                       cs.frequency_code AS FrequencyCode, f.description AS FrequencyDescription,
                       cs.service_price AS ServicePrice, cs.service_qty AS ServiceQty,
                       cs.start_week AS StartWeek,
                       cs.first_service_date AS FirstServiceDate, cs.last_service_date AS LastServiceDate,
                       cs.sales_tax_id AS SalesTaxId, t.description AS TaxDescription,
                       cs.commission_paid AS CommissionPaid, cs.comments AS Comments,
                       cs.is_active AS IsActive
                FROM {schema}.customer_service cs
                JOIN  {schema}.service_type st  ON cs.service_type_id = st.service_type_id
                JOIN  {schema}.frequency_code f ON cs.frequency_code = f.frequency_code
                LEFT JOIN {schema}.sales_tax t  ON cs.sales_tax_id = t.sales_tax_id
                WHERE cs.customer_id = @customerId
                ORDER BY cs.customer_svc_id
                """),
            new { customerId });
    }

    public async Task<int> CreateServiceAsync(CustomerService s)
    {
        using var conn = db.CreateConnection();
        return await conn.ExecuteScalarAsync<int>(
            db.Sql("""
                INSERT INTO {schema}.customer_service
                    (customer_id, service_type_id, frequency_code, service_price, service_qty,
                     start_week, first_service_date, last_service_date, sales_tax_id,
                     commission_paid, comments, is_active)
                OUTPUT INSERTED.customer_svc_id
                VALUES
                    (@CustomerId, @ServiceTypeId, @FrequencyCode, @ServicePrice, @ServiceQty,
                     @StartWeek, @FirstServiceDate, @LastServiceDate, @SalesTaxId,
                     @CommissionPaid, @Comments, @IsActive)
                """), s);
    }

    public async Task<bool> UpdateServiceAsync(CustomerService s)
    {
        using var conn = db.CreateConnection();
        var rows = await conn.ExecuteAsync(
            db.Sql("""
                UPDATE {schema}.customer_service SET
                    service_type_id = @ServiceTypeId, frequency_code = @FrequencyCode,
                    service_price = @ServicePrice, service_qty = @ServiceQty,
                    start_week = @StartWeek, first_service_date = @FirstServiceDate,
                    last_service_date = @LastServiceDate, sales_tax_id = @SalesTaxId,
                    commission_paid = @CommissionPaid, comments = @Comments,
                    is_active = @IsActive
                WHERE customer_svc_id = @CustomerSvcId AND customer_id = @CustomerId
                """), s);
        return rows > 0;
    }

    public async Task<bool> DeleteServiceAsync(int customerId, int customerSvcId)
    {
        using var conn = db.CreateConnection();
        var rows = await conn.ExecuteAsync(
            db.Sql("UPDATE {schema}.customer_service SET is_active = 0 WHERE customer_svc_id = @customerSvcId AND customer_id = @customerId"),
            new { customerId, customerSvcId });
        return rows > 0;
    }

    public async Task<bool> DeactivateAsync(int customerId)
    {
        using var conn = db.CreateConnection();
        var rows = await conn.ExecuteAsync(
            db.Sql("UPDATE {schema}.customer SET is_active = 0 WHERE customer_id = @customerId"),
            new { customerId });
        return rows > 0;
    }
}
