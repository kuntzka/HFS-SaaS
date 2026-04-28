# Customer Service Inventory — Inline Expandable Design

**Date:** 2026-04-27  
**Status:** Approved  
**Scope:** `CustomerDetailPage` — Services tab and Inventory tab

---

## Problem

The customer detail page currently shows Services and Inventory as separate tabs. There is no way to see which inventory items are assigned to a specific service without navigating between tabs. The Edit Service modal shows a read-only inventory list at the bottom, but it is buried inside a modal and not editable there.

---

## Goal

Provide a compact, inline way to view and manage the inventory assigned to each service, without leaving the Services tab and without opening modals.

---

## Page Structure Changes

### Services Tab
- The services table gains **expandable rows** via Ant Design's `Table` `expandable` prop.
- Clicking the expand chevron on a service row reveals an inline `ServiceInventoryTable` sub-component beneath that row.
- Inventory loads lazily on first expand; subsequent expand/collapse cycles use the cached result.
- The read-only inventory section at the bottom of the Edit Service modal is removed — the expandable row replaces it.

### Inventory Tab
- **Removed** from the customer detail page entirely.
- Per-customer inventory allocation is now visible in the expandable service rows.
- The global `/inventory` page continues to handle warehouse-level stock management (SKU master, qty on hand, below-minimum alerts).

### Remaining Tabs
Info, Invoices, and Commission tabs are unchanged.

---

## ServiceInventoryTable Component

A dedicated component owned entirely by the expanded row. `ServicesTab` passes it props; it manages all its own state and API calls.

**Props:**
```ts
interface ServiceInventoryTableProps {
  customerId: number
  customerSvcId: number
  skus: SkuOption[]   // { sku, description } — loaded once by ServicesTab, shared
}
```

**Local state:**
| State | Type | Purpose |
|---|---|---|
| `items` | `SvcInventoryItem[]` | Local copy of assigned inventory rows |
| `editingId` | `number \| null` | Row currently in edit mode |
| `editValues` | `Partial<SvcInventoryItem>` | In-progress field values for editing row |
| `adding` | `boolean` | Whether a blank new row is appended at the bottom |
| `newValues` | partial fields | Field values for the new row being added |
| `saving` | `boolean` | API call in flight for save |
| `deleting` | `number \| null` | ID of row with delete in flight |

---

## Sub-table Columns

| Column | Display | Edit control |
|---|---|---|
| SKU | Text | Not editable after creation |
| Qty | Number | `InputNumber` min=1 |
| Group | Number, `—` when -32768 | `InputNumber`, blank = -32768 sentinel |
| Comments | Text, `—` when null | `Input` |
| Actions | Edit / Delete | Save / Cancel |

---

## Interaction Flows

### Viewing
1. User expands a service row.
2. Sub-table appears with a loading spinner.
3. `GET /api/customers/{id}/services/{svcId}/inventory` resolves → rows render.
4. Subsequent expand/collapse uses cached `items` — no re-fetch.

### Adding an inventory item
1. User clicks **Add Item** below the sub-table rows.
2. A blank editable row appends at the bottom.
3. SKU: searchable `Select` filtered to exclude SKUs already assigned to this service.
4. Qty, Group (optional), Comments (optional) are editable inline.
5. **Save** → `POST /api/customers/{id}/services/{svcId}/inventory` → row becomes read-only.
6. **Cancel** → blank row is removed, no API call.

### Editing an existing row
1. User clicks **Edit** on a row.
2. Qty, Group, and Comments cells become inputs. SKU is read-only (changing SKU = delete + add).
3. If another row is already being edited, it is auto-cancelled first.
4. **Save** → `PUT /api/customers/{id}/services/{svcId}/inventory/{invId}` → row returns to read-only.
5. **Cancel** → row reverts to original values, no API call.

### Deleting a row
1. User clicks **Delete** → Popconfirm "Remove this item?".
2. Confirm → `DELETE /api/customers/{id}/services/{svcId}/inventory/{invId}` → row removed from local state.

---

## SKU Dropdown

- Populated from `inventory_master` via `GET /api/inventory`.
- Loaded once by `ServicesTab` on the first expand of any service row; stored in component state and passed as `skus` prop to all `ServiceInventoryTable` instances.
- Dropdown option label: `"{sku} — {description}"`, searchable by both.
- Available options are filtered to exclude SKUs already present in the current service's `items` list (prevents duplicate assignments).

---

## Backend Changes

### New API Endpoints (`CustomersController`)

```
POST   /api/customers/{id}/services/{svcId}/inventory
PUT    /api/customers/{id}/services/{svcId}/inventory/{invId}
DELETE /api/customers/{id}/services/{svcId}/inventory/{invId}
```

**POST body:**
```json
{ "sku": "string", "quantity": 1, "groupNumber": -32768, "itemNumber": 0, "comments": null }
```

**PUT body** (SKU excluded — not editable after creation):
```json
{ "quantity": 1, "groupNumber": -32768, "itemNumber": 0, "comments": null }
```

`InventoryRepository` gets three new methods:
- `AddToServiceAsync(int customerSvcId, string sku, int quantity, short groupNumber, int itemNumber, string? comments) → int` (returns new id)
- `UpdateServiceItemAsync(int id, int quantity, short groupNumber, int itemNumber, string? comments) → bool`
- `DeleteServiceItemAsync(int id) → bool`

The existing `GetBySvcIdAsync` covers the read side. No schema migrations needed.

---

## What Is Not In Scope

- Inventory master management (add/edit/delete SKUs, adjust stock levels) — this belongs on the global `/inventory` page, not the customer detail page.
- Bulk inventory operations across multiple services at once.
- Reordering inventory items within a service.
