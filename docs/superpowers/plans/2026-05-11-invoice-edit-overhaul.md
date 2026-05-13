# Invoice Edit Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate all invoice editing into the Invoices section — strip `InvoiceDrawer` to read-only, extract a new `InvoiceEditModal` with technician/salesperson defaults, qty editing with price recalculation, and auto-calculated commissions using live price overrides.

**Architecture:** Nine sequential tasks: five backend (migration, routes API, invoice list enrichment, svc-line qty, commission overrides) then four frontend (routes page, drawer read-only, new modal, page cleanup). Each backend task ends with a `dotnet build`; each frontend task ends with `npx tsc --noEmit`.

**Tech Stack:** .NET 8 / ASP.NET Core, Dapper, Azure SQL, React 18 + TypeScript, Ant Design 5, React Query 5

---

## File Map

| File | Change |
|---|---|
| `src/HFS.Infrastructure/Migrations/Scripts/Tenant/0009_add_route_employee.sql` | CREATE — migration |
| `src/HFS.Infrastructure/Data/ReferenceDataRepository.cs` | MODIFY — RouteDto + employee fields, GetRoutesAsync JOIN, add UpdateRouteAsync |
| `src/HFS.Api/Controllers/ReferenceDataController.cs` | MODIFY — add PUT /api/routes/{id} |
| `src/HFS.Infrastructure/Data/InvoiceRepository.cs` | MODIFY — InvoiceListItem + 2 fields, GetByWeekYearAsync query, UpdateSvcLinesAsync qty |
| `src/HFS.Api/Controllers/InvoicesController.cs` | MODIFY — SvcLineUpdate gains ServiceQty |
| `src/HFS.Application/Commissions/CommissionCommands.cs` | MODIFY — ServicePriceOverride record, PreviewCommissionCommand gains 2 fields |
| `src/HFS.Infrastructure/Commissions/PreviewCommissionHandler.cs` | MODIFY — apply AMC employee override + price overrides |
| `src/HFS.Api/Controllers/CommissionsController.cs` | MODIFY — PreviewCommissionRequest gains 2 fields |
| `frontend/src/pages/RoutesPage.tsx` | CREATE — routes admin with technician assignment |
| `frontend/src/App.tsx` | MODIFY — add /routes route |
| `frontend/src/components/AppShell.tsx` | MODIFY — add Routes menu item |
| `frontend/src/components/InvoiceDrawer.tsx` | MODIFY — strip to read-only display |
| `frontend/src/components/CustomerInvoicesTab.tsx` | MODIFY — remove onMutated prop wiring |
| `frontend/src/components/InvoiceEditModal.tsx` | CREATE — full editing modal with auto-commission |
| `frontend/src/pages/InvoicesPage.tsx` | MODIFY — remove inline modal, use InvoiceEditModal |

---

## Task 1: DB Migration — add employee_id to route

**Files:**
- Create: `src/HFS.Infrastructure/Migrations/Scripts/Tenant/0009_add_route_employee.sql`

- [ ] **Step 1: Create the migration file**

```sql
ALTER TABLE {SCHEMA}.route
    ADD employee_id INT NULL
        REFERENCES {SCHEMA}.employee(employee_id);
```

Save to `src/HFS.Infrastructure/Migrations/Scripts/Tenant/0009_add_route_employee.sql`.

The `{SCHEMA}` placeholder is replaced at runtime by `SqlConnectionFactory.Sql()`. Nullable so existing routes are unaffected.

- [ ] **Step 2: Verify build**

```bash
cd C:/dev/HFS-SaaS
dotnet build HFS.sln
```

Expected: Build succeeded, 0 errors. (Migration files are embedded resources — no C# change needed.)

- [ ] **Step 3: Commit**

```bash
git add src/HFS.Infrastructure/Migrations/Scripts/Tenant/0009_add_route_employee.sql
git commit -m "feat: add employee_id to route table (migration 0009)"
```

---

## Task 2: Routes API — GET enriched + PUT endpoint

**Files:**
- Modify: `src/HFS.Infrastructure/Data/ReferenceDataRepository.cs`
- Modify: `src/HFS.Api/Controllers/ReferenceDataController.cs`

- [ ] **Step 1: Update RouteDto and GetRoutesAsync**

In `src/HFS.Infrastructure/Data/ReferenceDataRepository.cs`, replace the `RouteDto` record and `GetRoutesAsync` method:

```csharp
// Replace:
public record RouteDto(int RouteId, string RouteCode, string? Description);

// With:
public record RouteDto(int RouteId, string RouteCode, string? Description, int? EmployeeId, string? EmployeeName);
```

```csharp
// Replace GetRoutesAsync entirely:
public async Task<IEnumerable<RouteDto>> GetRoutesAsync()
{
    using var conn = db.CreateConnection();
    return await conn.QueryAsync<RouteDto>(db.Sql("""
        SELECT r.route_id    AS RouteId,
               r.route_code  AS RouteCode,
               r.description AS Description,
               r.employee_id AS EmployeeId,
               e.first_name + ' ' + e.last_name AS EmployeeName
        FROM {schema}.route r
        LEFT JOIN {schema}.employee e ON r.employee_id = e.employee_id
        ORDER BY r.route_code
        """));
}
```

- [ ] **Step 2: Add UpdateRouteAsync**

Append this method to `ReferenceDataRepository` class (before the closing `}`):

```csharp
public async Task<bool> UpdateRouteAsync(int routeId, int? employeeId)
{
    using var conn = db.CreateConnection();
    var rows = await conn.ExecuteAsync(
        db.Sql("UPDATE {schema}.route SET employee_id = @employeeId WHERE route_id = @routeId"),
        new { routeId, employeeId });
    return rows > 0;
}
```

- [ ] **Step 3: Add PUT /api/routes/{id} to ReferenceDataController**

In `src/HFS.Api/Controllers/ReferenceDataController.cs`, add after the `GetRoutes` action:

```csharp
[HttpPut("routes/{id:int}")]
public async Task<IActionResult> UpdateRoute(int id, [FromBody] UpdateRouteRequest req)
{
    var ok = await repo.UpdateRouteAsync(id, req.EmployeeId);
    return ok ? NoContent() : NotFound();
}
```

Add the request record after the controller class (at file bottom):

```csharp
public record UpdateRouteRequest(int? EmployeeId);
```

- [ ] **Step 4: Verify build**

```bash
cd C:/dev/HFS-SaaS
dotnet build HFS.sln
```

Expected: Build succeeded, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/HFS.Infrastructure/Data/ReferenceDataRepository.cs \
        src/HFS.Api/Controllers/ReferenceDataController.cs
git commit -m "feat: enrich routes GET with employee, add PUT /api/routes/{id}"
```

---

## Task 3: Invoice list item — add employee default fields

**Files:**
- Modify: `src/HFS.Infrastructure/Data/InvoiceRepository.cs`

- [ ] **Step 1: Update InvoiceListItem record**

In `src/HFS.Infrastructure/Data/InvoiceRepository.cs`, replace the `InvoiceListItem` record:

```csharp
// Replace:
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

// With:
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
    DateTime? ServiceDate,
    int? CustomerEmployeeId,
    int? RouteEmployeeId);
```

- [ ] **Step 2: Update GetByWeekYearAsync query**

In `GetByWeekYearAsync`, replace the SQL string inside the method:

```csharp
public async Task<IEnumerable<InvoiceListItem>> GetByWeekYearAsync(short week, short year)
{
    using var conn = db.CreateConnection();
    return await conn.QueryAsync<InvoiceListItem>(db.Sql("""
        SELECT i.invoice_number       AS InvoiceNumber,
               i.customer_id          AS CustomerId,
               c.company_name         AS CompanyName,
               r.route_code           AS RouteCode,
               i.service_price        AS ServicePrice,
               i.tax                  AS Tax,
               i.taxable_amount       AS TaxableAmount,
               i.week_number          AS WeekNumber,
               i.sched_year           AS SchedYear,
               i.is_complete          AS IsComplete,
               i.is_printed           AS IsPrinted,
               i.is_ad_hoc            AS IsAdHoc,
               i.service_date         AS ServiceDate,
               c.employee_id          AS CustomerEmployeeId,
               r.employee_id          AS RouteEmployeeId
        FROM {schema}.invoice i
        JOIN {schema}.customer c     ON i.customer_id = c.customer_id
        LEFT JOIN {schema}.route r   ON c.route_id = r.route_id
        WHERE i.week_number = @week AND i.sched_year = @year
        ORDER BY r.route_code, c.company_name
        """), new { week, year });
}
```

- [ ] **Step 3: Verify build**

```bash
cd C:/dev/HFS-SaaS
dotnet build HFS.sln
```

Expected: Build succeeded, 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/HFS.Infrastructure/Data/InvoiceRepository.cs
git commit -m "feat: add CustomerEmployeeId and RouteEmployeeId to invoice list item"
```

---

## Task 4: Service line update — add ServiceQty

**Files:**
- Modify: `src/HFS.Api/Controllers/InvoicesController.cs`
- Modify: `src/HFS.Infrastructure/Data/InvoiceRepository.cs`

- [ ] **Step 1: Update SvcLineUpdate record**

In `src/HFS.Api/Controllers/InvoicesController.cs`, replace the `SvcLineUpdate` record at the bottom of the file:

```csharp
// Replace:
public record SvcLineUpdate(int Id, decimal ServicePrice, decimal Tax);

// With:
public record SvcLineUpdate(int Id, int ServiceQty, decimal ServicePrice, decimal Tax);
```

- [ ] **Step 2: Update UpdateSvcLinesAsync in repository**

In `src/HFS.Infrastructure/Data/InvoiceRepository.cs`, replace `UpdateSvcLinesAsync`:

```csharp
public async Task UpdateSvcLinesAsync(int invoiceNumber, IEnumerable<(int Id, int ServiceQty, decimal ServicePrice, decimal Tax)> lines)
{
    using var conn = db.CreateConnection();
    await conn.OpenAsync();
    using var tx = await conn.BeginTransactionAsync();

    foreach (var (id, qty, price, tax) in lines)
    {
        await conn.ExecuteAsync(db.Sql("""
            UPDATE {schema}.invoice_svc
            SET service_qty   = @qty,
                service_price = @price,
                tax           = @tax
            WHERE id = @id AND invoice_number = @invoiceNumber
            """), new { id, qty, price, tax, invoiceNumber }, tx);
    }

    await RecalcInvoiceTotalsAsync(conn, invoiceNumber, tx);
    await tx.CommitAsync();
}
```

- [ ] **Step 3: Update the controller call site**

In `InvoicesController.UpdateSvcLines`, the call to `UpdateSvcLinesAsync` passes a projection. Update it to include `ServiceQty`:

```csharp
[HttpPut("{invoiceNumber:int}/svc-lines")]
public async Task<IActionResult> UpdateSvcLines(int invoiceNumber, [FromBody] List<SvcLineUpdate> updates)
{
    await invoiceRepo.UpdateSvcLinesAsync(invoiceNumber,
        updates.Select(u => (u.Id, u.ServiceQty, u.ServicePrice, u.Tax)));
    return NoContent();
}
```

- [ ] **Step 4: Verify build**

```bash
cd C:/dev/HFS-SaaS
dotnet build HFS.sln
```

Expected: Build succeeded, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/HFS.Api/Controllers/InvoicesController.cs \
        src/HFS.Infrastructure/Data/InvoiceRepository.cs
git commit -m "feat: add ServiceQty to svc-line update payload"
```

---

## Task 5: Commission preview — AMC employee override + price overrides

**Files:**
- Modify: `src/HFS.Application/Commissions/CommissionCommands.cs`
- Modify: `src/HFS.Infrastructure/Commissions/PreviewCommissionHandler.cs`
- Modify: `src/HFS.Api/Controllers/CommissionsController.cs`

- [ ] **Step 1: Add ServicePriceOverride and update PreviewCommissionCommand**

In `src/HFS.Application/Commissions/CommissionCommands.cs`, add the new record and update the command. Replace the top of the file up through `PreviewCommissionCommand`:

```csharp
using MediatR;

namespace HFS.Application.Commissions;

public record ServicePriceOverride(int CustomerSvcId, decimal ServicePrice);

public record PreviewCommissionCommand(
    int InvoiceNumber,
    DateOnly ServiceDate,
    int? SacEmployeeId,
    bool CalculateAmc,
    int? AmcEmployeeId,
    IReadOnlyList<ServicePriceOverride>? Overrides
) : IRequest<IReadOnlyList<CommissionPreviewItem>>;
```

Leave `SaveCommissionsCommand`, `CommissionPreviewItem`, `SaveCommissionItem`, and `CommissionListItem` unchanged.

- [ ] **Step 2: Update PreviewCommissionHandler to apply overrides**

Replace `PreviewCommissionHandler.Handle` in `src/HFS.Infrastructure/Commissions/PreviewCommissionHandler.cs`:

```csharp
public async Task<IReadOnlyList<CommissionPreviewItem>> Handle(
    PreviewCommissionCommand cmd, CancellationToken ct)
{
    var customerId = await commissionRepo.GetCustomerIdByInvoiceAsync(cmd.InvoiceNumber);
    var services = (await commissionRepo.GetServicesForCommissionAsync(customerId)).ToList();
    var serviceDate = cmd.ServiceDate.ToDateTime(TimeOnly.MinValue);
    var results = new List<CommissionPreviewItem>();

    // Build price override lookup: customerSvcId → overridden ServicePrice
    var overrideMap = (cmd.Overrides ?? [])
        .ToDictionary(o => o.CustomerSvcId, o => o.ServicePrice);

    // SAC: service agent commission — employee selected by user
    if (cmd.SacEmployeeId.HasValue)
    {
        int seniority = await commissionRepo.GetEmployeeExperienceAsync(cmd.SacEmployeeId.Value, serviceDate);
        string sacName = await commissionRepo.GetEmployeeNameAsync(cmd.SacEmployeeId.Value);

        foreach (var svc in services)
        {
            ct.ThrowIfCancellationRequested();
            var numWeek = CommissionCalculator.GetNumServiceWeek(serviceDate, svc.FirstServiceDate);
            var effectivePrice = overrideMap.TryGetValue(svc.CustomerSvcId, out var ov) ? ov : svc.ServicePrice;

            var (amount, payrollType, ruleDesc) = await CalculateSacAsync(
                svc.ServiceTypeId, svc.CustomerType, svc.Distance,
                numWeek, seniority, effectivePrice);

            results.Add(new CommissionPreviewItem(
                CustomerSvcId: svc.CustomerSvcId,
                CustomerId: svc.CustomerId,
                CompanyName: svc.CompanyName,
                ServiceTypeName: svc.ServiceTypeName,
                ServicePrice: effectivePrice,
                FrequencyCode: svc.FrequencyCode,
                StartWeek: svc.StartWeek,
                NumServiceWeek: numWeek,
                CommissionType: "SAC",
                EmployeeId: cmd.SacEmployeeId,
                EmployeeName: sacName,
                CommissionAmount: Math.Round(amount, 2),
                PayrollType: payrollType,
                RuleDescription: ruleDesc,
                IsFirstCommission: false
            ));
        }
    }

    // AMC: account manager commission
    // AmcEmployeeId overrides per-service customer employee when provided
    if (cmd.CalculateAmc)
    {
        var excludedIds = await commissionRepo.GetExcludedEmployeeIdsAsync();

        foreach (var svc in services)
        {
            ct.ThrowIfCancellationRequested();
            if (!svc.YnCommission) continue;

            // Use explicit override employee if provided, else fall back to service's customer employee
            int? resolvedEmployeeId = cmd.AmcEmployeeId ?? svc.EmployeeId;
            if (resolvedEmployeeId.HasValue && excludedIds.Contains(resolvedEmployeeId.Value)) continue;

            var numWeek = CommissionCalculator.GetNumServiceWeek(serviceDate, svc.FirstServiceDate);
            int empId = resolvedEmployeeId ?? 0;

            // Resolve employee name: use override employee's name if AmcEmployeeId is set
            string employeeName = cmd.AmcEmployeeId.HasValue
                ? await commissionRepo.GetEmployeeNameAsync(cmd.AmcEmployeeId.Value)
                : svc.EmployeeName;

            var effectivePrice = overrideMap.TryGetValue(svc.CustomerSvcId, out var ov) ? ov : svc.ServicePrice;

            var (amount, payrollType, ruleDesc) = await CalculateAmcAsync(
                empId, numWeek, svc.ServiceTypeId, effectivePrice);

            // Quarterly first-commission: if rate > 30% and already paid, zero out
            bool isFirst = false;
            if ((svc.FrequencyCode == "Q" || svc.FrequencyCode == "W12") && amount > 0)
            {
                decimal rate = effectivePrice > 0 ? amount / effectivePrice : 0;
                if (rate > 0.3m)
                {
                    if (svc.CommissionPaid)
                        amount = 0;
                    else
                        isFirst = true;
                }
            }

            results.Add(new CommissionPreviewItem(
                CustomerSvcId: svc.CustomerSvcId,
                CustomerId: svc.CustomerId,
                CompanyName: svc.CompanyName,
                ServiceTypeName: svc.ServiceTypeName,
                ServicePrice: effectivePrice,
                FrequencyCode: svc.FrequencyCode,
                StartWeek: svc.StartWeek,
                NumServiceWeek: numWeek,
                CommissionType: "AMC",
                EmployeeId: resolvedEmployeeId,
                EmployeeName: employeeName,
                CommissionAmount: Math.Round(amount, 2),
                PayrollType: payrollType,
                RuleDescription: ruleDesc,
                IsFirstCommission: isFirst
            ));
        }
    }

    return results;
}
```

Leave `CalculateSacAsync` and `CalculateAmcAsync` private methods unchanged.

- [ ] **Step 3: Update PreviewCommissionRequest in CommissionsController**

In `src/HFS.Api/Controllers/CommissionsController.cs`, replace the `PreviewCommissionRequest` record and the `Preview` action:

```csharp
[HttpPost("preview")]
public async Task<IActionResult> Preview([FromBody] PreviewCommissionRequest req, CancellationToken ct)
{
    var result = await mediator.Send(
        new PreviewCommissionCommand(
            req.InvoiceNumber,
            req.ServiceDate,
            req.SacEmployeeId,
            req.CalculateAmc,
            req.AmcEmployeeId,
            req.Overrides), ct);
    return Ok(result);
}
```

```csharp
// Replace the PreviewCommissionRequest record:
public record PreviewCommissionRequest(
    int InvoiceNumber,
    DateOnly ServiceDate,
    int? SacEmployeeId,
    bool CalculateAmc,
    int? AmcEmployeeId,
    IReadOnlyList<ServicePriceOverride>? Overrides);
```

Add a using for `HFS.Application.Commissions` at the top if not already present (it should be — `CommissionCommands.cs` is already in scope).

- [ ] **Step 4: Verify build**

```bash
cd C:/dev/HFS-SaaS
dotnet build HFS.sln
```

Expected: Build succeeded, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/HFS.Application/Commissions/CommissionCommands.cs \
        src/HFS.Infrastructure/Commissions/PreviewCommissionHandler.cs \
        src/HFS.Api/Controllers/CommissionsController.cs
git commit -m "feat: commission preview accepts AMC employee override and price overrides"
```

---

## Task 6: Routes admin page

**Files:**
- Create: `frontend/src/pages/RoutesPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/AppShell.tsx`

- [ ] **Step 1: Create RoutesPage.tsx**

Create `frontend/src/pages/RoutesPage.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { Table, Select, Button, Typography, message } from 'antd'
import client from '../api/client'

const { Title } = Typography

interface RouteItem {
  routeId: number
  routeCode: string
  description: string | null
  employeeId: number | null
  employeeName: string | null
}

interface Employee {
  employeeId: number
  firstName: string
  lastName: string
  isActive: boolean
}

export default function RoutesPage() {
  const [routes, setRoutes] = useState<RouteItem[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<number | null>(null)
  const [pending, setPending] = useState<Record<number, number | null>>({})

  useEffect(() => {
    Promise.all([
      client.get<RouteItem[]>('/routes'),
      client.get<Employee[]>('/employees'),
    ])
      .then(([routesRes, empRes]) => {
        setRoutes(routesRes.data)
        setEmployees(empRes.data.filter((e: Employee) => e.isActive))
        const init: Record<number, number | null> = {}
        routesRes.data.forEach((r: RouteItem) => { init[r.routeId] = r.employeeId })
        setPending(init)
      })
      .catch(() => message.error('Failed to load routes'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave(routeId: number) {
    setSaving(routeId)
    try {
      await client.put(`/routes/${routeId}`, { employeeId: pending[routeId] ?? null })
      message.success('Route saved')
      setRoutes(prev =>
        prev.map(r => r.routeId === routeId ? { ...r, employeeId: pending[routeId] ?? null } : r)
      )
    } catch {
      message.error('Failed to save route')
    } finally {
      setSaving(null)
    }
  }

  const columns = [
    { title: 'Route', dataIndex: 'routeCode', key: 'routeCode', width: 120 },
    {
      title: 'Description', dataIndex: 'description', key: 'description',
      render: (v: string | null) => v ?? '—',
    },
    {
      title: 'Default Technician',
      key: 'technician',
      render: (_: unknown, record: RouteItem) => (
        <Select
          style={{ width: 220 }}
          allowClear
          placeholder="None"
          value={pending[record.routeId] ?? undefined}
          onChange={v => setPending(prev => ({ ...prev, [record.routeId]: v ?? null }))}
          options={employees.map(e => ({
            value: e.employeeId,
            label: `${e.lastName}, ${e.firstName}`,
          }))}
        />
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_: unknown, record: RouteItem) => (
        <Button
          size="small"
          type="primary"
          loading={saving === record.routeId}
          onClick={() => handleSave(record.routeId)}
        >
          Save
        </Button>
      ),
    },
  ]

  return (
    <>
      <Title level={4} style={{ marginTop: 0 }}>Routes</Title>
      <Table
        dataSource={routes}
        columns={columns}
        rowKey="routeId"
        loading={loading}
        size="small"
        pagination={false}
      />
    </>
  )
}
```

- [ ] **Step 2: Add /routes to App.tsx**

In `frontend/src/App.tsx`, add the import and route:

```tsx
// Add import alongside other page imports:
import RoutesPage from './pages/RoutesPage'

// Add route inside the AppShell children, after the employees route:
<Route path="routes" element={<RoutesPage />} />
```

- [ ] **Step 3: Add Routes to AppShell menu**

In `frontend/src/components/AppShell.tsx`, add `EnvironmentOutlined` to the icons import and add the menu item:

```tsx
// Update the icons import line to include EnvironmentOutlined:
import { LogoutOutlined, TeamOutlined, CalendarOutlined, FileTextOutlined,
         DollarOutlined, InboxOutlined, UserOutlined, BarChartOutlined,
         ExportOutlined, SettingOutlined, EnvironmentOutlined } from '@ant-design/icons'

// Add to menuItems array after the employees entry:
{ key: '/routes',    icon: <EnvironmentOutlined />,  label: 'Routes' },
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd C:/dev/HFS-SaaS/frontend
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/RoutesPage.tsx \
        frontend/src/App.tsx \
        frontend/src/components/AppShell.tsx
git commit -m "feat: add routes admin page with technician assignment"
```

---

## Task 7: InvoiceDrawer — strip to read-only

**Files:**
- Modify: `frontend/src/components/InvoiceDrawer.tsx`
- Modify: `frontend/src/components/CustomerInvoicesTab.tsx`

- [ ] **Step 1: Replace InvoiceDrawer.tsx with read-only version**

Replace the entire contents of `frontend/src/components/InvoiceDrawer.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Drawer, Descriptions, Tag, Button, Space, Table } from 'antd'
import dayjs from 'dayjs'
import client from '../api/client'
import type { CustomerInvoiceSummary } from './CustomerInvoicesTab'

interface SvcLine {
  id: number
  serviceDesc: string
  serviceQty: number
  servicePrice: number
  tax: number
  comments: string | null
}

interface Props {
  invoice: CustomerInvoiceSummary | null
  onClose: () => void
}

export function InvoiceDrawer({ invoice, onClose }: Props) {
  const open = invoice !== null
  const [lines, setLines] = useState<SvcLine[]>([])
  const [linesLoading, setLinesLoading] = useState(false)

  useEffect(() => {
    if (!invoice) return
    setLines([])
    setLinesLoading(true)
    let cancelled = false
    client
      .get<SvcLine[]>(`/invoices/${invoice.invoiceNumber}/svc-lines`)
      .then(r => { if (!cancelled) setLines(r.data) })
      .finally(() => { if (!cancelled) setLinesLoading(false) })
    return () => { cancelled = true }
  }, [invoice?.invoiceNumber])

  const fmt = (n: number) => `$${n.toFixed(2)}`

  const columns = [
    { title: 'Description', dataIndex: 'serviceDesc', key: 'serviceDesc' },
    { title: 'Qty', dataIndex: 'serviceQty', key: 'serviceQty', width: 60 },
    { title: 'Price', dataIndex: 'servicePrice', key: 'servicePrice', width: 100, render: fmt },
    { title: 'Tax', dataIndex: 'tax', key: 'tax', width: 80, render: fmt },
    {
      title: 'Total', key: 'total', width: 90,
      render: (_: unknown, l: SvcLine) => fmt(l.servicePrice + l.tax),
    },
    {
      title: 'Comments', dataIndex: 'comments', key: 'comments',
      render: (v: string | null) => v ?? '—',
    },
  ]

  if (!invoice) return null

  const total = fmt(invoice.servicePrice + invoice.tax)

  return (
    <Drawer
      title={
        <Space>
          {`Invoice #${invoice.invoiceNumber}`}
          {invoice.isComplete
            ? <Tag color="green">Complete</Tag>
            : <Tag>Pending</Tag>}
        </Space>
      }
      open={open}
      onClose={onClose}
      width={560}
      destroyOnClose
    >
      <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="Invoice Date">
          {dayjs(invoice.invoiceDate).format('MM/DD/YYYY')}
        </Descriptions.Item>
        <Descriptions.Item label="Service Date">
          {invoice.serviceDate ? dayjs(invoice.serviceDate).format('MM/DD/YYYY') : '—'}
        </Descriptions.Item>
        <Descriptions.Item label="Total">{total}</Descriptions.Item>
        <Descriptions.Item label="Qty">{invoice.serviceQty}</Descriptions.Item>
      </Descriptions>

      <Button onClick={() => window.open(`/api/reports/invoice/${invoice.invoiceNumber}/pdf`, '_blank')}>
        View PDF
      </Button>

      <Table<SvcLine>
        dataSource={lines}
        columns={columns}
        rowKey="id"
        size="small"
        pagination={false}
        loading={linesLoading}
        style={{ marginTop: 16 }}
        locale={{ emptyText: 'No service lines' }}
      />
    </Drawer>
  )
}
```

- [ ] **Step 2: Update CustomerInvoicesTab to remove onMutated**

In `frontend/src/components/CustomerInvoicesTab.tsx`:

Remove the `useQueryClient` import and usage, remove `handleMutated`, and update the `InvoiceDrawer` usage to remove `onMutated`:

```tsx
// Remove this import:
// import { useQuery, useQueryClient } from '@tanstack/react-query'
// Replace with:
import { useQuery } from '@tanstack/react-query'

// Remove these lines from the component body:
// const queryClient = useQueryClient()
// function handleMutated() {
//   queryClient.invalidateQueries({ queryKey: ['customer-invoices', customerId] })
// }

// Replace the InvoiceDrawer usage:
<InvoiceDrawer
  invoice={selectedInvoice}
  onClose={() => setSelectedInvoice(null)}
/>
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd C:/dev/HFS-SaaS/frontend
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/InvoiceDrawer.tsx \
        frontend/src/components/CustomerInvoicesTab.tsx
git commit -m "feat: strip InvoiceDrawer to read-only, remove edit from customer invoices tab"
```

---

## Task 8: InvoiceEditModal component

**Files:**
- Create: `frontend/src/components/InvoiceEditModal.tsx`

- [ ] **Step 1: Create InvoiceEditModal.tsx**

Create `frontend/src/components/InvoiceEditModal.tsx` with the full content below.

Key design notes before reading:
- `InvoiceItem` is defined here and exported — `InvoicesPage.tsx` will import it from here in Task 9.
- `localQtys` tracks in-progress qty edits separately from `editedLines`. `onChange` updates `localQtys` only; `onBlur` commits the new qty + recalculated price to `editedLines` and triggers commission recalc. This avoids the stale-closure bug where `editedLines` would already have the new qty by the time `onBlur` fires, making the unit-price calculation wrong.
- `triggerRecalc` accepts optional overrides for all commission inputs so event handlers can pass freshly-changed values before React state commits.

```tsx
import { useState, useEffect, useCallback } from 'react'
import {
  Modal, DatePicker, Select, Checkbox, Table, InputNumber, Button,
  Space, Divider, Tag, message, Popconfirm, Input, Typography,
} from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import client from '../api/client'

const { Text } = Typography

export interface InvoiceItem {
  invoiceNumber: number
  customerId: number
  companyName: string
  routeCode: string | null
  servicePrice: number
  tax: number
  taxableAmount: number
  weekNumber: number
  schedYear: number
  isComplete: boolean
  isPrinted: boolean
  isAdHoc: boolean
  serviceDate: string | null
  customerEmployeeId: number | null
  routeEmployeeId: number | null
}

interface EditableSvcLine {
  id: number
  customerSvcId: number
  serviceDesc: string
  serviceQty: number
  servicePrice: number
  tax: number
  comments: string | null
}

interface Employee {
  employeeId: number
  firstName: string
  lastName: string
  isActive: boolean
}

interface CommissionPreviewItem {
  customerSvcId: number
  customerId: number
  companyName: string
  serviceTypeName: string
  servicePrice: number
  frequencyCode: string
  startWeek: number
  numServiceWeek: number
  commissionType: string
  employeeId: number | null
  employeeName: string
  commissionAmount: number
  payrollType: number
  ruleDescription: string
  isFirstCommission: boolean
}

interface NewLineValues {
  serviceDesc: string
  serviceQty: number
  servicePrice: number
  tax: number
  comments: string
}

const NEW_LINE_ID = 0 as const
type DisplayLine = EditableSvcLine | { id: typeof NEW_LINE_ID }

interface Props {
  invoice: InvoiceItem | null
  onClose: () => void
  onSaved: () => void
}

export function InvoiceEditModal({ invoice, onClose, onSaved }: Props) {
  const open = invoice !== null

  const [serviceDate, setServiceDate] = useState<Dayjs | null>(null)
  const [sacEmployeeId, setSacEmployeeId] = useState<number | null>(null)
  const [amcEmployeeId, setAmcEmployeeId] = useState<number | null>(null)
  const [includeAmc, setIncludeAmc] = useState(true)

  const [editedLines, setEditedLines] = useState<EditableSvcLine[]>([])
  const [localQtys, setLocalQtys] = useState<Record<number, number>>({})
  const [linesLoading, setLinesLoading] = useState(false)

  const [employees, setEmployees] = useState<Employee[]>([])

  const [commPreview, setCommPreview] = useState<CommissionPreviewItem[]>([])
  const [commPreviewing, setCommPreviewing] = useState(false)

  const [adding, setAdding] = useState(false)
  const [newLine, setNewLine] = useState<NewLineValues>({
    serviceDesc: '', serviceQty: 1, servicePrice: 0, tax: 0, comments: '',
  })
  const [savingNew, setSavingNew] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const [saving, setSaving] = useState(false)

  const runCommissionPreview = useCallback(async (
    inv: InvoiceItem,
    date: Dayjs | null,
    sac: number | null,
    amc: number | null,
    incAmc: boolean,
    lines: EditableSvcLine[]
  ) => {
    if (!date) return
    setCommPreviewing(true)
    try {
      const overrides = lines.map(l => ({ customerSvcId: l.customerSvcId, servicePrice: l.servicePrice }))
      const res = await client.post<CommissionPreviewItem[]>('/commissions/preview', {
        invoiceNumber: inv.invoiceNumber,
        serviceDate: date.format('YYYY-MM-DD'),
        sacEmployeeId: sac,
        calculateAmc: incAmc,
        amcEmployeeId: amc,
        overrides,
      })
      setCommPreview(res.data)
    } catch {
      message.error('Failed to calculate commission')
    } finally {
      setCommPreviewing(false)
    }
  }, [])

  // Load service lines and employees when invoice changes; set all defaults.
  useEffect(() => {
    if (!invoice) return
    const defaultDate = invoice.serviceDate ? dayjs(invoice.serviceDate) : dayjs()
    setServiceDate(defaultDate)
    setSacEmployeeId(invoice.routeEmployeeId ?? null)
    setAmcEmployeeId(invoice.customerEmployeeId ?? null)
    setIncludeAmc(true)
    setCommPreview([])
    setAdding(false)
    setNewLine({ serviceDesc: '', serviceQty: 1, servicePrice: 0, tax: 0, comments: '' })

    setLinesLoading(true)
    Promise.all([
      client.get<EditableSvcLine[]>(`/invoices/${invoice.invoiceNumber}/svc-lines`),
      employees.length === 0 ? client.get<Employee[]>('/employees') : Promise.resolve(null),
    ])
      .then(([linesRes, empRes]) => {
        const lines = linesRes.data
        setEditedLines(lines)
        const qtys: Record<number, number> = {}
        lines.forEach(l => { qtys[l.id] = l.serviceQty })
        setLocalQtys(qtys)
        if (empRes) setEmployees(empRes.data.filter((e: Employee) => e.isActive))
        // Auto-calculate using freshly loaded lines and already-set defaults
        runCommissionPreview(
          invoice,
          defaultDate,
          invoice.routeEmployeeId ?? null,
          invoice.customerEmployeeId ?? null,
          true,
          lines
        )
      })
      .catch(() => message.error('Failed to load invoice data'))
      .finally(() => setLinesLoading(false))
  }, [invoice?.invoiceNumber]) // eslint-disable-line react-hooks/exhaustive-deps

  function triggerRecalc(
    date: Dayjs | null = serviceDate,
    sac: number | null = sacEmployeeId,
    amc: number | null = amcEmployeeId,
    incAmc: boolean = includeAmc,
    lines: EditableSvcLine[] = editedLines
  ) {
    if (!invoice) return
    runCommissionPreview(invoice, date, sac, amc, incAmc, lines)
  }

  function handleQtyBlur(lineId: number) {
    const newQty = localQtys[lineId]
    if (newQty == null || newQty < 1) return
    const line = editedLines.find(l => l.id === lineId)
    if (!line) return
    // Compute unit price from the committed servicePrice / committed serviceQty
    // (editedLines still holds the old qty since we only update it here on blur)
    const unitPrice = line.serviceQty > 0 ? line.servicePrice / line.serviceQty : 0
    const newPrice = Math.round(unitPrice * newQty * 100) / 100
    const updatedLines = editedLines.map(l =>
      l.id === lineId ? { ...l, serviceQty: newQty, servicePrice: newPrice } : l
    )
    setEditedLines(updatedLines)
    triggerRecalc(serviceDate, sacEmployeeId, amcEmployeeId, includeAmc, updatedLines)
  }

  async function handleSaveNew() {
    if (!invoice || !newLine.serviceDesc.trim()) return
    setSavingNew(true)
    try {
      await client.post(`/invoices/${invoice.invoiceNumber}/svc-lines`, {
        serviceDesc: newLine.serviceDesc.trim(),
        serviceQty: newLine.serviceQty,
        servicePrice: newLine.servicePrice,
        tax: newLine.tax,
        comments: newLine.comments || null,
      })
      const linesRes = await client.get<EditableSvcLine[]>(`/invoices/${invoice.invoiceNumber}/svc-lines`)
      const lines = linesRes.data
      setEditedLines(lines)
      const qtys: Record<number, number> = {}
      lines.forEach(l => { qtys[l.id] = l.serviceQty })
      setLocalQtys(qtys)
      setAdding(false)
      setNewLine({ serviceDesc: '', serviceQty: 1, servicePrice: 0, tax: 0, comments: '' })
      triggerRecalc(serviceDate, sacEmployeeId, amcEmployeeId, includeAmc, lines)
    } catch {
      message.error('Failed to add service line')
    } finally {
      setSavingNew(false)
    }
  }

  async function handleDeleteLine(id: number) {
    if (!invoice) return
    setDeletingId(id)
    try {
      await client.delete(`/invoices/${invoice.invoiceNumber}/svc-lines/${id}`)
      const updatedLines = editedLines.filter(l => l.id !== id)
      setEditedLines(updatedLines)
      setLocalQtys(prev => { const n = { ...prev }; delete n[id]; return n })
      triggerRecalc(serviceDate, sacEmployeeId, amcEmployeeId, includeAmc, updatedLines)
    } catch {
      message.error('Failed to delete service line')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleSave() {
    if (!invoice) return
    setSaving(true)
    try {
      await client.put(`/invoices/${invoice.invoiceNumber}/service-date`, {
        serviceDate: serviceDate ? serviceDate.format('YYYY-MM-DD') : null,
      })
      if (editedLines.length > 0) {
        await client.put(`/invoices/${invoice.invoiceNumber}/svc-lines`,
          editedLines.map(l => ({
            id: l.id,
            serviceQty: l.serviceQty,
            servicePrice: l.servicePrice,
            tax: l.tax,
          }))
        )
      }
      if (commPreview.length > 0 && serviceDate) {
        await client.post('/commissions/save', {
          invoiceNumber: invoice.invoiceNumber,
          serviceDate: serviceDate.format('YYYY-MM-DD'),
          items: commPreview.map(p => ({
            customerSvcId: p.customerSvcId,
            customerId: p.customerId,
            companyName: p.companyName,
            serviceTypeName: p.serviceTypeName,
            frequencyCode: p.frequencyCode,
            startWeek: p.startWeek,
            numServiceWeek: p.numServiceWeek,
            commissionType: p.commissionType,
            employeeId: p.employeeId,
            employeeName: p.employeeName,
            commissionAmount: p.commissionAmount,
            servicePrice: p.servicePrice,
            payrollType: p.payrollType,
            isFirstCommission: p.isFirstCommission,
          })),
        })
      }
      onSaved()
      onClose()
    } catch {
      message.error('Failed to save invoice')
    } finally {
      setSaving(false)
    }
  }

  const fmt = (n: number) => `$${n.toFixed(2)}`
  const lineTotal = editedLines.reduce((s, l) => s + l.servicePrice + l.tax, 0)
  const displayLines: DisplayLine[] = [...editedLines, ...(adding ? [{ id: NEW_LINE_ID }] : [])]

  const empOptions = employees.map(e => ({
    value: e.employeeId,
    label: `${e.lastName}, ${e.firstName}`,
  }))

  const svcColumns = [
    {
      title: 'Description', key: 'serviceDesc',
      render: (_: unknown, record: DisplayLine) => {
        if (record.id === NEW_LINE_ID) return (
          <Input size="small" placeholder="Description" value={newLine.serviceDesc}
            onChange={e => setNewLine(prev => ({ ...prev, serviceDesc: e.target.value }))} />
        )
        return (record as EditableSvcLine).serviceDesc
      },
    },
    {
      title: 'Qty', key: 'serviceQty', width: 80,
      render: (_: unknown, record: DisplayLine) => {
        if (record.id === NEW_LINE_ID) return (
          <InputNumber size="small" min={1} value={newLine.serviceQty} style={{ width: '100%' }}
            onChange={v => setNewLine(prev => ({ ...prev, serviceQty: v ?? 1 }))} />
        )
        const line = record as EditableSvcLine
        return (
          <InputNumber
            size="small" min={1} style={{ width: '100%' }}
            value={localQtys[line.id] ?? line.serviceQty}
            onChange={v => setLocalQtys(prev => ({ ...prev, [line.id]: v ?? 1 }))}
            onBlur={() => handleQtyBlur(line.id)}
          />
        )
      },
    },
    {
      title: 'Price', key: 'servicePrice', width: 110,
      render: (_: unknown, record: DisplayLine) => {
        if (record.id === NEW_LINE_ID) return (
          <InputNumber size="small" min={0} precision={2} prefix="$"
            value={newLine.servicePrice} style={{ width: '100%' }}
            onChange={v => setNewLine(prev => ({ ...prev, servicePrice: v ?? 0 }))} />
        )
        const line = record as EditableSvcLine
        return (
          <InputNumber size="small" min={0} precision={2} prefix="$"
            value={line.servicePrice} style={{ width: '100%' }}
            onChange={v => setEditedLines(prev =>
              prev.map(l => l.id === line.id ? { ...l, servicePrice: v ?? 0 } : l))}
            onBlur={() => triggerRecalc()} />
        )
      },
    },
    {
      title: 'Tax', key: 'tax', width: 100,
      render: (_: unknown, record: DisplayLine) => {
        if (record.id === NEW_LINE_ID) return (
          <InputNumber size="small" min={0} precision={2} prefix="$"
            value={newLine.tax} style={{ width: '100%' }}
            onChange={v => setNewLine(prev => ({ ...prev, tax: v ?? 0 }))} />
        )
        const line = record as EditableSvcLine
        return (
          <InputNumber size="small" min={0} precision={2} prefix="$"
            value={line.tax} style={{ width: '100%' }}
            onChange={v => setEditedLines(prev =>
              prev.map(l => l.id === line.id ? { ...l, tax: v ?? 0 } : l))}
            onBlur={() => triggerRecalc()} />
        )
      },
    },
    {
      title: 'Total', key: 'lineTotal', width: 90,
      render: (_: unknown, record: DisplayLine) => {
        if (record.id === NEW_LINE_ID) return fmt(newLine.servicePrice + newLine.tax)
        const line = record as EditableSvcLine
        return fmt(line.servicePrice + line.tax)
      },
    },
    {
      title: '', key: 'actions', width: 110,
      render: (_: unknown, record: DisplayLine) => {
        if (record.id === NEW_LINE_ID) return (
          <Space size={4}>
            <Button size="small" type="primary" loading={savingNew}
              disabled={!newLine.serviceDesc.trim()} onClick={handleSaveNew}>
              Save
            </Button>
            <Button size="small" onClick={() => setAdding(false)}>Cancel</Button>
          </Space>
        )
        const line = record as EditableSvcLine
        return (
          <Popconfirm title="Remove this line?" okText="Remove" okButtonProps={{ danger: true }}
            onConfirm={() => handleDeleteLine(line.id)}>
            <Button size="small" icon={<DeleteOutlined />} danger loading={deletingId === line.id} />
          </Popconfirm>
        )
      },
    },
  ]

  const commColumns = [
    { title: 'Employee', dataIndex: 'employeeName', key: 'employeeName' },
    { title: 'Type', dataIndex: 'commissionType', key: 'commissionType', width: 60 },
    { title: 'Service', dataIndex: 'serviceTypeName', key: 'serviceTypeName' },
    {
      title: 'Amount', key: 'commissionAmount', width: 120, align: 'right' as const,
      render: (_: unknown, item: CommissionPreviewItem, idx: number) => (
        <InputNumber size="small" value={item.commissionAmount} min={0} precision={2}
          prefix="$" style={{ width: 110 }}
          onChange={v => setCommPreview(prev =>
            prev.map((p, i) => i === idx ? { ...p, commissionAmount: v ?? 0 } : p))} />
      ),
    },
    {
      title: '', key: 'flags', width: 60,
      render: (_: unknown, item: CommissionPreviewItem) =>
        item.isFirstCommission ? <Tag color="purple">1st</Tag> : null,
    },
  ]

  if (!invoice) return null

  return (
    <Modal
      title={`Invoice #${invoice.invoiceNumber} — ${invoice.companyName}`}
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      okText="Save"
      confirmLoading={saving}
      width={900}
      destroyOnClose
    >
      {/* Row 1: Header controls */}
      <Space wrap align="center" style={{ marginBottom: 16 }}>
        <Text strong>Service Date:</Text>
        <DatePicker
          value={serviceDate}
          format="MM/DD/YYYY"
          onChange={date => {
            setServiceDate(date)
            triggerRecalc(date)
          }}
        />
        <Text strong>Technician:</Text>
        <Select
          style={{ width: 190 }}
          placeholder="None"
          allowClear
          value={sacEmployeeId ?? undefined}
          onChange={v => {
            const val = v ?? null
            setSacEmployeeId(val)
            triggerRecalc(serviceDate, val)
          }}
          options={empOptions}
        />
        <Text strong>Sales Person:</Text>
        <Select
          style={{ width: 190 }}
          placeholder="None"
          allowClear
          value={amcEmployeeId ?? undefined}
          onChange={v => {
            const val = v ?? null
            setAmcEmployeeId(val)
            triggerRecalc(serviceDate, sacEmployeeId, val)
          }}
          options={empOptions}
        />
        <Checkbox
          checked={includeAmc}
          onChange={e => {
            setIncludeAmc(e.target.checked)
            triggerRecalc(serviceDate, sacEmployeeId, amcEmployeeId, e.target.checked)
          }}
        >
          Include AMC
        </Checkbox>
      </Space>

      {/* Row 2: Service lines */}
      <Table<DisplayLine>
        dataSource={displayLines}
        columns={svcColumns}
        rowKey="id"
        size="small"
        pagination={false}
        loading={linesLoading}
        locale={{ emptyText: 'No service lines' }}
        summary={() =>
          editedLines.length > 0 ? (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4}>
                <Text strong>Total</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={4}>
                <Text strong>{fmt(lineTotal)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={5} />
            </Table.Summary.Row>
          ) : null
        }
      />

      {/* Row 3: Add line */}
      <Space style={{ marginTop: 8, marginBottom: 8 }}>
        {!adding && (
          <Button type="dashed" icon={<PlusOutlined />} size="small" onClick={() => setAdding(true)}>
            Add Line
          </Button>
        )}
      </Space>

      <Divider style={{ margin: '8px 0' }} />

      {/* Row 4: Commission */}
      <Space style={{ marginBottom: 8 }}>
        <Text strong>Commission</Text>
        <Button size="small" loading={commPreviewing} onClick={() => triggerRecalc()}>
          Recalculate
        </Button>
      </Space>

      <Table<CommissionPreviewItem>
        dataSource={commPreview}
        columns={commColumns}
        rowKey={(_, i) => String(i)}
        size="small"
        pagination={false}
        loading={commPreviewing}
        locale={{ emptyText: 'No commission — service date or technician not set' }}
      />
    </Modal>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd C:/dev/HFS-SaaS/frontend
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/InvoiceEditModal.tsx
git commit -m "feat: add InvoiceEditModal with auto-commission, qty editing, technician/salesperson defaults"
```

---

## Task 9: InvoicesPage — remove inline modal, use InvoiceEditModal

**Files:**
- Modify: `frontend/src/pages/InvoicesPage.tsx`

- [ ] **Step 1: Update imports**

At the top of `frontend/src/pages/InvoicesPage.tsx`, replace the existing imports:

```tsx
import { useState } from 'react'
import { Alert, Button, Card, Col, DatePicker, Divider, InputNumber, message,
         Modal, Popconfirm, Row, Select, Space, Spin, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CheckOutlined, EditOutlined, FileTextOutlined, PrinterOutlined, ThunderboltOutlined } from '@ant-design/icons'
import client, { getAccessToken } from '../api/client'
import dayjs, { type Dayjs } from 'dayjs'
```

Replace with:

```tsx
import { useState } from 'react'
import { Alert, Button, Card, Col, InputNumber, message,
         Popconfirm, Row, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { EditOutlined, FileTextOutlined, PrinterOutlined, ThunderboltOutlined } from '@ant-design/icons'
import client, { getAccessToken } from '../api/client'
import dayjs from 'dayjs'
import { InvoiceEditModal } from '../components/InvoiceEditModal'
import type { InvoiceItem } from '../components/InvoiceEditModal'
```

- [ ] **Step 2: Remove the local InvoiceItem type and all modal state**

Delete the local `InvoiceItem` interface (lines 11–25 of the original file) — it is now imported from `InvoiceEditModal`.

Delete the local `InvoiceSvcRow`, `EditableSvcLine`, `Employee`, `CommissionPreviewItem`, `ExistingCommission` interfaces — they are internal to `InvoiceEditModal`.

Delete all modal state declarations and functions from `InvoicesPage`:

```tsx
// DELETE all of these state declarations:
const [editInvoice, setEditInvoice] = useState<InvoiceItem | null>(null)
const [editServiceDate, setEditServiceDate] = useState<Dayjs | null>(null)
const [editLines, setEditLines] = useState<EditableSvcLine[]>([])
const [editSaving, setEditSaving] = useState(false)
const [employees, setEmployees] = useState<Employee[]>([])
const [editSacEmployeeId, setEditSacEmployeeId] = useState<number | null>(null)
const [editCalcAmc, setEditCalcAmc] = useState(false)
const [editCommPreview, setEditCommPreview] = useState<CommissionPreviewItem[]>([])
const [editCommPreviewing, setEditCommPreviewing] = useState(false)
const [editExistingComm, setEditExistingComm] = useState<ExistingCommission[]>([])

// DELETE these functions:
// openEditModal (replace with simple setter — see Step 3)
// calculateCommission
// saveEdit
// lineTotal (const derived from editLines)
```

- [ ] **Step 3: Replace openEditModal and add InvoiceEditModal component**

Add a simple state declaration and simplified `openEditModal`:

```tsx
const [editInvoice, setEditInvoice] = useState<InvoiceItem | null>(null)
```

Replace `openEditModal` with:

```tsx
const openEditModal = (record: InvoiceItem) => setEditInvoice(record)
```

At the bottom of the JSX return, before the closing `</div>`, add:

```tsx
<InvoiceEditModal
  invoice={editInvoice}
  onClose={() => setEditInvoice(null)}
  onSaved={loadInvoices}
/>
```

- [ ] **Step 4: Delete the inline Modal JSX block**

Remove the entire `{/* Complete Invoice Modal */}` block (from `<Modal` to `</Modal>`) from the JSX — it is replaced by `<InvoiceEditModal>` added in Step 3.

- [ ] **Step 5: Verify TypeScript**

```bash
cd C:/dev/HFS-SaaS/frontend
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/InvoicesPage.tsx
git commit -m "refactor: replace inline invoice modal with InvoiceEditModal component"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] DB migration: Task 1
- [x] Routes GET enriched: Task 2
- [x] Routes PUT endpoint: Task 2
- [x] InvoiceListItem CustomerEmployeeId + RouteEmployeeId: Task 3
- [x] SvcLineUpdate ServiceQty + UpdateSvcLinesAsync: Task 4
- [x] Commission preview AmcEmployeeId + Overrides: Task 5
- [x] PreviewCommissionHandler override logic: Task 5
- [x] Routes admin page with technician assignment: Task 6
- [x] InvoiceDrawer read-only: Task 7
- [x] CustomerInvoicesTab onMutated removed: Task 7
- [x] InvoiceEditModal — technician/salesperson defaults: Task 8
- [x] InvoiceEditModal — qty editing with price recalc: Task 8
- [x] InvoiceEditModal — auto-commission on open + on blur: Task 8
- [x] InvoicesPage refactor: Task 9

**Type consistency:**
- `InvoiceItem` exported from `InvoiceEditModal.tsx`, imported in `InvoicesPage.tsx` ✓
- `SvcLineUpdate` tuple in controller matches updated `UpdateSvcLinesAsync` signature ✓
- `PreviewCommissionCommand` new fields match `PreviewCommissionRequest` and handler usage ✓
- `ServicePriceOverride` defined in `CommissionCommands.cs` used in request record ✓
