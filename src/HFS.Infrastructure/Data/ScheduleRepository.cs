using Dapper;
using HFS.Domain.Entities;

namespace HFS.Infrastructure.Data;

public record ServiceRowForGeneration(
    int CustomerId,
    int CustomerSvcId,
    int ServiceTypeId,
    int ChangeFactor,
    short StartWeek,
    string? Comments);

public record ScheduleListItem(
    int ScheduleId,
    int CustomerId,
    string CompanyName,
    int CustomerSvcId,
    string ServiceName,
    short WeekNumber,
    DateOnly ScheduledDate,
    string? Comments);

public record CustomerScheduleItem(
    int ScheduleId,
    int CustomerSvcId,
    string ServiceTypeName,
    short WeekNumber,
    DateOnly ScheduledDate,
    string? Comments);

public class ScheduleRepository(SqlConnectionFactory db)
{
    // Const fragments so {schema} is embedded as literal text in interpolated strings
    private const string ServiceJoins = """
        FROM {schema}.customer_service cs
        JOIN {schema}.frequency_code f ON cs.frequency_code = f.frequency_code
        """;

    public async Task<IEnumerable<ServiceRowForGeneration>> GetServiceRowsAsync(int? customerId)
    {
        using var conn = db.CreateConnection();
        var where = customerId.HasValue ? "AND cs.customer_id = @customerId" : "";
        return await conn.QueryAsync<ServiceRowForGeneration>(
            db.Sql($"""
                SELECT cs.customer_id     AS CustomerId,
                       cs.customer_svc_id AS CustomerSvcId,
                       cs.service_type_id AS ServiceTypeId,
                       f.change_factor    AS ChangeFactor,
                       cs.start_week      AS StartWeek,
                       cs.comments        AS Comments
                {ServiceJoins}
                WHERE cs.is_active = 1 {where}
                ORDER BY cs.customer_id, cs.customer_svc_id
                """),
            new { customerId });
    }

    public async Task<short?> GetLastWeekInPriorYearAsync(int customerSvcId, int year)
    {
        using var conn = db.CreateConnection();
        return await conn.ExecuteScalarAsync<short?>(
            db.Sql("""
                SELECT TOP 1 week_number
                FROM {schema}.schedule
                WHERE customer_svc_id = @customerSvcId
                  AND YEAR(scheduled_date) = @priorYear
                ORDER BY scheduled_date DESC, week_number DESC
                """),
            new { customerSvcId, priorYear = year - 1 });
    }

    public async Task DeleteByYearAsync(int year, int? customerId)
    {
        using var conn = db.CreateConnection();
        var where = customerId.HasValue ? "AND customer_id = @customerId" : "";
        await conn.ExecuteAsync(
            db.Sql($"DELETE FROM {{schema}}.schedule WHERE YEAR(scheduled_date) = @year {where}"),
            new { year, customerId });
    }

    public async Task InsertManyAsync(IEnumerable<ScheduleEntry> entries)
    {
        using var conn = db.CreateConnection();
        await conn.ExecuteAsync(
            db.Sql("""
                INSERT INTO {schema}.schedule
                    (customer_id, customer_svc_id, service_type_id, week_number, scheduled_date, comments)
                VALUES
                    (@CustomerId, @CustomerSvcId, @ServiceTypeId, @WeekNumber, @ScheduledDate, @Comments)
                """),
            entries);
    }

    public async Task UpdateStartWeekAsync(int customerSvcId, short startWeek)
    {
        using var conn = db.CreateConnection();
        await conn.ExecuteAsync(
            db.Sql("UPDATE {schema}.customer_service SET start_week = @startWeek WHERE customer_svc_id = @customerSvcId"),
            new { customerSvcId, startWeek });
    }

    public async Task<IEnumerable<ScheduleListItem>> GetByWeekAsync(short weekNumber, int year)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<ScheduleListItem>(
            db.Sql("""
                SELECT s.schedule_id   AS ScheduleId,
                       s.customer_id   AS CustomerId,
                       c.company_name  AS CompanyName,
                       s.customer_svc_id AS CustomerSvcId,
                       st.service_name   AS ServiceName,
                       s.week_number     AS WeekNumber,
                       s.scheduled_date  AS ScheduledDate,
                       s.comments        AS Comments
                FROM {schema}.schedule s
                JOIN {schema}.customer c      ON s.customer_id = c.customer_id
                JOIN {schema}.service_type st ON s.service_type_id = st.service_type_id
                WHERE s.week_number = @weekNumber
                  AND YEAR(s.scheduled_date) = @year
                ORDER BY c.company_name
                """),
            new { weekNumber, year });
    }

    public async Task<IEnumerable<CustomerScheduleItem>> GetByCustomerAsync(int customerId, int year)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<CustomerScheduleItem>(db.Sql("""
            SELECT s.schedule_id      AS ScheduleId,
                   s.customer_svc_id  AS CustomerSvcId,
                   st.service_name    AS ServiceTypeName,
                   s.week_number      AS WeekNumber,
                   s.scheduled_date   AS ScheduledDate,
                   s.comments         AS Comments
            FROM {schema}.schedule s
            JOIN {schema}.service_type st ON s.service_type_id = st.service_type_id
            WHERE s.customer_id = @customerId
              AND YEAR(s.scheduled_date) = @year
            ORDER BY st.service_name, s.scheduled_date
            """), new { customerId, year });
    }
}
