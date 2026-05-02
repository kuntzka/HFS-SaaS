# Customer Invoice History — Design Spec

**Date:** 2026-05-02
**Status:** Approved
**Scope:** `CustomerInvoicesTab` + `InvoiceDrawer` components + `GET /api/customers/{id}/invoices` endpoint

---

## Context

The Customer Detail page has an Invoices tab that currently shows a placeholder. This spec replaces it with a live invoice history table for the selected customer, with a drawer for viewing details and taking actions on individual invoices.

This is **Spec 3 of 3** in a sequence:
1. Employee Management — completed
2. Route Management — deferred
3. **Customer Invoice History (this spec)**

---

## Goals

- Show all invoices for a customer from the start of the current year, defaulting to the last 90 days.
- Indicate completion status clearly in the list.
- Allow users to mark invoices complete, update the service date, edit service line items, and view the invoice PDF — all from within the drawer without leaving the customer record.

---

## Out of Scope

- Creating or generating new invoices from this tab (invoices are generated via the main Invoices page).
- Voiding or deleting invoices.
- Displaying commission data per invoice.

---

## Backend

### New DTO

```csharp
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
```

### New `InvoiceRepository` Method

```csharp
GetByCustomerAsync(int customerId, DateOnly from, DateOnly to)
→ IEnumerable<CustomerInvoiceSummary>
```

SQL filters `invoice` by `customer_id = @customerId` and `invoice_date BETWEEN @from AND @to`, ordered by `invoice_date DESC`. Selects the columns in `CustomerInvoiceSummary` directly (no joins required).

### New Endpoint on `CustomersController`

```
GET /api/customers/{id}/invoices?from=YYYY-MM-DD&to=YYYY-MM-DD
```

| Condition | Response |
|---|---|
| `from` or `to` missing | `400 Bad Request` |
| Valid request | `200 OK` with `CustomerInvoiceSummary[]` |

Both `from` and `to` are required query parameters. The frontend always sends them.

### Existing Endpoints Reused (no changes)

| Endpoint | Used for |
|---|---|
| `PUT /api/invoices/{n}/complete` | Mark invoice complete |
| `PUT /api/invoices/{n}/service-date` | Update service date |
| `GET /api/invoices/{n}/detail` | Load service lines into drawer |
| `PUT /api/invoices/{n}/svc-lines` | Save edited service lines |
| `GET /api/reports/invoice/{n}/pdf` | Open PDF in new tab |

---

## Frontend

### File Structure

| File | Change |
|---|---|
| `frontend/src/components/CustomerInvoicesTab.tsx` | **Create** — tab content with date filter and summary table |
| `frontend/src/components/InvoiceDrawer.tsx` | **Create** — detail drawer with all actions |
| `frontend/src/pages/CustomerDetailPage.tsx` | **Modify** — import and use `CustomerInvoicesTab` in the Invoices tab slot |

### `CustomerInvoicesTab`

**Props:** `{ customerId: number }`

**Date filter:**
- Ant Design `RangePicker` placed above the table
- Default range: `(today − 90 days)` → `today`
- `disabledDate`: prevents selecting dates before January 1 of the current year
- On range change: updates local state (`from`, `to`), React Query refetches automatically

**React Query:**
```typescript
useQuery({
  queryKey: ['customer-invoices', customerId, from, to],
  queryFn: () => client.get(`/customers/${customerId}/invoices`, { params: { from, to } }).then(r => r.data),
})
```

**Table columns:**

| Column | Notes |
|---|---|
| Invoice # | Numeric, sortable |
| Invoice Date | Formatted date |
| Service Date | Formatted date, `—` if null |
| Qty | `serviceQty` |
| Total | `(servicePrice + tax).toFixed(2)` with `$` prefix |
| Status | Green `<Tag>` "Complete" or grey `<Tag>` "Pending" |

Clicking any row calls `setSelectedInvoice(record)` to open the drawer.

### `InvoiceDrawer`

**Props:** `{ customerId: number; invoice: CustomerInvoiceSummary | null; onClose: () => void; onMutated: () => void }`

`onMutated` is called after any successful write action — the parent tab calls `queryClient.invalidateQueries({ queryKey: ['customer-invoices', customerId, ...] })` in response.

**Ant Design `Drawer`**, width 600px, `destroyOnClose`.

**Sections:**

**1. Header** — Invoice number as title + status tag (`Complete` / `Pending`).

**2. Details** — `Descriptions` block (bordered, size small):
- Invoice Date
- Service Date — rendered as an inline `DatePicker` (clearable); fires `PUT /api/invoices/{n}/service-date` when the user selects a date and the picker closes (not on keystroke). Calls `onMutated` on success. Disabled when invoice is complete.
- Total — `$servicePrice + tax`
- Qty

**3. Actions row:**
- **Mark Complete** — `Button` with `Popconfirm` ("Mark this invoice as complete? This cannot be undone."). Calls `PUT /api/invoices/{n}/complete`. Hidden once `isComplete = true`.
- **View PDF** — `Button` that opens `GET /api/reports/invoice/{n}/pdf` in a new browser tab (`window.open`). Always visible.

**4. Service Lines** — Table loaded from `GET /api/invoices/{n}/detail` when the drawer opens.

Columns: Description, Price, Qty, Tax, Comments.

- When `isComplete = false`: rows are editable inline (same pattern as `ServiceInventoryTable`). A **Save Lines** button below the table submits the full updated array to `PUT /api/invoices/{n}/svc-lines` and calls `onMutated`.
- When `isComplete = true`: table is read-only, Save Lines button hidden.

**Error handling:** API errors in the drawer surface as `message.error(...)` toasts. The service date update is the only auto-save; all other writes are explicit button actions.

---

## Invariants

- `from` and `to` are always sent to the API — no open-ended queries.
- Completed invoices are read-only in the drawer (service lines, service date).
- Mark Complete is irreversible in the UI (no undo endpoint exists).
- `onMutated` always triggers a re-fetch of the summary list so the status tag stays in sync.
