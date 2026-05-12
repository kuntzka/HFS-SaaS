# Invoice Edit Overhaul Design

## Goal

Consolidate all invoice editing into the Invoices section. The customer invoices tab becomes read-only. The invoice edit modal gains technician and sales person selection with commission auto-calculation, qty editing with price recalculation, and service price overrides flowing through to commission calculation.

## Architecture

A new `InvoiceEditModal` component is extracted from `InvoicesPage.tsx`. All write operations go through it. `InvoiceDrawer` (used in the customer invoices tab) is stripped to a read-only viewer.

Backend changes are additive: the route table gains an `employee_id` FK, the invoice list item gains two default employee fields, the svc-line update accepts qty, and the commission preview accepts an AMC employee override and per-service price overrides.

## Tech Stack

React 18 + TypeScript, Ant Design 5, React Query 5, .NET 8 ASP.NET Core, Dapper, Azure SQL

---

## Database

### Migration: `0009_add_route_employee.sql`

```sql
ALTER TABLE {SCHEMA}.route
    ADD employee_id INT NULL
        REFERENCES {SCHEMA}.employee(employee_id);
```

Nullable — existing routes are unaffected.

---

## Backend Changes

### 1. Routes API — `GET /api/routes`

Current response: `{ routeId, routeCode }`

New response: `{ routeId, routeCode, employeeId?, employeeName? }`

The `ReferenceDataRepository.GetRoutesAsync` query joins `employee` on `route.employee_id`. Both fields are nullable (route may have no technician assigned).

### 2. Invoice List — `GET /api/invoices`

`InvoiceListItem` gains two nullable fields:

```csharp
public record InvoiceListItem(
    // ... existing fields ...
    int? CustomerEmployeeId,
    int? RouteEmployeeId
);
```

The existing query already joins `customer` and `route`. Add:

```sql
c.employee_id   AS CustomerEmployeeId,
r.employee_id   AS RouteEmployeeId
```

No new endpoint needed — the modal receives defaults directly from the row it opens.

### 3. Service Line Update — `PUT /api/invoices/{n}/svc-lines`

`SvcLineUpdate` gains `ServiceQty`:

```csharp
public record SvcLineUpdate(int Id, int ServiceQty, decimal ServicePrice, decimal Tax);
```

`InvoiceRepository.UpdateSvcLinesAsync` updates `service_qty` alongside price and tax. `RecalcInvoiceTotalsAsync` is unchanged (already recalculates from `invoice_svc` totals).

### 4. Commission Preview — `POST /api/commissions/preview`

Two additions to `PreviewCommissionRequest` and `PreviewCommissionCommand`:

```csharp
public record PreviewCommissionRequest(
    int InvoiceNumber,
    DateOnly ServiceDate,
    int? SacEmployeeId,
    bool CalculateAmc,
    int? AmcEmployeeId,                          // NEW: override customer's employee for AMC
    IReadOnlyList<ServicePriceOverride>? Overrides  // NEW: unsaved price/qty edits
);

public record ServicePriceOverride(int CustomerSvcId, decimal ServicePrice);
```

**`AmcEmployeeId` behavior in `PreviewCommissionHandler`:** when `AmcEmployeeId` is provided, every AMC commission row uses this employee id instead of `svc.EmployeeId`. When null, existing per-service behavior is unchanged.

**`Overrides` behavior:** before running the SAC/AMC rule cascade, the handler applies price overrides:

```csharp
var effectivePrice = overrideMap.TryGetValue(svc.CustomerSvcId, out var ov)
    ? ov.ServicePrice
    : svc.ServicePrice;
```

This ensures that qty-driven price changes in the modal (not yet saved to DB) correctly flow through to commission amounts calculated via `price * percent` rules.

**Rule cascade is unchanged** — the existing three-tier SAC logic (item rule → calc rule → week rule) and four-level AMC fallback remain exactly as implemented. Week rule and item rule edge cases are not modified in this change.

---

## Frontend Changes

### 1. New: `frontend/src/components/InvoiceEditModal.tsx`

Extracted from the inline modal in `InvoicesPage.tsx`. Props:

```typescript
interface Props {
  invoice: InvoiceItem | null   // null = closed
  onClose: () => void
  onSaved: () => void
}
```

**Width:** 900px, `destroyOnClose`.

**Layout (top to bottom):**

**Row 1 — Header controls:**
- Service Date (`DatePicker`, defaults to today on open if no existing date)
- Technician (`Select`, defaults to `invoice.routeEmployeeId`, active employees only)
- Sales Person (`Select`, defaults to `invoice.customerEmployeeId`, active employees only)
- Include AMC (`Checkbox`, defaults checked)

**Row 2 — Service lines table:**

Columns: Description · Qty (editable `InputNumber`, min 1) · Price (editable `InputNumber`, precision 2) · Tax (editable `InputNumber`, precision 2) · Line Total (computed, read-only) · Delete action

**Qty `onBlur` behavior:** `newPrice = round((currentPrice / currentQty) * newQty, 2)`. Price field updates in local state. Commission auto-recalculate fires after.

**Row 3 — Add line / Save lines controls** (existing behavior, unchanged)

**Row 4 — Commission section:**

Header "Commission" + "Recalculate" button.

Commission preview table: Employee · Type · Service · Amount (editable `InputNumber`, precision 2) · Flags (1st commission badge).

**Auto-calculate triggers:**
- On modal open: immediately fires commission preview with defaults
- `onBlur` on: Service Date, Technician, Sales Person, Include AMC toggle, any line Qty/Price/Tax

Every auto-recalculate call passes the current in-memory line prices as `overrides` so unsaved edits are reflected in commission amounts.

If existing saved commissions are present and no recalc has run yet, they display immediately (current info-banner behavior is replaced by live auto-calc on open).

**Save behavior (`onOk`):** sequential calls:
1. `PUT /invoices/{n}/service-date` (sets date, marks complete if date is set)
2. `PUT /invoices/{n}/svc-lines` (with qty)
3. `POST /commissions/save` (if commission preview has rows)

Calls `onSaved()` then `onClose()` on success.

### 2. Modified: `frontend/src/pages/InvoicesPage.tsx`

Remove the inline `<Modal>` block and all associated state (`editInvoice`, `editServiceDate`, `editLines`, `editSaving`, `editSacEmployeeId`, `editCalcAmc`, `editCommPreview`, `editCommPreviewing`, `editExistingComm`, `employees`). Replace with:

```tsx
<InvoiceEditModal
  invoice={editInvoice}
  onClose={() => setEditInvoice(null)}
  onSaved={loadInvoices}
/>
```

`openEditModal` simplifies to just `setEditInvoice(record)` — no more Promise.all on open (modal loads its own data internally).

### 3. Modified: `frontend/src/components/InvoiceDrawer.tsx`

Stripped to read-only. Removed:
- All editing state (`editedLines`, `savingLines`, `adding`, `newLine`, `savingNew`, `deletingId`)
- `handleSaveLines`, `handleSaveNew`, `handleDelete`, `handleServiceDateChange`, `handleMarkComplete`
- `onMutated` prop
- "Add Line" button, "Save Lines" button, "Mark Complete" Popconfirm
- `InputNumber` in service line columns — replaced with plain text display
- `DatePicker` for service date — replaced with formatted text

Kept:
- Drawer open/close, `destroyOnClose`
- `useEffect` to load service lines on open
- Service lines display table
- "View PDF" button
- Invoice header (number, status tag, dates, total)

### 4. Modified: Routes admin page (wherever routes are edited)

Add an employee `Select` (active employees, nullable, `allowClear`) to the route create/edit form. This allows the technician default to be set per route.

---

## Data Flow: Commission Auto-Calculation

```
Modal opens
  → set defaults (today's date, routeEmployeeId, customerEmployeeId, AMC=true)
  → POST /commissions/preview { invoiceNumber, serviceDate=today, sacEmployeeId=routeEmpId,
                                calculateAmc=true, amcEmployeeId=customerEmpId, overrides=[] }
  → display preview rows

User edits Qty on line A (onBlur)
  → recalc local price: newPrice = round((oldPrice / oldQty) * newQty, 2)
  → POST /commissions/preview { ..., overrides: [{ customerSvcId: A.customerSvcId, servicePrice: newPrice }] }
  → update commission preview

User changes Technician (onBlur / onChange)
  → POST /commissions/preview { ..., sacEmployeeId: newTechId, overrides: currentPrices }
  → update commission preview
```

---

## What Is Not Changing

- Commission rule cascade logic (item rule → calc rule → week rule for SAC; 4-level AMC fallback)
- Invoice generation, printing, batch PDF
- `CustomerInvoicesTab` table and date-range filter
- All other invoice API endpoints
