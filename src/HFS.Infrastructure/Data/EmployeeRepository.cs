using Dapper;

namespace HFS.Infrastructure.Data;

public record EmployeeDto(int EmployeeId, string FirstName, string LastName, bool IsActive, bool IsInUse);
public record ActivityPeriodDto(int Id, DateOnly StartDate, DateOnly? EndDate);

public class EmployeeRepository(SqlConnectionFactory db)
{
    public async Task<IEnumerable<EmployeeDto>> GetAllAsync()
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<EmployeeDto>(db.Sql("""
            SELECT e.employee_id AS EmployeeId,
                   e.first_name  AS FirstName,
                   e.last_name   AS LastName,
                   CAST(CASE WHEN EXISTS (
                       SELECT 1 FROM {schema}.employee_activity_period p
                       WHERE p.employee_id = e.employee_id
                         AND p.start_date <= CAST(GETDATE() AS DATE)
                         AND (p.end_date IS NULL OR p.end_date >= CAST(GETDATE() AS DATE))
                   ) THEN 1 ELSE 0 END AS BIT) AS IsActive,
                   CAST(CASE WHEN EXISTS (
                       SELECT 1 FROM {schema}.commission c WHERE c.employee_id = e.employee_id
                   ) OR EXISTS (
                       SELECT 1 FROM {schema}.customer cu WHERE cu.employee_id = e.employee_id
                   ) THEN 1 ELSE 0 END AS BIT) AS IsInUse
            FROM {schema}.employee e
            ORDER BY e.last_name, e.first_name
            """));
    }

    public async Task<EmployeeDto?> GetByIdAsync(int id)
    {
        using var conn = db.CreateConnection();
        return await conn.QuerySingleOrDefaultAsync<EmployeeDto>(db.Sql("""
            SELECT e.employee_id AS EmployeeId,
                   e.first_name  AS FirstName,
                   e.last_name   AS LastName,
                   CAST(CASE WHEN EXISTS (
                       SELECT 1 FROM {schema}.employee_activity_period p
                       WHERE p.employee_id = e.employee_id
                         AND p.start_date <= CAST(GETDATE() AS DATE)
                         AND (p.end_date IS NULL OR p.end_date >= CAST(GETDATE() AS DATE))
                   ) THEN 1 ELSE 0 END AS BIT) AS IsActive,
                   CAST(CASE WHEN EXISTS (
                       SELECT 1 FROM {schema}.commission c WHERE c.employee_id = e.employee_id
                   ) OR EXISTS (
                       SELECT 1 FROM {schema}.customer cu WHERE cu.employee_id = e.employee_id
                   ) THEN 1 ELSE 0 END AS BIT) AS IsInUse
            FROM {schema}.employee e
            WHERE e.employee_id = @id
            """), new { id });
    }

    public async Task<IEnumerable<ActivityPeriodDto>> GetPeriodsAsync(int employeeId)
    {
        using var conn = db.CreateConnection();
        return await conn.QueryAsync<ActivityPeriodDto>(db.Sql("""
            SELECT id AS Id, start_date AS StartDate, end_date AS EndDate
            FROM {schema}.employee_activity_period
            WHERE employee_id = @employeeId
            ORDER BY start_date DESC
            """), new { employeeId });
    }

    public async Task<bool> IsInUseAsync(int id)
    {
        using var conn = db.CreateConnection();
        return await conn.ExecuteScalarAsync<bool>(db.Sql("""
            SELECT CAST(CASE WHEN EXISTS (
                SELECT 1 FROM {schema}.commission c WHERE c.employee_id = @id
            ) OR EXISTS (
                SELECT 1 FROM {schema}.customer cu WHERE cu.employee_id = @id
            ) THEN 1 ELSE 0 END AS BIT)
            """), new { id });
    }

    public async Task<bool> HasOverlapAsync(int employeeId, DateOnly start, DateOnly? end, int? excludePeriodId)
    {
        using var conn = db.CreateConnection();
        return await conn.ExecuteScalarAsync<bool>(db.Sql("""
            SELECT CAST(CASE WHEN EXISTS (
                SELECT 1 FROM {schema}.employee_activity_period
                WHERE employee_id = @employeeId
                  AND id <> ISNULL(@excludePeriodId, -1)
                  AND start_date <= ISNULL(@end, '9999-12-31')
                  AND ISNULL(end_date, '9999-12-31') >= @start
            ) THEN 1 ELSE 0 END AS BIT)
            """), new { employeeId, start, end, excludePeriodId });
    }

    public async Task<int> CreateAsync(string firstName, string lastName, DateOnly firstPeriodStart)
    {
        using var conn = db.CreateConnection();
        conn.Open();
        using var tx = conn.BeginTransaction();
        try
        {
            var employeeId = await conn.QuerySingleAsync<int>(db.Sql("""
                INSERT INTO {schema}.employee (first_name, last_name)
                OUTPUT INSERTED.employee_id
                VALUES (@firstName, @lastName)
                """), new { firstName, lastName }, tx);

            await conn.ExecuteAsync(db.Sql("""
                INSERT INTO {schema}.employee_activity_period (employee_id, start_date, end_date)
                VALUES (@employeeId, @firstPeriodStart, NULL)
                """), new { employeeId, firstPeriodStart }, tx);

            tx.Commit();
            return employeeId;
        }
        catch
        {
            tx.Rollback();
            throw;
        }
    }

    public async Task UpdateNameAsync(int id, string firstName, string lastName)
    {
        using var conn = db.CreateConnection();
        await conn.ExecuteAsync(db.Sql("""
            UPDATE {schema}.employee
            SET first_name = @firstName, last_name = @lastName
            WHERE employee_id = @id
            """), new { id, firstName, lastName });
    }

    public async Task DeleteAsync(int id)
    {
        using var conn = db.CreateConnection();
        conn.Open();
        using var tx = conn.BeginTransaction();
        try
        {
            await conn.ExecuteAsync(db.Sql("""
                DELETE FROM {schema}.employee_activity_period WHERE employee_id = @id
                """), new { id }, tx);

            await conn.ExecuteAsync(db.Sql("""
                DELETE FROM {schema}.employee WHERE employee_id = @id
                """), new { id }, tx);

            tx.Commit();
        }
        catch
        {
            tx.Rollback();
            throw;
        }
    }

    public async Task DeactivateAsync(int id)
    {
        using var conn = db.CreateConnection();
        await conn.ExecuteAsync(db.Sql("""
            UPDATE {schema}.employee_activity_period
            SET end_date = CAST(GETDATE() AS DATE)
            WHERE employee_id = @id AND end_date IS NULL
            """), new { id });
    }

    public async Task<int> AddPeriodAsync(int employeeId, DateOnly start, DateOnly? end)
    {
        using var conn = db.CreateConnection();
        return await conn.QuerySingleAsync<int>(db.Sql("""
            INSERT INTO {schema}.employee_activity_period (employee_id, start_date, end_date)
            OUTPUT INSERTED.id
            VALUES (@employeeId, @start, @end)
            """), new { employeeId, start, end });
    }

    public async Task<bool> UpdatePeriodAsync(int periodId, DateOnly start, DateOnly? end)
    {
        using var conn = db.CreateConnection();
        var rows = await conn.ExecuteAsync(db.Sql("""
            UPDATE {schema}.employee_activity_period
            SET start_date = @start, end_date = @end
            WHERE id = @periodId
            """), new { periodId, start, end });
        return rows > 0;
    }

    public async Task<bool> DeletePeriodAsync(int periodId)
    {
        using var conn = db.CreateConnection();
        var rows = await conn.ExecuteAsync(
            db.Sql("DELETE FROM {schema}.employee_activity_period WHERE id = @periodId"),
            new { periodId });
        return rows > 0;
    }
}
