# Employee Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `employee.is_active` boolean with a date-range activity period model and build a full employee management UI with CRUD and activity period maintenance.

**Architecture:** A new `employee_activity_period` table holds multiple non-overlapping active date ranges per employee. `EmployeeRepository` encapsulates all SQL. `EmployeesController` exposes a REST API at `/api/employees`. The React `EmployeesPage` uses an expandable-row table (same pattern as `ServiceInventoryTable`) so periods are managed inline without modals.

**Tech Stack:** .NET 8 / Dapper / T-SQL (Azure SQL), React 18 / TypeScript / Ant Design 5, DbUp for migrations.

---

## File Map

| File | Change |
|---|---|
| `src/HFS.Infrastructure/Migrations/Scripts/Tenant/0008_add_employee_activity_periods.sql` | CREATE |
| `src/HFS.Infrastructure/Data/EmployeeRepository.cs` | CREATE |
| `src/HFS.Infrastructure/DependencyInjection.cs` | MODIFY — register `EmployeeRepository` |
| `src/HFS.Api/Controllers/EmployeesController.cs` | CREATE |
| `src/HFS.Api/Controllers/ReferenceDataController.cs` | MODIFY — remove `GetEmployees` |
| `src/HFS.Infrastructure/Data/ReferenceDataRepository.cs` | MODIFY — remove `GetEmployeesAsync` |
| `frontend/src/components/EmployeePeriodTable.tsx` | CREATE |
| `frontend/src/pages/EmployeesPage.tsx` | CREATE |
| `frontend/src/App.tsx` | MODIFY — add `/employees` route |
| `frontend/src/components/AppShell.tsx` | MODIFY — add Employees nav item |

---

## Task 1: Database Migration

**Files:**
- Create: `src/HFS.Infrastructure/Migrations/Scripts/Tenant/0008_add_employee_activity_periods.sql`

The migration creates the `employee_activity_period` table, seeds one period per existing employee from the old `is_active`/`start_date` columns, then drops those columns.

- [ ] **Step 1: Create the migration file**

```sql
-- 0008_add_employee_activity_periods.sql
-- Creates employee activity period table, migrates existing data, removes redundant columns.

CREATE TABLE {SCHEMA}.employee_activity_period (
    id          INT  NOT NULL IDENTITY(1,1) PRIMARY KEY,
    employee_id INT  NOT NULL REFERENCES {SCHEMA}.employee(employee_id),
    start_date  DATE NOT NULL,
    end_date    DATE NULL   -- NULL = currently active
);
CREATE INDEX idx_emp_period ON {SCHEMA}.employee_activity_period(employee_id, start_date);

-- Seed one period per existing employee from is_active / start_date columns.
-- Employees with no start_date on file receive a placeholder of 2000-01-01.
-- Inactive employees get their period closed as of today.
INSERT INTO {SCHEMA}.employee_activity_period (employee_id, start_date, end_date)
SELECT employee_id,
       ISNULL(start_date, '2000-01-01'),
       CASE WHEN is_active = 0 THEN CAST(GETDATE() AS DATE) ELSE NULL END
FROM {SCHEMA}.employee;

-- Drop the DEFAULT constraint on is_active before dropping the column.
DECLARE @constraint NVARCHAR(200);
SELECT @constraint = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c  ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
JOIN sys.tables t   ON c.object_id = t.object_id
JOIN sys.schemas s  ON t.schema_id = s.schema_id
WHERE s.name = '{SCHEMA}' AND t.name = 'employee' AND c.name = 'is_active';
IF @constraint IS NOT NULL
    EXEC('ALTER TABLE {SCHEMA}.employee DROP CONSTRAINT ' + @constraint);

ALTER TABLE {SCHEMA}.employee DROP COLUMN is_active;
ALTER TABLE {SCHEMA}.employee DROP COLUMN start_date;
```

- [ ] **Step 2: Start the API to verify migration applies cleanly**

```bash
cd C:\dev\HFS-SaaS\src\HFS.Api
dotnet run
```

Expected: API starts without errors. Check logs for `Tenant … migrations applied successfully`. If you see a migration error, check the SQL syntax — particularly the dynamic EXEC for the constraint drop.

- [ ] **Step 3: Verify the schema in the dev database**

Connect to the dev SQL Server (localhost:1433, SA / Dev_Password1!) and run:

```sql
SELECT * FROM tenant_dev.employee_activity_period;
SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'tenant_dev' AND TABLE_NAME = 'employee'
ORDER BY ORDINAL_POSITION;
```

Expected: `employee_activity_period` has one row per employee. The `employee` table no longer has `is_active` or `start_date` columns.

- [ ] **Step 4: Commit**

```bash
git add src/HFS.Infrastructure/Migrations/Scripts/Tenant/0008_add_employee_activity_periods.sql
git commit -m "feat: add employee_activity_period table, migrate is_active/start_date"
```

---

## Task 2: EmployeeRepository

**Files:**
- Create: `src/HFS.Infrastructure/Data/EmployeeRepository.cs`
- Modify: `src/HFS.Infrastructure/Data/ReferenceDataRepository.cs` (remove `GetEmployeesAsync`)
- Modify: `src/HFS.Infrastructure/DependencyInjection.cs` (register `EmployeeRepository`)

> **Context:** All repositories in this codebase use `Dapper` + `SqlConnectionFactory`. `db.Sql(...)` replaces `{schema}` with the tenant's schema name. `DateOnly` is supported via type handlers registered in `DependencyInjection.cs` — pass `DateOnly` and `DateOnly?` parameters directly to Dapper. Use `CAST(... AS BIT)` for any boolean column mapped to `bool` in a positional record.

- [ ] **Step 1: Create `EmployeeRepository.cs`**

```csharp
// src/HFS.Infrastructure/Data/EmployeeRepository.cs
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

    public async Task<bool> IsInUseAsync(int employeeId)
    {
        using var conn = db.CreateConnection();
        return await conn.ExecuteScalarAsync<int>(db.Sql("""
            SELECT CASE WHEN EXISTS (SELECT 1 FROM {schema}.commission WHERE employee_id = @employeeId)
                          OR EXISTS (SELECT 1 FROM {schema}.customer  WHERE employee_id = @employeeId)
                   THEN 1 ELSE 0 END
            """), new { employeeId }) > 0;
    }

    // Returns true if the given date range overlaps any existing period for this employee.
    // Treats NULL end_date as '9999-12-31'. Excludes excludePeriodId (used when editing).
    // Two periods overlap when: A.start <= new.end AND A.end >= new.start
    public async Task<bool> HasOverlapAsync(
        int employeeId, DateOnly start, DateOnly? end, int? excludePeriodId)
    {
        using var conn = db.CreateConnection();
        return await conn.ExecuteScalarAsync<int>(db.Sql("""
            SELECT COUNT(1)
            FROM {schema}.employee_activity_period
            WHERE employee_id = @employeeId
              AND (@excludePeriodId IS NULL OR id <> @excludePeriodId)
              AND start_date     <= ISNULL(@end,      '9999-12-31')
              AND ISNULL(end_date, '9999-12-31') >= @start
            """), new { employeeId, start, end, excludePeriodId }) > 0;
    }

    public async Task<int> CreateAsync(string firstName, string lastName, DateOnly firstPeriodStart)
    {
        using var conn = db.CreateConnection();
        await conn.OpenAsync();
        using var tx = await conn.BeginTransactionAsync();

        var employeeId = await conn.QuerySingleAsync<int>(db.Sql("""
            INSERT INTO {schema}.employee (first_name, last_name)
            OUTPUT INSERTED.employee_id
            VALUES (@firstName, @lastName)
            """), new { firstName, lastName }, tx);

        await conn.ExecuteAsync(db.Sql("""
            INSERT INTO {schema}.employee_activity_period (employee_id, start_date, end_date)
            VALUES (@employeeId, @firstPeriodStart, NULL)
            """), new { employeeId, firstPeriodStart }, tx);

        await tx.CommitAsync();
        return employeeId;
    }

    public async Task<bool> UpdateNameAsync(int employeeId, string firstName, string lastName)
    {
        using var conn = db.CreateConnection();
        var rows = await conn.ExecuteAsync(db.Sql("""
            UPDATE {schema}.employee
            SET first_name = @firstName, last_name = @lastName
            WHERE employee_id = @employeeId
            """), new { employeeId, firstName, lastName });
        return rows > 0;
    }

    public async Task<bool> DeleteAsync(int employeeId)
    {
        using var conn = db.CreateConnection();
        await conn.OpenAsync();
        using var tx = await conn.BeginTransactionAsync();
        await conn.ExecuteAsync(db.Sql(
            "DELETE FROM {schema}.employee_activity_period WHERE employee_id = @employeeId"),
            new { employeeId }, tx);
        var rows = await conn.ExecuteAsync(db.Sql(
            "DELETE FROM {schema}.employee WHERE employee_id = @employeeId"),
            new { employeeId }, tx);
        await tx.CommitAsync();
        return rows > 0;
    }

    // Closes the open period (end_date IS NULL) with today's date.
    // No-op if the employee has no open period.
    public async Task DeactivateAsync(int employeeId)
    {
        using var conn = db.CreateConnection();
        await conn.ExecuteAsync(db.Sql("""
            UPDATE {schema}.employee_activity_period
            SET end_date = CAST(GETDATE() AS DATE)
            WHERE employee_id = @employeeId AND end_date IS NULL
            """), new { employeeId });
    }

    public async Task<int> AddPeriodAsync(int employeeId, DateOnly startDate, DateOnly? endDate)
    {
        using var conn = db.CreateConnection();
        return await conn.QuerySingleAsync<int>(db.Sql("""
            INSERT INTO {schema}.employee_activity_period (employee_id, start_date, end_date)
            OUTPUT INSERTED.id
            VALUES (@employeeId, @startDate, @endDate)
            """), new { employeeId, startDate, endDate });
    }

    public async Task<bool> UpdatePeriodAsync(int periodId, DateOnly startDate, DateOnly? endDate)
    {
        using var conn = db.CreateConnection();
        var rows = await conn.ExecuteAsync(db.Sql("""
            UPDATE {schema}.employee_activity_period
            SET start_date = @startDate, end_date = @endDate
            WHERE id = @periodId
            """), new { periodId, startDate, endDate });
        return rows > 0;
    }

    public async Task<bool> DeletePeriodAsync(int periodId)
    {
        using var conn = db.CreateConnection();
        var rows = await conn.ExecuteAsync(db.Sql(
            "DELETE FROM {schema}.employee_activity_period WHERE id = @periodId"),
            new { periodId });
        return rows > 0;
    }
}
```

- [ ] **Step 2: Remove `GetEmployeesAsync` from `ReferenceDataRepository`**

In `src/HFS.Infrastructure/Data/ReferenceDataRepository.cs`, delete the `EmployeeDto` record and the `GetEmployeesAsync` method. The `EmployeeDto` record now lives in `EmployeeRepository.cs`.

The file after removal should no longer contain `EmployeeDto` or `GetEmployeesAsync`.

- [ ] **Step 3: Register `EmployeeRepository` in DI**

In `src/HFS.Infrastructure/DependencyInjection.cs`, add after the `ReferenceDataRepository` line:

```csharp
services.AddScoped<EmployeeRepository>();
```

- [ ] **Step 4: Build to verify no compile errors**

```bash
cd C:\dev\HFS-SaaS
dotnet build src/HFS.Infrastructure/HFS.Infrastructure.csproj --nologo -v q
```

Expected: `Build succeeded. 0 Warning(s) 0 Error(s)`

- [ ] **Step 5: Commit**

```bash
git add src/HFS.Infrastructure/Data/EmployeeRepository.cs \
        src/HFS.Infrastructure/Data/ReferenceDataRepository.cs \
        src/HFS.Infrastructure/DependencyInjection.cs
git commit -m "feat: add EmployeeRepository with activity period CRUD"
```

---

## Task 3: EmployeesController

**Files:**
- Create: `src/HFS.Api/Controllers/EmployeesController.cs`
- Modify: `src/HFS.Api/Controllers/ReferenceDataController.cs` (remove `GetEmployees` endpoint)

> **Context:** Controllers in this project use primary constructor DI. Return `NoContent()` for successful updates/deletes, `NotFound()` when row not found, `Conflict(new { message })` for business-rule rejections. `[Authorize]` is on the class. The `GET /api/employees` URL must remain identical — only the controller changes.

- [ ] **Step 1: Create `EmployeesController.cs`**

```csharp
// src/HFS.Api/Controllers/EmployeesController.cs
using HFS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace HFS.Api.Controllers;

[ApiController]
[Route("api/employees")]
[Authorize]
public class EmployeesController(EmployeeRepository repo) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetAll() =>
        Ok(await repo.GetAllAsync());

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateEmployeeRequest req)
    {
        var id = await repo.CreateAsync(req.FirstName, req.LastName, req.FirstPeriodStart);
        return CreatedAtAction(nameof(GetAll), new { id }, new { employeeId = id });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> UpdateName(int id, [FromBody] UpdateEmployeeNameRequest req) =>
        await repo.UpdateNameAsync(id, req.FirstName, req.LastName) ? NoContent() : NotFound();

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        if (await repo.IsInUseAsync(id))
            return Conflict(new { message = "This employee has commission or customer history and cannot be deleted. Use Deactivate instead." });
        return await repo.DeleteAsync(id) ? NoContent() : NotFound();
    }

    [HttpPost("{id:int}/deactivate")]
    public async Task<IActionResult> Deactivate(int id)
    {
        await repo.DeactivateAsync(id);
        return NoContent();
    }

    [HttpGet("{id:int}/periods")]
    public async Task<IActionResult> GetPeriods(int id) =>
        Ok(await repo.GetPeriodsAsync(id));

    [HttpPost("{id:int}/periods")]
    public async Task<IActionResult> AddPeriod(int id, [FromBody] UpsertPeriodRequest req)
    {
        if (await repo.HasOverlapAsync(id, req.StartDate, req.EndDate, null))
            return BadRequest(new { message = "This period overlaps an existing activity period for this employee." });
        var periodId = await repo.AddPeriodAsync(id, req.StartDate, req.EndDate);
        return Created($"/api/employees/{id}/periods/{periodId}", new { periodId });
    }

    [HttpPut("{id:int}/periods/{periodId:int}")]
    public async Task<IActionResult> UpdatePeriod(int id, int periodId, [FromBody] UpsertPeriodRequest req)
    {
        if (await repo.HasOverlapAsync(id, req.StartDate, req.EndDate, periodId))
            return BadRequest(new { message = "This period overlaps an existing activity period for this employee." });
        return await repo.UpdatePeriodAsync(periodId, req.StartDate, req.EndDate) ? NoContent() : NotFound();
    }

    [HttpDelete("{id:int}/periods/{periodId:int}")]
    public async Task<IActionResult> DeletePeriod(int id, int periodId) =>
        await repo.DeletePeriodAsync(periodId) ? NoContent() : NotFound();
}

public record CreateEmployeeRequest(string FirstName, string LastName, DateOnly FirstPeriodStart);
public record UpdateEmployeeNameRequest(string FirstName, string LastName);
public record UpsertPeriodRequest(DateOnly StartDate, DateOnly? EndDate);
```

- [ ] **Step 2: Remove `GetEmployees` from `ReferenceDataController`**

In `src/HFS.Api/Controllers/ReferenceDataController.cs`, delete the constructor parameter `ReferenceDataRepository repo` if it becomes unused after removing `GetEmployees`, or just remove the `GetEmployees` action. The controller currently also handles routes, service types, frequency codes, pay types, tax rates, and offset codes — keep those. Only remove:

```csharp
[HttpGet("employees")]
public async Task<IActionResult> GetEmployees() =>
    Ok(await repo.GetEmployeesAsync());
```

The `ReferenceDataController` constructor still takes `ReferenceDataRepository repo` for the remaining endpoints.

- [ ] **Step 3: Build the API project**

```bash
cd C:\dev\HFS-SaaS
dotnet build src/HFS.Api/HFS.Api.csproj --nologo -v q
```

Expected: `Build succeeded. 0 Warning(s) 0 Error(s)`

- [ ] **Step 4: Smoke test via Swagger**

Start the API (`dotnet run` in `src/HFS.Api`). Open `http://localhost:5000/swagger`. Log in first via `POST /api/auth/login` to get a JWT, then authorize in Swagger.

Verify:
- `GET /api/employees` returns the employee list with `isActive` and `isInUse` fields
- `GET /api/employees/1/periods` returns the periods for employee 1
- `POST /api/employees` with `{ "firstName": "Test", "lastName": "User", "firstPeriodStart": "2024-01-01" }` creates a new employee and returns `{ employeeId: N }`
- `DELETE /api/employees/{N}` on the new test employee returns `204`

- [ ] **Step 5: Commit**

```bash
git add src/HFS.Api/Controllers/EmployeesController.cs \
        src/HFS.Api/Controllers/ReferenceDataController.cs
git commit -m "feat: add EmployeesController, move GET /api/employees from ReferenceDataController"
```

---

## Task 4: EmployeePeriodTable Component

**Files:**
- Create: `frontend/src/components/EmployeePeriodTable.tsx`

> **Context:** This component is the expandable sub-table for activity periods, owned entirely by the expanded row. It follows the same pattern as `ServiceInventoryTable` in `frontend/src/components/ServiceInventoryTable.tsx`. Use Ant Design `Table`, `DatePicker`, `Button`, `Space`, `Alert`. Import `dayjs` and `Dayjs` from `dayjs`. `client` is the axios instance from `../api/client`. Dates sent to the API must be formatted as `'YYYY-MM-DD'`.

- [ ] **Step 1: Create `EmployeePeriodTable.tsx`**

```tsx
// frontend/src/components/EmployeePeriodTable.tsx
import { useEffect, useState } from 'react'
import { Alert, Button, DatePicker, Space, Table } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import client from '../api/client'

interface Period {
  id: number
  startDate: string
  endDate: string | null
}

interface PeriodFormValues {
  startDate: Dayjs | null
  endDate: Dayjs | null
}

const EMPTY_FORM: PeriodFormValues = { startDate: null, endDate: null }

export function EmployeePeriodTable({ employeeId }: { employeeId: number }) {
  const [periods, setPeriods]         = useState<Period[]>([])
  const [loading, setLoading]         = useState(true)
  const [editingId, setEditingId]     = useState<number | null>(null)
  const [editValues, setEditValues]   = useState<PeriodFormValues>(EMPTY_FORM)
  const [adding, setAdding]           = useState(false)
  const [newValues, setNewValues]     = useState<PeriodFormValues>(EMPTY_FORM)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setPeriods([])
    setError(null)
    client.get<Period[]>(`/employees/${employeeId}/periods`)
      .then(r => setPeriods(r.data))
      .catch(() => setError('Failed to load periods.'))
      .finally(() => setLoading(false))
  }, [employeeId])

  function startEdit(period: Period) {
    setAdding(false)
    setNewValues(EMPTY_FORM)
    setError(null)
    setEditingId(period.id)
    setEditValues({
      startDate: dayjs(period.startDate),
      endDate: period.endDate ? dayjs(period.endDate) : null,
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditValues(EMPTY_FORM)
    setError(null)
  }

  async function saveEdit(period: Period) {
    if (!editValues.startDate) { setError('Start date is required.'); return }
    setSaving(true)
    setError(null)
    try {
      await client.put(`/employees/${employeeId}/periods/${period.id}`, {
        startDate: editValues.startDate.format('YYYY-MM-DD'),
        endDate: editValues.endDate ? editValues.endDate.format('YYYY-MM-DD') : null,
      })
      setPeriods(prev => prev.map(p =>
        p.id === period.id
          ? { ...p, startDate: editValues.startDate!.format('YYYY-MM-DD'), endDate: editValues.endDate?.format('YYYY-MM-DD') ?? null }
          : p
      ))
      setEditingId(null)
      setEditValues(EMPTY_FORM)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      setError(msg ?? 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  async function deletePeriod(periodId: number) {
    try {
      await client.delete(`/employees/${employeeId}/periods/${periodId}`)
      setPeriods(prev => prev.filter(p => p.id !== periodId))
    } catch {
      setError('Failed to delete period.')
    }
  }

  async function saveAdd() {
    if (!newValues.startDate) { setError('Start date is required.'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await client.post<{ periodId: number }>(`/employees/${employeeId}/periods`, {
        startDate: newValues.startDate.format('YYYY-MM-DD'),
        endDate: newValues.endDate ? newValues.endDate.format('YYYY-MM-DD') : null,
      })
      setPeriods(prev => [{
        id: res.data.periodId,
        startDate: newValues.startDate!.format('YYYY-MM-DD'),
        endDate: newValues.endDate?.format('YYYY-MM-DD') ?? null,
      }, ...prev])
      setAdding(false)
      setNewValues(EMPTY_FORM)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      setError(msg ?? 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  type DisplayRow = Period | { id: 0 }
  const NEW_ID = 0 as const

  const rows: DisplayRow[] = adding
    ? [{ id: NEW_ID }, ...periods]
    : periods

  const columns = [
    {
      title: 'Start',
      key: 'start',
      width: 200,
      render: (_: unknown, row: DisplayRow) => {
        if (row.id === NEW_ID) {
          return (
            <DatePicker
              value={newValues.startDate}
              onChange={d => setNewValues(v => ({ ...v, startDate: d }))}
              format="MM/DD/YYYY"
              placeholder="Start date"
              size="small"
            />
          )
        }
        const p = row as Period
        if (editingId === p.id) {
          return (
            <DatePicker
              value={editValues.startDate}
              onChange={d => setEditValues(v => ({ ...v, startDate: d }))}
              format="MM/DD/YYYY"
              size="small"
            />
          )
        }
        return dayjs(p.startDate).format('MM/DD/YYYY')
      },
    },
    {
      title: 'End',
      key: 'end',
      width: 200,
      render: (_: unknown, row: DisplayRow) => {
        if (row.id === NEW_ID) {
          return (
            <DatePicker
              value={newValues.endDate}
              onChange={d => setNewValues(v => ({ ...v, endDate: d }))}
              format="MM/DD/YYYY"
              placeholder="Present (leave blank)"
              size="small"
              allowClear
            />
          )
        }
        const p = row as Period
        if (editingId === p.id) {
          return (
            <DatePicker
              value={editValues.endDate}
              onChange={d => setEditValues(v => ({ ...v, endDate: d }))}
              format="MM/DD/YYYY"
              placeholder="Present"
              size="small"
              allowClear
            />
          )
        }
        return p.endDate ? dayjs(p.endDate).format('MM/DD/YYYY') : 'Present'
      },
    },
    {
      title: '',
      key: 'actions',
      width: 160,
      render: (_: unknown, row: DisplayRow) => {
        if (row.id === NEW_ID) {
          return (
            <Space size={4}>
              <Button size="small" type="primary" loading={saving} onClick={saveAdd}>Save</Button>
              <Button size="small" onClick={() => { setAdding(false); setNewValues(EMPTY_FORM); setError(null) }}>Cancel</Button>
            </Space>
          )
        }
        const p = row as Period
        if (editingId === p.id) {
          return (
            <Space size={4}>
              <Button size="small" type="primary" loading={saving} onClick={() => saveEdit(p)}>Save</Button>
              <Button size="small" onClick={cancelEdit}>Cancel</Button>
            </Space>
          )
        }
        return (
          <Space size={4}>
            <Button size="small" onClick={() => startEdit(p)}>Edit</Button>
            <Button size="small" danger onClick={() => deletePeriod(p.id)}>Delete</Button>
          </Space>
        )
      },
    },
  ]

  return (
    <div style={{ padding: '4px 16px 8px 48px' }}>
      {error && (
        <Alert
          type="error"
          message={error}
          showIcon
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 8 }}
        />
      )}
      <Table
        dataSource={rows}
        columns={columns}
        rowKey="id"
        size="small"
        pagination={false}
        loading={loading}
      />
      {!adding && (
        <Button
          size="small"
          icon={<PlusOutlined />}
          style={{ marginTop: 8 }}
          onClick={() => { setAdding(true); setNewValues(EMPTY_FORM); setError(null) }}
        >
          Add Period
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:\dev\HFS-SaaS\frontend
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/EmployeePeriodTable.tsx
git commit -m "feat: add EmployeePeriodTable expandable sub-component"
```

---

## Task 5: EmployeesPage

**Files:**
- Create: `frontend/src/pages/EmployeesPage.tsx`

> **Context:** Follow the `InventoryPage` pattern (`frontend/src/pages/InventoryPage.tsx`). Use Ant Design `Table`, `Button`, `Modal`, `Form`, `Input`, `DatePicker`, `Tag`, `Space`, `Popconfirm`, `Alert`, `Tooltip`, `Card`, `Typography`. Import `EmployeePeriodTable` from `'../components/EmployeePeriodTable'`. The employee list is loaded once on mount and refreshed after create/deactivate/delete. The API base is `/employees` (the axios client prepends `/api`).

- [ ] **Step 1: Create `EmployeesPage.tsx`**

```tsx
// frontend/src/pages/EmployeesPage.tsx
import { useEffect, useState } from 'react'
import {
  Alert, Button, Card, Form, Input, DatePicker, Modal,
  Popconfirm, Space, Table, Tag, Tooltip, Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PlusOutlined, UserDeleteOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import client from '../api/client'
import { EmployeePeriodTable } from '../components/EmployeePeriodTable'

const { Title } = Typography

interface Employee {
  employeeId: number
  firstName: string
  lastName: string
  isActive: boolean
  isInUse: boolean
}

interface AddForm {
  firstName: string
  lastName: string
  firstPeriodStart: ReturnType<typeof dayjs> | null
}

interface EditForm {
  firstName: string
  lastName: string
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  // Add modal
  const [addOpen, setAddOpen]     = useState(false)
  const [addSaving, setAddSaving] = useState(false)
  const [addForm] = Form.useForm<AddForm>()

  // Edit modal
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null)
  const [editSaving, setEditSaving]     = useState(false)
  const [editForm] = Form.useForm<EditForm>()

  const load = async () => {
    setLoading(true)
    try {
      const res = await client.get<Employee[]>('/employees')
      setEmployees(res.data)
    } catch {
      setError('Failed to load employees.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openAdd = () => {
    addForm.resetFields()
    setError('')
    setAddOpen(true)
  }

  const handleAdd = async () => {
    let values: AddForm
    try { values = await addForm.validateFields() } catch { return }
    setAddSaving(true)
    setError('')
    try {
      await client.post('/employees', {
        firstName: values.firstName,
        lastName: values.lastName,
        firstPeriodStart: values.firstPeriodStart!.format('YYYY-MM-DD'),
      })
      setAddOpen(false)
      await load()
    } catch {
      setError('Failed to create employee.')
    } finally {
      setAddSaving(false)
    }
  }

  const openEdit = (emp: Employee) => {
    setEditEmployee(emp)
    editForm.setFieldsValue({ firstName: emp.firstName, lastName: emp.lastName })
    setError('')
  }

  const handleEdit = async () => {
    if (!editEmployee) return
    let values: EditForm
    try { values = await editForm.validateFields() } catch { return }
    setEditSaving(true)
    setError('')
    try {
      await client.put(`/employees/${editEmployee.employeeId}`, values)
      setEditEmployee(null)
      await load()
    } catch {
      setError('Failed to update employee.')
    } finally {
      setEditSaving(false)
    }
  }

  const handleDelete = async (emp: Employee) => {
    setError('')
    try {
      await client.delete(`/employees/${emp.employeeId}`)
      await load()
    } catch {
      setError(`Could not delete ${emp.lastName}, ${emp.firstName}.`)
    }
  }

  const handleDeactivate = async (emp: Employee) => {
    setError('')
    try {
      await client.post(`/employees/${emp.employeeId}/deactivate`)
      await load()
    } catch {
      setError('Failed to deactivate employee.')
    }
  }

  const columns: ColumnsType<Employee> = [
    { title: 'Last Name',  dataIndex: 'lastName',  key: 'lastName',  sorter: (a, b) => a.lastName.localeCompare(b.lastName) },
    { title: 'First Name', dataIndex: 'firstName', key: 'firstName' },
    {
      title: 'Status',
      key: 'status',
      width: 100,
      render: (_: unknown, r: Employee) =>
        r.isActive
          ? <Tag color="green">Active</Tag>
          : <Tag>Inactive</Tag>,
    },
    {
      title: '',
      key: 'actions',
      width: 180,
      render: (_: unknown, r: Employee) => (
        <Space size={4}>
          <Button size="small" onClick={() => openEdit(r)}>Edit</Button>
          {r.isInUse ? (
            <Tooltip title="Has commission or customer history — deactivate instead of delete">
              <Popconfirm
                title={`Deactivate ${r.lastName}, ${r.firstName}?`}
                description="Their current active period will be closed as of today."
                okText="Deactivate"
                okButtonProps={{ danger: true }}
                onConfirm={() => handleDeactivate(r)}
              >
                <Button size="small" danger icon={<UserDeleteOutlined />}>Deactivate</Button>
              </Popconfirm>
            </Tooltip>
          ) : (
            <Popconfirm
              title={`Delete ${r.lastName}, ${r.firstName}?`}
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(r)}
            >
              <Button size="small" danger>Delete</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>Employees</Title>

      {error && (
        <Alert
          type="error"
          message={error}
          showIcon
          closable
          onClose={() => setError('')}
          style={{ marginBottom: 16 }}
        />
      )}

      <Card
        title="Employee List"
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>Add Employee</Button>}
      >
        <Table
          dataSource={employees}
          columns={columns}
          rowKey="employeeId"
          size="small"
          loading={loading}
          pagination={{ pageSize: 50 }}
          expandable={{
            expandedRowRender: (record) => (
              <EmployeePeriodTable employeeId={record.employeeId} />
            ),
          }}
        />
      </Card>

      {/* Add Employee Modal */}
      <Modal
        title="Add Employee"
        open={addOpen}
        onOk={handleAdd}
        onCancel={() => setAddOpen(false)}
        okText="Add"
        confirmLoading={addSaving}
        destroyOnClose
      >
        <Form form={addForm} layout="vertical" style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="firstName" label="First Name" style={{ flex: 1 }}
              rules={[{ required: true, message: 'Required' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="lastName" label="Last Name" style={{ flex: 1 }}
              rules={[{ required: true, message: 'Required' }]}>
              <Input />
            </Form.Item>
          </div>
          <Form.Item name="firstPeriodStart" label="Active From"
            rules={[{ required: true, message: 'Required' }]}>
            <DatePicker format="MM/DD/YYYY" style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit Employee Modal */}
      <Modal
        title={editEmployee ? `Edit — ${editEmployee.lastName}, ${editEmployee.firstName}` : ''}
        open={!!editEmployee}
        onOk={handleEdit}
        onCancel={() => setEditEmployee(null)}
        okText="Save"
        confirmLoading={editSaving}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="firstName" label="First Name" style={{ flex: 1 }}
              rules={[{ required: true, message: 'Required' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="lastName" label="Last Name" style={{ flex: 1 }}
              rules={[{ required: true, message: 'Required' }]}>
              <Input />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:\dev\HFS-SaaS\frontend
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/EmployeesPage.tsx
git commit -m "feat: add EmployeesPage with add/edit/delete/deactivate"
```

---

## Task 6: Navigation Wiring

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/AppShell.tsx`

- [ ] **Step 1: Add the `/employees` route to `App.tsx`**

In `frontend/src/App.tsx`, add the import and route. The full file after changes:

```tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import AppShell from './components/AppShell'
import LoginPage from './pages/LoginPage'
import CustomersPage from './pages/CustomersPage'
import CustomerDetailPage from './pages/CustomerDetailPage'
import PlaceholderPage from './pages/PlaceholderPage'
import SchedulePage from './pages/SchedulePage'
import InvoicesPage from './pages/InvoicesPage'
import CommissionsPage from './pages/CommissionsPage'
import InventoryPage from './pages/InventoryPage'
import EmployeesPage from './pages/EmployeesPage'
import ReportsPage from './pages/ReportsPage'
import ExportPage from './pages/ExportPage'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/customers" replace />} />
          <Route path="customers"  element={<CustomersPage />} />
          <Route path="customers/:id" element={<CustomerDetailPage />} />
          <Route path="schedule"   element={<SchedulePage />} />
          <Route path="invoices"   element={<InvoicesPage />} />
          <Route path="commission" element={<CommissionsPage />} />
          <Route path="inventory"  element={<InventoryPage />} />
          <Route path="employees"  element={<EmployeesPage />} />
          <Route path="reports"    element={<ReportsPage />} />
          <Route path="export"     element={<ExportPage />} />
          <Route path="settings"   element={<PlaceholderPage title="Settings" />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
```

- [ ] **Step 2: Add the Employees nav item to `AppShell.tsx`**

In `frontend/src/components/AppShell.tsx`, add `UserOutlined` to the icon import and add the menu item between Inventory and Reports. Full file after changes:

```tsx
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Button, Space, Typography } from 'antd'
import { LogoutOutlined, TeamOutlined, CalendarOutlined, FileTextOutlined,
         DollarOutlined, InboxOutlined, UserOutlined, BarChartOutlined,
         ExportOutlined, SettingOutlined } from '@ant-design/icons'
import { useAuth } from '../context/AuthContext'

const { Sider, Content, Header } = Layout
const { Text } = Typography

const menuItems = [
  { key: '/customers',  icon: <TeamOutlined />,     label: 'Customers' },
  { key: '/schedule',   icon: <CalendarOutlined />,  label: 'Schedule' },
  { key: '/invoices',   icon: <FileTextOutlined />,  label: 'Invoices' },
  { key: '/commission', icon: <DollarOutlined />,    label: 'Commission' },
  { key: '/inventory',  icon: <InboxOutlined />,     label: 'Inventory' },
  { key: '/employees',  icon: <UserOutlined />,      label: 'Employees' },
  { key: '/reports',    icon: <BarChartOutlined />,  label: 'Reports' },
  { key: '/export',     icon: <ExportOutlined />,    label: 'Export' },
  { key: '/settings',   icon: <SettingOutlined />,   label: 'Settings' },
]

export default function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuth()

  const selectedKey = menuItems.find(item =>
    location.pathname.startsWith(item.key)
  )?.key ?? '/customers'

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" width={220}>
        <div style={{ color: '#fff', fontSize: 18, fontWeight: 700, padding: '16px 24px', borderBottom: '1px solid #333' }}>
          HFS Field Services
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ marginTop: 8 }}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <Space>
            <Text type="secondary">{user?.displayName}</Text>
            <Button icon={<LogoutOutlined />} onClick={handleLogout} size="small">
              Sign Out
            </Button>
          </Space>
        </Header>
        <Content style={{ padding: 24, background: '#f5f5f5' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd C:\dev\HFS-SaaS\frontend
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Start the dev server and smoke test**

```bash
cd C:\dev\HFS-SaaS\frontend
npm run dev
```

Open `http://localhost:3000`. Verify:
- "Employees" appears in the sidebar between Inventory and Reports
- Clicking it navigates to `/employees`
- The employee table loads with Active/Inactive tags
- Expanding a row shows the period sub-table
- Adding a new employee via the modal creates them and refreshes the list
- Editing a name works
- Adding a period with overlapping dates shows the error message
- The Deactivate button appears for employees with `isInUse = true`; Delete for others

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/AppShell.tsx
git commit -m "feat: wire /employees route and nav item"
```
