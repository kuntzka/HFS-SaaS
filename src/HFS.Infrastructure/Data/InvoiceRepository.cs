using Dapper;
using HFS.Domain.Entities;

namespace HFS.Infrastructure.Data;

// DTO for the rows returned by the "invoices to create" query
public record InvoiceToCreateRow(
    short WeekNumber,
    DateOnly ScheduledDate,
    int CustomerId,
    int CustomerSvcId,
    string Comments,
    int ServiceTypeId,
    string ServiceName,
    short GroupNumber,
    int ItemNumber,
    int Quantity,
    string InvComments,
    string Sku,
    int ServiceQty,
    decimal ServicePrice,
    decimal TaxRate,
    int ArOffset,
    int PayTypeId,
    string RouteCode);

public record InvoiceListItem(
    int InvoiceNumber,
    int CustomerId,
    string CompanyName,
    string? RouteCode,
    decimal ServicePrice,
    decimal Tax,
    decimal TaxableAmount,
    short WeekNumber,
    short SchedYear,
    bool IsComplete,
    bool IsPrinted,
    bool IsAdHoc,
    DateTime? ServiceDate);

public record EditableSvcLine(
    int Id,
    int CustomerSvcId,
    string ServiceDesc,
    int ServiceQty,
    decimal ServicePrice,
    decimal Tax,
    string? Comments);

public record InvoiceSvcDetail(
    string ServiceDesc,
    int ServiceQty,
    decimal ServicePrice,
    decimal Tax,
    string? Comments);

public record CustomerInvoiceSummary(
    int InvoiceNumber,
    DateOnly InvoiceDate,
    DateOnly? ServiceDate,
    int ServiceQty,
    decimal ServicePrice,
    decimal Tax,
    bool IsComplete,
    DateOnly? CompleteDate
);

public class InvoiceRepository(SqlConnectionFactory db)
{
    // Ported from Select_InvoicesToCreate.sql — table/column names updated to new schema,
    // nested RIGHT OUTER JOIN structure preserved exactly to maintain DISTINCT row semantics.
    private const string InvoicesToCreateSql = """
        SELECT DISTINCT
            sc.week_number      AS WeekNumber,
            sc.scheduled_date   AS ScheduledDate,
            sc.customer_id      AS CustomerId,
            sc.customer_svc_id  AS CustomerSvcId,
            ISNULL(cs.comments, '')             AS Comments,
            cs.service_type_id                  AS ServiceTypeId,
            st.service_name                     AS ServiceName,
            ISNULL(csi.group_number, -32768)    AS GroupNumber,
            ISNULL(csi.item_number, 0)          AS ItemNumber,
            ISNULL(csi.quantity, 0)             AS Quantity,
            ISNULL(csi.comments, '')            AS InvComments,
            ISNULL(csi.sku, '')                 AS Sku,
            ISNULL(cs.service_qty, 0)           AS ServiceQty,
            ISNULL(cs.service_price, 0)         AS ServicePrice,
            ISNULL(tx.tax_rate, 0)              AS TaxRate,
            ISNULL(c.ar_offset, 0)              AS ArOffset,
            ISNULL(c.pay_type_id, 0)            AS PayTypeId,
            ISNULL(r.route_code, '')            AS RouteCode
        FROM {schema}.route r
        RIGHT OUTER JOIN (
            {schema}.sales_tax tx
            RIGHT OUTER JOIN (
                {schema}.service_type st
                INNER JOIN (
                    {schema}.customer_service_inventory csi
                    RIGHT OUTER JOIN (
                        {schema}.customer_service cs
                        INNER JOIN (
                            {schema}.schedule sc
                            INNER JOIN {schema}.customer c
                                ON sc.customer_id = c.customer_id
                        )
                        ON c.customer_id   = cs.customer_id
                        AND cs.customer_id  = sc.customer_id
                        AND cs.customer_svc_id = sc.customer_svc_id
                    )
                    ON csi.customer_svc_id = cs.customer_svc_id
                )
                ON cs.service_type_id = st.service_type_id
            )
            ON tx.sales_tax_id = cs.sales_tax_id
        )
        ON r.route_id = c.route_id
        WHERE sc.week_number = @week
          AND YEAR(sc.scheduled_date) = @year
        ORDER BY ISNULL(r.route_code, ''), sc.customer_id, sc.customer_svc_id
        """;

    public async Task<IEnumerable<InvoiceToCreateRow>> GetRowsToCreateAsync(short week, short year)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<InvoiceToCreateRow>(
            db.Sql(InvoicesToCreateSql),
            new { week, year });
    }

    public async Task<int> GetCountByWeekYearAsync(short week, short year)
    {
        using var conn = db.CreateConnection();
        return await conn.ExecuteScalarAsync<int>(
            db.Sql("SELECT COUNT(1) FROM {schema}.invoice WHERE week_number = @week AND sched_year = @year"),
            new { week, year });
    }

    public async Task DeleteByWeekYearAsync(short week, short year)
    {
        using var conn = db.CreateConnection();
        // Delete in FK order
        await conn.ExecuteAsync(db.Sql("""
            DELETE inv FROM {schema}.invoice_svc_inv inv
            JOIN {schema}.invoice i ON inv.invoice_number = i.invoice_number
            WHERE i.week_number = @week AND i.sched_year = @year
            """), new { week, year });
        await conn.ExecuteAsync(db.Sql("""
            DELETE svc FROM {schema}.invoice_svc svc
            JOIN {schema}.invoice i ON svc.invoice_number = i.invoice_number
            WHERE i.week_number = @week AND i.sched_year = @year
            """), new { week, year });
        await conn.ExecuteAsync(db.Sql(
            "DELETE FROM {schema}.invoice WHERE week_number = @week AND sched_year = @year"),
            new { week, year });
    }

    public async Task<int> GetNextInvoiceNumberAsync()
    {
        using var conn = db.CreateConnection();
        return await conn.ExecuteScalarAsync<int>(
            db.Sql("SELECT NEXT VALUE FOR {schema}.invoice_number_seq"));
    }

    public async Task InsertInvoiceAsync(Invoice inv)
    {
        using var conn = db.CreateConnection();
        await conn.ExecuteAsync(db.Sql("""
            INSERT INTO {schema}.invoice
                (invoice_number, customer_id, customer_svc_id, invoice_date,
                 service_price, service_qty, is_complete, is_transmitted_ar,
                 complete_date, pay_type_id, service_date, tax,
                 week_number, is_ad_hoc, ar_offset, sched_year,
                 taxable_amount, is_test)
            VALUES
                (@InvoiceNumber, @CustomerId, @CustomerSvcId, @InvoiceDate,
                 @ServicePrice, @ServiceQty, @IsComplete, @IsTransmittedAr,
                 @CompleteDate, @PayTypeId, @ServiceDate, @Tax,
                 @WeekNumber, @IsAdHoc, @ArOffset, @SchedYear,
                 @TaxableAmount, @IsTest)
            """), inv);
    }

    public async Task InsertInvoiceSvcAsync(InvoiceSvc svc)
    {
        using var conn = db.CreateConnection();
        await conn.ExecuteAsync(db.Sql("""
            INSERT INTO {schema}.invoice_svc
                (invoice_number, customer_svc_id, service_desc, service_price, service_qty, comments, tax)
            VALUES
                (@InvoiceNumber, @CustomerSvcId, @ServiceDesc, @ServicePrice, @ServiceQty, @Comments, @Tax)
            """), svc);
    }

    public async Task InsertInvoiceSvcInvAsync(InvoiceSvcInv inv)
    {
        using var conn = db.CreateConnection();
        await conn.ExecuteAsync(db.Sql("""
            INSERT INTO {schema}.invoice_svc_inv
                (invoice_number, customer_svc_id, item_number, sku, quantity, comments, group_number)
            VALUES
                (@InvoiceNumber, @CustomerSvcId, @ItemNumber, @Sku, @Quantity, @Comments, @GroupNumber)
            """), inv);
    }

    public async Task<IEnumerable<InvoiceListItem>> GetByWeekYearAsync(short week, short year)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<InvoiceListItem>(db.Sql("""
            SELECT i.invoice_number  AS InvoiceNumber,
                   i.customer_id     AS CustomerId,
                   c.company_name    AS CompanyName,
                   r.route_code      AS RouteCode,
                   i.service_price   AS ServicePrice,
                   i.tax             AS Tax,
                   i.taxable_amount  AS TaxableAmount,
                   i.week_number     AS WeekNumber,
                   i.sched_year      AS SchedYear,
                   i.is_complete     AS IsComplete,
                   i.is_printed      AS IsPrinted,
                   i.is_ad_hoc       AS IsAdHoc,
                   i.service_date    AS ServiceDate
            FROM {schema}.invoice i
            JOIN {schema}.customer c     ON i.customer_id = c.customer_id
            LEFT JOIN {schema}.route r   ON c.route_id = r.route_id
            WHERE i.week_number = @week AND i.sched_year = @year
            ORDER BY r.route_code, c.company_name
            """), new { week, year });
    }

    public async Task<IEnumerable<InvoiceSvcDetail>> GetDetailAsync(int invoiceNumber)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<InvoiceSvcDetail>(db.Sql("""
            SELECT s.service_desc  AS ServiceDesc,
                   s.service_qty   AS ServiceQty,
                   s.service_price AS ServicePrice,
                   s.tax           AS Tax,
                   s.comments      AS Comments
            FROM {schema}.invoice_svc s
            WHERE s.invoice_number = @invoiceNumber
            ORDER BY s.id
            """), new { invoiceNumber });
    }

    public async Task<bool> SetCompleteAsync(int invoiceNumber, bool complete)
    {
        using var conn = db.CreateConnection();
        var rows = await conn.ExecuteAsync(db.Sql("""
            UPDATE {schema}.invoice
            SET is_complete = @complete,
                complete_date = CASE WHEN @complete = 1 THEN CAST(GETUTCDATE() AS DATE) ELSE NULL END
            WHERE invoice_number = @invoiceNumber
            """), new { invoiceNumber, complete });
        return rows > 0;
    }

    public async Task<bool> SetPrintedAsync(int invoiceNumber)
    {
        using var conn = db.CreateConnection();
        var rows = await conn.ExecuteAsync(db.Sql(
            "UPDATE {schema}.invoice SET is_printed = 1 WHERE invoice_number = @invoiceNumber"),
            new { invoiceNumber });
        return rows > 0;
    }

    public async Task<bool> UpdateServiceDateAsync(int invoiceNumber, DateOnly? serviceDate)
    {
        using var conn = db.CreateConnection();
        var rows = await conn.ExecuteAsync(db.Sql("""
            UPDATE {schema}.invoice
            SET service_date  = @serviceDate,
                is_complete   = CASE WHEN @serviceDate IS NOT NULL THEN 1 ELSE 0 END,
                complete_date = CASE WHEN @serviceDate IS NOT NULL THEN CAST(GETUTCDATE() AS DATE) ELSE NULL END
            WHERE invoice_number = @invoiceNumber
            """), new { invoiceNumber, serviceDate });
        return rows > 0;
    }

    public async Task<IEnumerable<EditableSvcLine>> GetEditableSvcLinesAsync(int invoiceNumber)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<EditableSvcLine>(db.Sql("""
            SELECT id AS Id, customer_svc_id AS CustomerSvcId,
                   service_desc AS ServiceDesc, service_qty AS ServiceQty,
                   service_price AS ServicePrice, tax AS Tax, comments AS Comments
            FROM {schema}.invoice_svc
            WHERE invoice_number = @invoiceNumber
            ORDER BY id
            """), new { invoiceNumber });
    }

    private async Task RecalcInvoiceTotalsAsync(
        System.Data.IDbConnection conn, int invoiceNumber, System.Data.IDbTransaction tx)
    {
        await conn.ExecuteAsync(db.Sql("""
            UPDATE {schema}.invoice
            SET service_price  = (SELECT ISNULL(SUM(service_price), 0) FROM {schema}.invoice_svc WHERE invoice_number = @invoiceNumber),
                tax            = (SELECT ISNULL(SUM(tax), 0)           FROM {schema}.invoice_svc WHERE invoice_number = @invoiceNumber),
                taxable_amount = (SELECT ISNULL(SUM(CASE WHEN tax > 0 THEN service_price ELSE 0 END), 0)
                                  FROM {schema}.invoice_svc WHERE invoice_number = @invoiceNumber)
            WHERE invoice_number = @invoiceNumber
            """), new { invoiceNumber }, tx);
    }

    public async Task UpdateSvcLinesAsync(int invoiceNumber, IEnumerable<(int Id, decimal ServicePrice, decimal Tax)> lines)
    {
        using var conn = db.CreateConnection();
        await conn.OpenAsync();
        using var tx = await conn.BeginTransactionAsync();

        foreach (var (id, price, tax) in lines)
        {
            await conn.ExecuteAsync(db.Sql("""
                UPDATE {schema}.invoice_svc
                SET service_price = @price, tax = @tax
                WHERE id = @id AND invoice_number = @invoiceNumber
                """), new { id, price, tax, invoiceNumber }, tx);
        }

        await RecalcInvoiceTotalsAsync(conn, invoiceNumber, tx);
        await tx.CommitAsync();
    }

    public async Task<IEnumerable<CustomerInvoiceSummary>> GetByCustomerAsync(
        int customerId, DateOnly from, DateOnly to)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<CustomerInvoiceSummary>(db.Sql("""
            SELECT invoice_number  AS InvoiceNumber,
                   invoice_date    AS InvoiceDate,
                   service_date    AS ServiceDate,
                   service_qty     AS ServiceQty,
                   service_price   AS ServicePrice,
                   tax             AS Tax,
                   CAST(is_complete AS BIT) AS IsComplete,
                   complete_date   AS CompleteDate
            FROM {schema}.invoice
            WHERE customer_id = @customerId
              AND invoice_date BETWEEN @from AND @to
            ORDER BY invoice_date DESC
            """), new { customerId, from, to });
    }

    public async Task<int> AddSvcLineAsync(
        int invoiceNumber, string serviceDesc, int serviceQty,
        decimal servicePrice, decimal tax, string? comments)
    {
        using var conn = db.CreateConnection();
        await conn.OpenAsync();
        using var tx = await conn.BeginTransactionAsync();

        var customerSvcId = await conn.ExecuteScalarAsync<int>(
            db.Sql("SELECT customer_svc_id FROM {schema}.invoice WHERE invoice_number = @invoiceNumber"),
            new { invoiceNumber }, tx);

        var newId = await conn.QuerySingleAsync<int>(db.Sql("""
            INSERT INTO {schema}.invoice_svc
                (invoice_number, customer_svc_id, service_desc, service_qty, service_price, tax, comments)
            OUTPUT INSERTED.id
            VALUES
                (@invoiceNumber, @customerSvcId, @serviceDesc, @serviceQty, @servicePrice, @tax, @comments)
            """), new { invoiceNumber, customerSvcId, serviceDesc, serviceQty, servicePrice, tax, comments }, tx);

        await RecalcInvoiceTotalsAsync(conn, invoiceNumber, tx);
        await tx.CommitAsync();
        return newId;
    }

    public async Task<bool> DeleteSvcLineAsync(int id, int invoiceNumber)
    {
        using var conn = db.CreateConnection();
        await conn.OpenAsync();
        using var tx = await conn.BeginTransactionAsync();

        var rows = await conn.ExecuteAsync(
            db.Sql("DELETE FROM {schema}.invoice_svc WHERE id = @id AND invoice_number = @invoiceNumber"),
            new { id, invoiceNumber }, tx);

        if (rows > 0) await RecalcInvoiceTotalsAsync(conn, invoiceNumber, tx);
        await tx.CommitAsync();
        return rows > 0;
    }
}
