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
    setLoading(true)
    setItems([])
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
          id:          res.data.inventoryItemId,
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
