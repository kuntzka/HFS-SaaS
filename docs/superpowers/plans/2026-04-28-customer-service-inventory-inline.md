# Customer Service Inventory — Inline Expandable Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the read-only inventory section in the Edit Service modal with inline expandable rows on the Services table, allowing full add/edit/delete of service inventory assignments without modals.

**Architecture:** A new `ServiceInventoryTable` component owns all inventory sub-table state and API calls; `ServicesTab` wires it into the Ant Design `Table` `expandable` prop and passes a shared `skus` list loaded lazily on first expand. Three new `CustomersController` endpoints mirror the existing service sub-resource pattern; three new `InventoryRepository` methods handle the SQL.

**Tech Stack:** React 18 + TypeScript, Ant Design 5, Axios, .NET 8 ASP.NET Core, Dapper, SQL Server

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/HFS.Infrastructure/Data/InventoryRepository.cs` | Add `AddToServiceAsync`, `UpdateServiceItemAsync`, `DeleteServiceItemAsync` |
| Modify | `src/HFS.Api/Controllers/CustomersController.cs` | Add POST/PUT/DELETE service inventory endpoints + request records |
| Create | `frontend/src/components/ServiceInventoryTable.tsx` | Inline editable inventory sub-table component |
| Modify | `frontend/src/pages/CustomerDetailPage.tsx` | Add expandable rows, remove inventory tab, remove modal inventory section |

---

## Task 1: Add CRUD methods to InventoryRepository

**Files:**
- Modify: `src/HFS.Infrastructure/Data/InventoryRepository.cs`

- [ ] **Step 1: Add the three new methods**

Open `src/HFS.Infrastructure/Data/InventoryRepository.cs`. Insert the following three methods directly before the existing `GetBelowMinimumCountAsync` method:

```csharp
public async Task<int> AddToServiceAsync(
    int customerSvcId, string sku, int quantity,
    short groupNumber, int itemNumber, string? comments)
{
    using var conn = db.CreateConnection();
    return await conn.QuerySingleAsync<int>(db.Sql("""
        INSERT INTO {schema}.customer_service_inventory
            (customer_svc_id, sku, quantity, group_number, item_number, comments)
        OUTPUT INSERTED.id
        VALUES
            (@customerSvcId, @sku, @quantity, @groupNumber, @itemNumber, @comments)
        """), new { customerSvcId, sku, quantity, groupNumber, itemNumber, comments });
}

public async Task<bool> UpdateServiceItemAsync(
    int id, int quantity, short groupNumber, int itemNumber, string? comments)
{
    using var conn = db.CreateConnection();
    var rows = await conn.ExecuteAsync(db.Sql("""
        UPDATE {schema}.customer_service_inventory
        SET quantity     = @quantity,
            group_number = @groupNumber,
            item_number  = @itemNumber,
            comments     = @comments
        WHERE id = @id
        """), new { id, quantity, groupNumber, itemNumber, comments });
    return rows > 0;
}

public async Task<bool> DeleteServiceItemAsync(int id)
{
    using var conn = db.CreateConnection();
    var rows = await conn.ExecuteAsync(
        db.Sql("DELETE FROM {schema}.customer_service_inventory WHERE id = @id"),
        new { id });
    return rows > 0;
}
```

- [ ] **Step 2: Build to verify**

```bash
dotnet build src/HFS.Infrastructure/HFS.Infrastructure.csproj
```

Expected: `Build succeeded. 0 Error(s)`

---

## Task 2: Add service inventory endpoints to CustomersController

**Files:**
- Modify: `src/HFS.Api/Controllers/CustomersController.cs`

- [ ] **Step 1: Inject InventoryRepository and add endpoints**

The controller's primary constructor already has `InventoryRepository inventoryRepo` injected (added in a prior session for the GET endpoint). Locate the existing `GetServiceInventory` endpoint:

```csharp
[HttpGet("{id:int}/services/{svcId:int}/inventory")]
public async Task<IActionResult> GetServiceInventory(int id, int svcId) =>
    Ok(await inventoryRepo.GetBySvcIdAsync(svcId));
```

Add the following three endpoints immediately after it, before the closing `}` of the class:

```csharp
[HttpPost("{id:int}/services/{svcId:int}/inventory")]
public async Task<IActionResult> AddServiceInventory(
    int id, int svcId, [FromBody] AddServiceInventoryRequest req)
{
    var newId = await inventoryRepo.AddToServiceAsync(
        svcId, req.Sku, req.Quantity, req.GroupNumber, req.ItemNumber, req.Comments);
    return Created(
        $"/api/customers/{id}/services/{svcId}/inventory/{newId}",
        new { id = newId });
}

[HttpPut("{id:int}/services/{svcId:int}/inventory/{invId:int}")]
public async Task<IActionResult> UpdateServiceInventory(
    int id, int svcId, int invId, [FromBody] UpdateServiceInventoryRequest req)
{
    var ok = await inventoryRepo.UpdateServiceItemAsync(
        invId, req.Quantity, req.GroupNumber, req.ItemNumber, req.Comments);
    return ok ? NoContent() : NotFound();
}

[HttpDelete("{id:int}/services/{svcId:int}/inventory/{invId:int}")]
public async Task<IActionResult> DeleteServiceInventory(int id, int svcId, int invId)
{
    var ok = await inventoryRepo.DeleteServiceItemAsync(invId);
    return ok ? NoContent() : NotFound();
}
```

- [ ] **Step 2: Add the two request records**

Locate the end of `CustomersController.cs` (after `UpsertCustomerServiceRequest`). Add:

```csharp
public record AddServiceInventoryRequest(
    string Sku,
    int Quantity,
    short GroupNumber,
    int ItemNumber,
    string? Comments);

public record UpdateServiceInventoryRequest(
    int Quantity,
    short GroupNumber,
    int ItemNumber,
    string? Comments);
```

- [ ] **Step 3: Build to verify**

```bash
dotnet build src/HFS.Api/HFS.Api.csproj
```

Expected: `Build succeeded. 0 Error(s)`

- [ ] **Step 4: Commit**

```bash
cd C:/dev/HFS-SaaS
git add src/HFS.Infrastructure/Data/InventoryRepository.cs
git add src/HFS.Api/Controllers/CustomersController.cs
git commit -m "feat: add service inventory CRUD endpoints and repository methods"
```

---

## Task 3: Create ServiceInventoryTable component

**Files:**
- Create: `frontend/src/components/ServiceInventoryTable.tsx`

- [ ] **Step 1: Create the file with the complete component**

Create `frontend/src/components/ServiceInventoryTable.tsx` with the following content:

```tsx
import { useState, useEffect } from 'react'
import { Table, Select, InputNumber, Input, Button, Space, Popconfirm, message } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import client from '../api/client'

export interface SkuOption {
  sku: string
  description: string
}

interface SvcInventoryItem {
  id: number
  sku: string
  description: string
  quantity: number
  groupNumber: number
  itemNumber: number
  comments: string | null
}

interface EditValues {
  quantity: number
  groupNumber: number | null
  itemNumber: number
  comments: string
}

interface NewValues {
  sku: string
  quantity: number
  groupNumber: number | null
  itemNumber: number
  comments: string
}

interface Props {
  customerId: number
  customerSvcId: number
  skus: SkuOption[]
}

type DisplayRow = SvcInventoryItem | { id: 0 }

const SENTINEL = -32768
const NEW_ID = 0 as const

export function ServiceInventoryTable({ customerId, customerSvcId, skus }: Props) {
  const [items, setItems] = useState<SvcInventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValues, setEditValues] = useState<EditValues>({
    quantity: 1, groupNumber: null, itemNumber: 0, comments: '',
  })
  const [adding, setAdding] = useState(false)
  const [newValues, setNewValues] = useState<NewValues>({
    sku: '', quantity: 1, groupNumber: null, itemNumber: 0, comments: '',
  })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)

  useEffect(() => {
    client.get(`/customers/${customerId}/services/${customerSvcId}/inventory`)
      .then(r => setItems(r.data))
      .catch(() => message.error('Failed to load inventory'))
      .finally(() => setLoading(false))
  }, [customerId, customerSvcId])

  function startEdit(item: SvcInventoryItem) {
    setAdding(false)
    setEditingId(item.id)
    setEditValues({
      quantity: item.quantity,
      groupNumber: item.groupNumber === SENTINEL ? null : item.groupNumber,
      itemNumber: item.itemNumber,
      comments: item.comments ?? '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function saveEdit(id: number) {
    setSaving(true)
    try {
      await client.put(
        `/customers/${customerId}/services/${customerSvcId}/inventory/${id}`,
        {
          quantity:    editValues.quantity,
          groupNumber: editValues.groupNumber ?? SENTINEL,
          itemNumber:  editValues.itemNumber,
          comments:    editValues.comments || null,
        }
      )
      setItems(prev => prev.map(item =>
        item.id === id
          ? {
              ...item,
              quantity:    editValues.quantity,
              groupNumber: editValues.groupNumber ?? SENTINEL,
              itemNumber:  editValues.itemNumber,
              comments:    editValues.comments || null,
            }
          : item
      ))
      setEditingId(null)
    } catch {
      message.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function startAdd() {
    setEditingId(null)
    setAdding(true)
    setNewValues({ sku: '', quantity: 1, groupNumber: null, itemNumber: 0, comments: '' })
  }

  function cancelAdd() {
    setAdding(false)
  }

  async function saveAdd() {
    if (!newValues.sku) return
    setSaving(true)
    try {
      const res = await client.post(
        `/customers/${customerId}/services/${customerSvcId}/inventory`,
        {
          sku:         newValues.sku,
          quantity:    newValues.quantity,
          groupNumber: newValues.groupNumber ?? SENTINEL,
          itemNumber:  newValues.itemNumber,
          comments:    newValues.comments || null,
        }
      )
      const skuMeta = skus.find(s => s.sku === newValues.sku)
      setItems(prev => [
        ...prev,
        {
          id:          res.data.id,
          sku:         newValues.sku,
          description: skuMeta?.description ?? '',
          quantity:    newValues.quantity,
          groupNumber: newValues.groupNumber ?? SENTINEL,
          itemNumber:  newValues.itemNumber,
          comments:    newValues.comments || null,
        },
      ])
      setAdding(false)
    } catch {
      message.error('Failed to add item')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    setDeleting(id)
    try {
      await client.delete(
        `/customers/${customerId}/services/${customerSvcId}/inventory/${id}`
      )
      setItems(prev => prev.filter(item => item.id !== id))
    } catch {
      message.error('Failed to delete item')
    } finally {
      setDeleting(null)
    }
  }

  const assignedSkus = new Set(items.map(i => i.sku))
  const availableSkus = skus.filter(s => !assignedSkus.has(s.sku))

  const displayData: DisplayRow[] = [
    ...items,
    ...(adding ? [{ id: NEW_ID }] : []),
  ]

  const columns = [
    {
      title: 'SKU',
      key: 'sku',
      width: 150,
      render: (_: unknown, record: DisplayRow) => {
        if (record.id === NEW_ID) {
          return (
            <Select
              showSearch
              size="small"
              placeholder="Select SKU"
              style={{ width: '100%', minWidth: 130 }}
              value={newValues.sku || undefined}
              onChange={(v: string) => setNewValues(prev => ({ ...prev, sku: v }))}
              optionFilterProp="label"
              options={availableSkus.map(s => ({
                value: s.sku,
                label: `${s.sku} — ${s.description}`,
              }))}
            />
          )
        }
        return (record as SvcInventoryItem).sku
      },
    },
    {
      title: 'Qty',
      key: 'quantity',
      width: 75,
      render: (_: unknown, record: DisplayRow) => {
        if (record.id === NEW_ID) {
          return (
            <InputNumber
              size="small"
              min={1}
              value={newValues.quantity}
              onChange={v => setNewValues(prev => ({ ...prev, quantity: v ?? 1 }))}
              style={{ width: '100%' }}
            />
          )
        }
        const item = record as SvcInventoryItem
        if (editingId === item.id) {
          return (
            <InputNumber
              size="small"
              min={1}
              value={editValues.quantity}
              onChange={v => setEditValues(prev => ({ ...prev, quantity: v ?? 1 }))}
              style={{ width: '100%' }}
            />
          )
        }
        return item.quantity
      },
    },
    {
      title: 'Group',
      key: 'groupNumber',
      width: 85,
      render: (_: unknown, record: DisplayRow) => {
        if (record.id === NEW_ID) {
          return (
            <InputNumber
              size="small"
              value={newValues.groupNumber ?? undefined}
              onChange={v => setNewValues(prev => ({ ...prev, groupNumber: v ?? null }))}
              placeholder="none"
              style={{ width: '100%' }}
            />
          )
        }
        const item = record as SvcInventoryItem
        if (editingId === item.id) {
          return (
            <InputNumber
              size="small"
              value={editValues.groupNumber ?? undefined}
              onChange={v => setEditValues(prev => ({ ...prev, groupNumber: v ?? null }))}
              placeholder="none"
              style={{ width: '100%' }}
            />
          )
        }
        return item.groupNumber === SENTINEL ? '—' : item.groupNumber
      },
    },
    {
      title: 'Comments',
      key: 'comments',
      render: (_: unknown, record: DisplayRow) => {
        if (record.id === NEW_ID) {
          return (
            <Input
              size="small"
              value={newValues.comments}
              onChange={e => setNewValues(prev => ({ ...prev, comments: e.target.value }))}
            />
          )
        }
        const item = record as SvcInventoryItem
        if (editingId === item.id) {
          return (
            <Input
              size="small"
              value={editValues.comments}
              onChange={e => setEditValues(prev => ({ ...prev, comments: e.target.value }))}
            />
          )
        }
        return item.comments ?? '—'
      },
    },
    {
      title: '',
      key: 'actions',
      width: 120,
      render: (_: unknown, record: DisplayRow) => {
        if (record.id === NEW_ID) {
          return (
            <Space size={4}>
              <Button
                size="small"
                type="primary"
                onClick={saveAdd}
                loading={saving}
                disabled={!newValues.sku}
              >
                Save
              </Button>
              <Button size="small" onClick={cancelAdd}>Cancel</Button>
            </Space>
          )
        }
        const item = record as SvcInventoryItem
        if (editingId === item.id) {
          return (
            <Space size={4}>
              <Button
                size="small"
                type="primary"
                onClick={() => saveEdit(item.id)}
                loading={saving}
              >
                Save
              </Button>
              <Button size="small" onClick={cancelEdit}>Cancel</Button>
            </Space>
          )
        }
        return (
          <Space size={4}>
            <Button size="small" icon={<EditOutlined />} onClick={() => startEdit(item)} />
            <Popconfirm
              title="Remove this item?"
              okText="Remove"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(item.id)}
            >
              <Button
                size="small"
                icon={<DeleteOutlined />}
                danger
                loading={deleting === item.id}
              />
            </Popconfirm>
          </Space>
        )
      },
    },
  ]

  return (
    <div style={{ padding: '4px 16px 8px 48px' }}>
      <Table<DisplayRow>
        dataSource={displayData}
        columns={columns}
        rowKey="id"
        size="small"
        pagination={false}
        loading={loading}
        locale={{ emptyText: 'No inventory assigned' }}
      />
      {!adding && (
        <Button
          type="dashed"
          icon={<PlusOutlined />}
          size="small"
          style={{ marginTop: 6 }}
          onClick={startAdd}
        >
          Add Item
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:/dev/HFS-SaaS/frontend
npm run build 2>&1 | head -30
```

Expected: no TypeScript errors relating to `ServiceInventoryTable.tsx`. Build warnings about other files are acceptable; errors are not.

---

## Task 4: Update CustomerDetailPage

**Files:**
- Modify: `frontend/src/pages/CustomerDetailPage.tsx`

- [ ] **Step 1: Update imports**

Replace the existing import block at the top of the file:

```tsx
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Tabs, Button, Typography, Skeleton, Descriptions, Table, Tag,
  Modal, Form, Select, InputNumber, DatePicker, Checkbox, Input,
  Space, Popconfirm, message, Divider,
} from 'antd'
import { ArrowLeftOutlined, PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import { useCustomer, useCustomerServices, CustomerServiceDetail } from '../hooks/useCustomers'
import { useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
```

With:

```tsx
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Tabs, Button, Typography, Skeleton, Descriptions, Table, Tag,
  Modal, Form, Select, InputNumber, DatePicker, Checkbox, Input,
  Space, Popconfirm, message,
} from 'antd'
import { ArrowLeftOutlined, PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import { useCustomer, useCustomerServices, CustomerServiceDetail } from '../hooks/useCustomers'
import { useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import { ServiceInventoryTable, SkuOption } from '../components/ServiceInventoryTable'
```

- [ ] **Step 2: Remove SvcInventoryItem interface**

Delete these lines (they now live inside `ServiceInventoryTable.tsx`):

```tsx
interface SvcInventoryItem {
  id: number
  sku: string
  description: string
  quantity: number
  groupNumber: number
  itemNumber: number
  comments: string | null
}
```

- [ ] **Step 3: Replace inventory state with skus state**

Find these two state lines inside `ServicesTab`:

```tsx
  const [svcInventory, setSvcInventory]   = useState<SvcInventoryItem[]>([])
  const [invLoading, setInvLoading]       = useState(false)
```

Replace with:

```tsx
  const [skus, setSkus]           = useState<SkuOption[]>([])
  const [skusLoaded, setSkusLoaded] = useState(false)
```

- [ ] **Step 4: Remove inventory fetch from openAdd**

Find inside `openAdd`:

```tsx
    setSvcInventory([])
```

Delete that line. The function body becomes:

```tsx
  async function openAdd() {
    await loadRefData()
    setEditing(null)
    form.setFieldsValue({
      serviceTypeId: undefined,
      frequencyCode: undefined,
      servicePrice: 0,
      serviceQty: 1,
      startWeek: 1,
      firstServiceDate: null,
      lastServiceDate: null,
      salesTaxId: null,
      commissionPaid: false,
      comments: null,
      isActive: true,
    })
    setModalOpen(true)
  }
```

- [ ] **Step 5: Remove inventory fetch from openEdit**

Find inside `openEdit`:

```tsx
    setSvcInventory([])
    setInvLoading(true)
    client.get(`/customers/${customerId}/services/${svc.customerSvcId}/inventory`)
      .then(r => setSvcInventory(r.data))
      .catch(() => {})
      .finally(() => setInvLoading(false))
```

Delete those four lines. The function body becomes:

```tsx
  async function openEdit(svc: CustomerServiceDetail) {
    await loadRefData()
    setEditing(svc)
    form.setFieldsValue({
      serviceTypeId: svc.serviceTypeId,
      frequencyCode: svc.frequencyCode,
      servicePrice: svc.servicePrice,
      serviceQty: svc.serviceQty,
      startWeek: svc.startWeek,
      firstServiceDate: svc.firstServiceDate ? dayjs(svc.firstServiceDate) : null,
      lastServiceDate:  svc.lastServiceDate  ? dayjs(svc.lastServiceDate)  : null,
      salesTaxId: svc.salesTaxId ?? null,
      commissionPaid: svc.commissionPaid,
      comments: svc.comments ?? null,
      isActive: svc.isActive,
    })
    setModalOpen(true)
  }
```

- [ ] **Step 6: Add handleExpand and skus loader**

After the `handleDelete` function, add:

```tsx
  async function handleExpand(expanded: boolean) {
    if (expanded && !skusLoaded) {
      try {
        const data = await client.get('/inventory').then(r => r.data)
        setSkus(data.map((item: { sku: string; description: string }) => ({
          sku: item.sku,
          description: item.description,
        })))
        setSkusLoaded(true)
      } catch {
        message.error('Failed to load SKU list')
      }
    }
  }
```

- [ ] **Step 7: Add expandable prop to the services Table and remove inventory section from modal**

Replace the entire `return (...)` block of `ServicesTab` with:

```tsx
  return (
    <>
      <div style={{ marginBottom: 12, textAlign: 'right' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
          Add Service
        </Button>
      </div>

      <Table
        dataSource={data ?? []}
        columns={columns}
        rowKey="customerSvcId"
        loading={isLoading}
        size="small"
        pagination={false}
        expandable={{
          expandedRowRender: (record) => (
            <ServiceInventoryTable
              customerId={customerId}
              customerSvcId={record.customerSvcId}
              skus={skus}
            />
          ),
          onExpand: handleExpand,
        }}
      />

      <Modal
        title={editing ? 'Edit Service' : 'Add Service'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        okText={editing ? 'Save' : 'Add'}
        confirmLoading={saving}
        width={620}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          {/* Row 1: Service Type + Frequency */}
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="serviceTypeId" label="Service Type" style={{ flex: 2 }}
              rules={[{ required: true, message: 'Required' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Select service type"
                options={serviceTypes
                  .filter(s => s.isActive || (editing && editing.serviceTypeId === s.serviceTypeId))
                  .map(s => ({ value: s.serviceTypeId, label: s.serviceName }))}
              />
            </Form.Item>
            <Form.Item name="frequencyCode" label="Frequency" style={{ flex: 1 }}
              rules={[{ required: true, message: 'Required' }]}>
              <Select
                placeholder="Frequency"
                options={frequencyCodes.map(f => ({ value: f.frequencyCode, label: f.description }))}
              />
            </Form.Item>
          </div>

          {/* Row 2: Price + Qty + Start Week + Tax */}
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="servicePrice" label="Price" style={{ width: 110 }}
              rules={[{ required: true, message: 'Required' }]}>
              <InputNumber prefix="$" min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="serviceQty" label="Qty" style={{ width: 70 }}
              rules={[{ required: true, message: 'Required' }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="startWeek" label="Start Week" style={{ width: 100 }}
              rules={[{ required: true, message: 'Required' }]}>
              <InputNumber min={1} max={53} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="salesTaxId" label="Tax Rate" style={{ width: 155 }}>
              <Select
                allowClear
                placeholder="No tax"
                options={taxRates.map(t => ({
                  value: t.salesTaxId,
                  label: `${t.description} (${(t.taxRate * 100).toFixed(2)}%)`,
                }))}
              />
            </Form.Item>
          </div>

          {/* Row 3: First Date + Last Date + Commission Paid + Active */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <Form.Item name="firstServiceDate" label="First Service Date" style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="lastServiceDate" label="Last Service Date" style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <div style={{ display: 'flex', gap: 16, paddingBottom: 24 }}>
              <Form.Item name="commissionPaid" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Checkbox>Commission Paid</Checkbox>
              </Form.Item>
              <Form.Item name="isActive" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Checkbox>Active</Checkbox>
              </Form.Item>
            </div>
          </div>

          <Form.Item name="comments" label="Comments" style={{ marginBottom: 0 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
```

- [ ] **Step 8: Remove the Inventory tab**

In `CustomerDetailPage` (the default export), find the tabs `items` array and remove this entry:

```tsx
          { key: 'inventory',  label: 'Inventory',  children: <div>Inventory — Phase 5</div> },
```

- [ ] **Step 9: Verify TypeScript compiles**

```bash
cd C:/dev/HFS-SaaS/frontend
npm run build 2>&1 | head -40
```

Expected: no TypeScript errors. If there are errors, they will reference specific lines — fix them before continuing.

- [ ] **Step 10: Commit**

```bash
cd C:/dev/HFS-SaaS
git add frontend/src/components/ServiceInventoryTable.tsx
git add frontend/src/pages/CustomerDetailPage.tsx
git commit -m "feat: expandable service rows with inline inventory add/edit/delete"
```

---

## Task 5: Manual smoke test

- [ ] **Step 1: Start API and frontend**

```bash
# Terminal 1 — API
cd C:/dev/HFS-SaaS/src/HFS.Api
dotnet run

# Terminal 2 — Frontend
cd C:/dev/HFS-SaaS/frontend
npm run dev
```

- [ ] **Step 2: Verify expandable rows**

1. Navigate to a customer detail page → Services tab
2. Confirm each service row has an expand chevron on the left
3. Click a chevron — the row expands and shows the inventory sub-table (spinner then rows or "No inventory assigned")
4. Collapse and re-expand — no second network request (check browser Network tab)

- [ ] **Step 3: Verify add flow**

1. Expand a service row
2. Click **Add Item**
3. Confirm the SKU dropdown shows existing SKUs from inventory master (format: `SKU — Description`)
4. Select a SKU, enter a quantity, click **Save**
5. Row appears as read-only; SKU is no longer available in the dropdown for a second add on the same service

- [ ] **Step 4: Verify edit flow**

1. Click the pencil icon on an existing inventory row
2. Qty, Group, and Comments cells become inputs; SKU remains read-only text
3. Change Qty, click **Save** — row returns to read-only with updated value
4. Click Edit on a second row while one is in edit mode — first row cancels automatically

- [ ] **Step 5: Verify delete flow**

1. Click the delete button on an inventory row
2. Popconfirm appears — click **Remove**
3. Row disappears from the sub-table

- [ ] **Step 6: Verify modal is clean**

1. Click the pencil (Edit) icon on a service row — modal opens
2. Confirm no inventory section at the bottom of the modal

- [ ] **Step 7: Verify Inventory tab is gone**

Confirm the customer detail page tabs are: Info, Services, Invoices, Commission (no Inventory tab).
