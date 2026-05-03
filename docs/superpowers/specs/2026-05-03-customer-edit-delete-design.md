# Customer Edit & Delete — Design Spec

**Date:** 2026-05-03
**Status:** Approved
**Scope:** `CustomerFormModal` component + `DELETE /api/customers/{id}` endpoint + updates to `CustomersPage` and `CustomerDetailPage`

---

## Context

The customer list page has a broken "New Customer" button (navigates to `/customers/new` which resolves to `CustomerDetailPage` with `id=NaN`). The Info tab on the detail page is read-only. No UI exists for editing customer records or deactivating them.

This spec adds edit and deactivate actions in both locations, and fixes the create flow as a byproduct.

---

## Goals

- Allow users to create, edit, and deactivate customers without leaving the current page.
- Surface edit and deactivate actions on both the customer list and the customer detail page.
- Reuse a single form component for create and edit.

---

## Out of Scope

- Hard-deleting customers (referential integrity with invoices/services).
- Re-activating a deactivated customer from this UI (can be done by editing the customer and toggling the Active checkbox).
- Bulk deactivation.

---

## Backend

### New `CustomerRepository` Method

```csharp
DeactivateAsync(int customerId) → Task<bool>
```

Runs:
```sql
UPDATE {schema}.customer SET is_active = 0 WHERE customer_id = @customerId
```

Returns `true` if a row was updated, `false` if the customer was not found.

### New Endpoint on `CustomersController`

```
DELETE /api/customers/{id}
```

| Condition | Response |
|---|---|
| Customer not found | `404 Not Found` |
| Success | `204 No Content` |

### Existing Endpoints Reused (no changes)

| Endpoint | Used for |
|---|---|
| `POST /api/customers` | Create new customer |
| `PUT /api/customers/{id}` | Update existing customer |
| `GET /api/customers/{id}` | Pre-fill edit form |

---

## Frontend

### File Structure

| File | Change |
|---|---|
| `frontend/src/components/CustomerFormModal.tsx` | **Create** — modal for create and edit |
| `frontend/src/pages/CustomersPage.tsx` | **Modify** — fix New Customer, add Edit/Deactivate row actions |
| `frontend/src/pages/CustomerDetailPage.tsx` | **Modify** — add Edit/Deactivate buttons to page header |

### `CustomerFormModal`

**Props:** `{ open: boolean; customerId?: number; onClose: () => void; onSaved: () => void }`

**Mode detection:** `customerId` present → edit mode; absent → create mode.

**Data loading (edit mode):**
- On open, fetches `GET /api/customers/{customerId}` to pre-fill the form.
- Reference data (routes, employees, pay types, offset codes) loaded lazily on first open — same `Promise.all` pattern used in the Services modal.

**Form fields** (matching `UpsertCustomerRequest`):

| Row | Fields |
|---|---|
| 1 | Company Name (required), Phone |
| 2 | Address 1, Address 2, City, State, Zip |
| 3 | Billing Address 1, Billing Address 2, Billing City, Billing State, Billing Zip |
| 4 | Route, Employee, Pay Type, Offset Code, AR Offset, Distance |
| 5 | Customer Type (number), Call First (checkbox), Consolidated Billing (checkbox), Test Account (checkbox), Active (checkbox) |

**Submit:**
- Edit mode: `PUT /api/customers/{customerId}` with form values.
- Create mode: `POST /api/customers` with form values.
- On success: calls `onSaved()`, closes modal, shows `message.success`.
- On error: shows `message.error`, modal stays open.

**`onSaved` responsibility (caller):** Invalidate `['customers']` query (and `['customer', customerId]` when editing).

### `CustomersPage` changes

- **"New Customer" button:** Remove `navigate('/customers/new')`. Open `CustomerFormModal` with no `customerId`. `onSaved` invalidates `['customers']`.
- **New actions column** (rightmost, width 90): `EditOutlined` icon button opens `CustomerFormModal` with the row's `customerId`; `StopOutlined` icon button with `Popconfirm` title "Deactivate this customer?" calls `DELETE /api/customers/{id}`, on success invalidates `['customers']` and shows `message.success('Customer deactivated')`.

### `CustomerDetailPage` changes

- **Edit button** added to the page header (right of the Back button): opens `CustomerFormModal` with `customerId`. `onSaved` invalidates `['customer', customerId]` and `['customers']`.
- **Deactivate button** added to the page header: `Popconfirm` title "Deactivate this customer? They will no longer appear in the active customers list." On confirm: calls `DELETE /api/customers/{id}`, on success navigates to `/customers`.

---

## Invariants

- Deactivation is soft — `is_active = 0` only. The record and all associated data remain intact.
- Re-activation is possible by opening the edit modal and checking the Active checkbox.
- The modal's reference data (routes, employees, etc.) is loaded once per session and reused on subsequent opens.
- Both create and edit use the same `UpsertCustomerRequest` shape — no separate request types.
