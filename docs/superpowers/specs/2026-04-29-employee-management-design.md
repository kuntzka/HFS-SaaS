# Employee Management — Design Spec

**Date:** 2026-04-29
**Status:** Approved
**Scope:** New `EmployeesPage` + `EmployeesController` + `EmployeeRepository` + `employee_activity_period` schema

---

## Context

The existing `employee` table has a simple `is_active BIT` and a nullable `start_date DATE` column. These are insufficient for field service operations where technicians quit and are rehired — a common occurrence. This spec replaces the boolean with a proper date-range activity model and builds the management UI to go with it.

This is **Spec 1 of 3** in a sequence:
1. **Employee Management** (this spec) — foundation
2. **Route Management** — CRUD + default technician per route (reads employee data)
3. **Customer Invoice History** — per-customer invoice table with salesperson + technician columns

---

## Goals

- Replace `is_active` / `start_date` with an `employee_activity_period` table supporting multiple non-overlapping date ranges per employee.
- Provide a management UI for employee CRUD and activity period maintenance.
- Preserve all existing behavior: employee dropdowns in Invoices/Commissions/Customers continue to work unchanged.
- Guard against hard-deleting employees who have commission history.

---

## Out of Scope

- Future-dated start dates ("scheduled but not yet active" state) — deferred.
- Historical assignment display on past invoices/commissions — already works by design (those records snapshot `employee_name` as a string).

---

## Database

### New Table: `employee_activity_period`

```sql
CREATE TABLE {SCHEMA}.employee_activity_period (
    id          INT  NOT NULL IDENTITY(1,1) PRIMARY KEY,
    employee_id INT  NOT NULL REFERENCES {SCHEMA}.employee(employee_id),
    start_date  DATE NOT NULL,
    end_date    DATE NULL   -- NULL = currently active
);
CREATE INDEX idx_emp_period ON {SCHEMA}.employee_activity_period(employee_id, start_date);
```

An employee is **currently active** if any period satisfies:
`start_date <= TODAY AND (end_date IS NULL OR end_date >= TODAY)`

### Data Migration

Each existing employee row gets one period record:

```sql
INSERT INTO {SCHEMA}.employee_activity_period (employee_id, start_date, end_date)
SELECT employee_id,
       ISNULL(start_date, '2000-01-01'),
       CASE WHEN is_active = 0 THEN CAST(GETDATE() AS DATE) ELSE NULL END
FROM {SCHEMA}.employee;
```

Employees with no `start_date` on file receive a placeholder of `2000-01-01`. Currently active employees receive an open-ended period (`end_date = NULL`). Inactive employees receive a period closed as of today.

### Column Removal

After migration, `is_active` and `start_date` are dropped from `employee`. The `is_active` column has a DEFAULT constraint that must be dropped first.

---

## Backend

### DTOs

```csharp
public record EmployeeDto(int EmployeeId, string FirstName, string LastName, bool IsActive, bool IsInUse);
public record ActivityPeriodDto(int Id, DateOnly StartDate, DateOnly? EndDate);
```

`EmployeeDto` gains `IsInUse` so the frontend can show the correct Delete vs Deactivate button on load without a round-trip. Existing callers that only read `IsActive`, `FirstName`, `LastName` are unaffected.

### `EmployeeRepository`

| Method | Description |
|---|---|
| `GetAllAsync()` | All employees with `IsActive` computed via LEFT JOIN on periods |
| `GetByIdAsync(int id)` | Single employee |
| `GetPeriodsAsync(int id)` | All periods for one employee, ordered by `start_date DESC` |
| `IsInUseAsync(int id)` | Returns true if employee has commission records OR is assigned to any customer (`customer.employee_id`) |
| `HasOverlapAsync(int employeeId, DateOnly start, DateOnly? end, int? excludePeriodId)` | Returns true if a period for this employee overlaps the given range (excluding the period being edited) |
| `CreateAsync(string firstName, string lastName, DateOnly firstPeriodStart)` | Inserts employee + first period in a transaction; returns new `employeeId` |
| `UpdateNameAsync(int id, string firstName, string lastName)` | Updates name only |
| `DeleteAsync(int id)` | Hard delete; caller must verify `IsInUse = false` first |
| `DeactivateAsync(int id)` | Sets `end_date = TODAY` on the employee's current open period |
| `AddPeriodAsync(int employeeId, DateOnly start, DateOnly? end)` | Returns new period id |
| `UpdatePeriodAsync(int periodId, DateOnly start, DateOnly? end)` | Returns bool |
| `DeletePeriodAsync(int periodId)` | Returns bool |

### `EmployeesController` — `/api/employees`

Replaces `GET /api/employees` in `ReferenceDataController` (removed). URL is identical so no callers break.

| Verb | Route | Behaviour |
|---|---|---|
| `GET` | `/api/employees` | Returns all employees with `isActive` |
| `POST` | `/api/employees` | Creates employee + first period in one transaction |
| `PUT` | `/api/employees/{id}` | Updates first/last name |
| `DELETE` | `/api/employees/{id}` | `204` if not in use; `409` with message if commission history exists |
| `POST` | `/api/employees/{id}/deactivate` | Closes open period with `end_date = today`; `204` |
| `GET` | `/api/employees/{id}/periods` | Returns periods ordered by `start_date DESC` |
| `POST` | `/api/employees/{id}/periods` | Adds period; `400` if overlap detected |
| `PUT` | `/api/employees/{id}/periods/{periodId}` | Updates period; `400` if overlap |
| `DELETE` | `/api/employees/{id}/periods/{periodId}` | Removes period |

**Request records:**

```csharp
public record CreateEmployeeRequest(string FirstName, string LastName, DateOnly FirstPeriodStart);
public record UpdateEmployeeNameRequest(string FirstName, string LastName);
public record UpsertPeriodRequest(DateOnly StartDate, DateOnly? EndDate);
```

---

## Frontend

### `EmployeesPage` (`/employees`)

Follows the `InventoryPage` pattern: a card with an **Add Employee** button, a table, and modals for add/edit.

**Main table columns:**

| Column | Notes |
|---|---|
| Last Name | Sortable |
| First Name | |
| Status | `Active` (green tag) or `Inactive` (grey tag), computed from periods |
| Actions | Edit (name modal) · Delete or Deactivate · expand chevron |

**Add Employee modal** — First name, Last name, Start date (required). Creates employee + first period in one call.

**Edit modal** — First name, Last name only. Periods are managed in the expandable row.

**Delete vs Deactivate:** The `EmployeeDto.IsInUse` flag is used on load to show the correct action immediately — no round-trip required. Employees with `isInUse = true` show **Deactivate** (with a tooltip explaining why deletion is not allowed). Employees with `isInUse = false` show **Delete** with a `Popconfirm`.

### Expandable Row — Activity Periods

Clicking the row chevron reveals a sub-table of activity periods:

| Start | End | Actions |
|---|---|---|
| 10/01/2023 | Present | Edit · Delete |
| 01/15/2019 | 06/30/2022 | Edit · Delete |

- **"Present"** is displayed when `end_date` is null.
- **Add Period** button below the sub-table.
- Add/Edit opens an inline form with two date pickers (end date optional). Overlap validation errors from the API surface as an inline `Alert` inside the form.
- Periods load lazily on first expand; cached on subsequent expand/collapse.

### Navigation

New **Employees** menu item added to `AppShell` between Inventory and Reports:

```tsx
{ key: '/employees', icon: <UserOutlined />, label: 'Employees' }
```

New route in `App.tsx`:
```tsx
<Route path="employees" element={<EmployeesPage />} />
```

---

## Invariants

- No two periods for the same employee may overlap. Enforced in the repository before insert/update.
- An employee with commission history cannot be hard-deleted. The controller returns `409`; the UI surfaces "Deactivate" instead.
- `IsActive` has a single source of truth: the periods table. The old `is_active` column is removed.
- `CreateAsync` inserts employee + first period atomically — no employee can exist without at least one period.
