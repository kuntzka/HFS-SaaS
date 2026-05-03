import { useState, useEffect } from 'react'
import {
  Drawer, Descriptions, Tag, Button, DatePicker, Popconfirm,
  Space, Table, InputNumber, Input, message,
} from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import client from '../api/client'
import type { CustomerInvoiceSummary } from './CustomerInvoicesTab'

const NEW_LINE_ID = 0 as const

interface EditableSvcLine {
  id: number
  customerSvcId: number
  serviceDesc: string
  serviceQty: number
  servicePrice: number
  tax: number
  comments: string | null
}

interface NewLineValues {
  serviceDesc: string
  serviceQty: number
  servicePrice: number
  tax: number
  comments: string
}

type DisplayLine = EditableSvcLine | { id: typeof NEW_LINE_ID }

interface Props {
  invoice: CustomerInvoiceSummary | null
  onClose: () => void
  onMutated: () => void
}

export function InvoiceDrawer({ invoice, onClose, onMutated }: Props) {
  const open = invoice !== null

  const [isComplete, setIsComplete] = useState(false)
  const [serviceDate, setServiceDate] = useState<Dayjs | null>(null)

  const [editedLines, setEditedLines] = useState<EditableSvcLine[]>([])
  const [linesLoading, setLinesLoading] = useState(false)
  const [savingLines, setSavingLines] = useState(false)
  const [savingDate, setSavingDate] = useState(false)
  const [completing, setCompleting] = useState(false)

  const [adding, setAdding] = useState(false)
  const [newLine, setNewLine] = useState<NewLineValues>({
    serviceDesc: '', serviceQty: 1, servicePrice: 0, tax: 0, comments: '',
  })
  const [savingNew, setSavingNew] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  useEffect(() => {
    if (!invoice) return
    setIsComplete(invoice.isComplete)
    setServiceDate(invoice.serviceDate ? dayjs(invoice.serviceDate) : null)
    setEditedLines([])
    setAdding(false)
    setNewLine({ serviceDesc: '', serviceQty: 1, servicePrice: 0, tax: 0, comments: '' })
    setLinesLoading(true)
    let cancelled = false
    client
      .get(`/invoices/${invoice.invoiceNumber}/svc-lines`)
      .then(r => { if (!cancelled) setEditedLines(r.data) })
      .catch(() => { if (!cancelled) message.error('Failed to load service lines') })
      .finally(() => { if (!cancelled) setLinesLoading(false) })
    return () => { cancelled = true }
  }, [invoice?.invoiceNumber])

  async function handleServiceDateChange(date: Dayjs | null, _dateString: string | string[]) {
    if (!invoice) return
    setSavingDate(true)
    try {
      await client.put(`/invoices/${invoice.invoiceNumber}/service-date`, {
        serviceDate: date ? date.format('YYYY-MM-DD') : null,
      })
      setServiceDate(date)
      if (date !== null) setIsComplete(true)
      onMutated()
    } catch {
      message.error('Failed to update service date')
    } finally {
      setSavingDate(false)
    }
  }

  async function handleMarkComplete() {
    if (!invoice) return
    setCompleting(true)
    try {
      await client.put(`/invoices/${invoice.invoiceNumber}/complete`, { complete: true })
      setIsComplete(true)
      onMutated()
    } catch {
      message.error('Failed to mark invoice complete')
    } finally {
      setCompleting(false)
    }
  }

  async function handleSaveLines() {
    if (!invoice) return
    setSavingLines(true)
    try {
      await client.put(
        `/invoices/${invoice.invoiceNumber}/svc-lines`,
        editedLines.map(l => ({ id: l.id, servicePrice: l.servicePrice, tax: l.tax }))
      )
      message.success('Service lines saved')
      onMutated()
    } catch {
      message.error('Failed to save service lines')
    } finally {
      setSavingLines(false)
    }
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
      const linesRes = await client.get(`/invoices/${invoice.invoiceNumber}/svc-lines`)
      setEditedLines(linesRes.data)
      setAdding(false)
      setNewLine({ serviceDesc: '', serviceQty: 1, servicePrice: 0, tax: 0, comments: '' })
      onMutated()
    } catch {
      message.error('Failed to add service line')
    } finally {
      setSavingNew(false)
    }
  }

  async function handleDelete(id: number) {
    if (!invoice) return
    setDeletingId(id)
    try {
      await client.delete(`/invoices/${invoice.invoiceNumber}/svc-lines/${id}`)
      setEditedLines(prev => prev.filter(l => l.id !== id))
      onMutated()
    } catch {
      message.error('Failed to delete service line')
    } finally {
      setDeletingId(null)
    }
  }

  function handleOpenPdf() {
    if (!invoice) return
    window.open(`/api/reports/invoice/${invoice.invoiceNumber}/pdf`, '_blank')
  }

  const displayLines: DisplayLine[] = [
    ...editedLines,
    ...(adding ? [{ id: NEW_LINE_ID }] : []),
  ]

  const svcLineColumns = [
    {
      title: 'Description',
      key: 'serviceDesc',
      render: (_: unknown, record: DisplayLine) => {
        if (record.id === NEW_LINE_ID) {
          return (
            <Input
              size="small"
              placeholder="Description"
              value={newLine.serviceDesc}
              onChange={e => setNewLine(prev => ({ ...prev, serviceDesc: e.target.value }))}
            />
          )
        }
        return (record as EditableSvcLine).serviceDesc
      },
    },
    {
      title: 'Price',
      key: 'servicePrice',
      width: 110,
      render: (_: unknown, record: DisplayLine) => {
        if (record.id === NEW_LINE_ID) {
          return (
            <InputNumber
              size="small"
              min={0}
              precision={2}
              prefix="$"
              value={newLine.servicePrice}
              onChange={v => setNewLine(prev => ({ ...prev, servicePrice: v ?? 0 }))}
              style={{ width: '100%' }}
            />
          )
        }
        const line = record as EditableSvcLine
        if (!isComplete) {
          return (
            <InputNumber
              size="small"
              min={0}
              precision={2}
              prefix="$"
              value={line.servicePrice}
              onChange={v => setEditedLines(prev =>
                prev.map(l => l.id === line.id ? { ...l, servicePrice: v ?? 0 } : l)
              )}
              style={{ width: '100%' }}
            />
          )
        }
        return `$${line.servicePrice.toFixed(2)}`
      },
    },
    {
      title: 'Qty',
      key: 'serviceQty',
      width: 70,
      render: (_: unknown, record: DisplayLine) => {
        if (record.id === NEW_LINE_ID) {
          return (
            <InputNumber
              size="small"
              min={1}
              value={newLine.serviceQty}
              onChange={v => setNewLine(prev => ({ ...prev, serviceQty: v ?? 1 }))}
              style={{ width: '100%' }}
            />
          )
        }
        return (record as EditableSvcLine).serviceQty
      },
    },
    {
      title: 'Tax',
      key: 'tax',
      width: 100,
      render: (_: unknown, record: DisplayLine) => {
        if (record.id === NEW_LINE_ID) {
          return (
            <InputNumber
              size="small"
              min={0}
              precision={2}
              prefix="$"
              value={newLine.tax}
              onChange={v => setNewLine(prev => ({ ...prev, tax: v ?? 0 }))}
              style={{ width: '100%' }}
            />
          )
        }
        const line = record as EditableSvcLine
        if (!isComplete) {
          return (
            <InputNumber
              size="small"
              min={0}
              precision={2}
              prefix="$"
              value={line.tax}
              onChange={v => setEditedLines(prev =>
                prev.map(l => l.id === line.id ? { ...l, tax: v ?? 0 } : l)
              )}
              style={{ width: '100%' }}
            />
          )
        }
        return `$${line.tax.toFixed(2)}`
      },
    },
    {
      title: 'Comments',
      key: 'comments',
      render: (_: unknown, record: DisplayLine) => {
        if (record.id === NEW_LINE_ID) {
          return (
            <Input
              size="small"
              value={newLine.comments}
              onChange={e => setNewLine(prev => ({ ...prev, comments: e.target.value }))}
            />
          )
        }
        return (record as EditableSvcLine).comments ?? '—'
      },
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: DisplayLine) => {
        if (record.id === NEW_LINE_ID) {
          return (
            <Space size={4}>
              <Button
                size="small"
                type="primary"
                onClick={handleSaveNew}
                loading={savingNew}
                disabled={!newLine.serviceDesc.trim()}
              >
                Save
              </Button>
              <Button size="small" onClick={() => setAdding(false)}>Cancel</Button>
            </Space>
          )
        }
        if (isComplete) return null
        const line = record as EditableSvcLine
        return (
          <Popconfirm
            title="Remove this line?"
            okText="Remove"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(line.id)}
          >
            <Button
              size="small"
              icon={<DeleteOutlined />}
              danger
              loading={deletingId === line.id}
            />
          </Popconfirm>
        )
      },
    },
  ]

  if (!invoice) return null

  const total = (invoice.servicePrice + invoice.tax).toFixed(2)

  return (
    <Drawer
      title={
        <Space>
          {`Invoice #${invoice.invoiceNumber}`}
          {isComplete
            ? <Tag color="green">Complete</Tag>
            : <Tag>Pending</Tag>}
        </Space>
      }
      open={open}
      onClose={onClose}
      width={600}
      destroyOnClose
    >
      <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="Invoice Date">
          {dayjs(invoice.invoiceDate).format('MM/DD/YYYY')}
        </Descriptions.Item>
        <Descriptions.Item label="Service Date">
          <DatePicker
            value={serviceDate}
            onChange={handleServiceDateChange}
            format="MM/DD/YYYY"
            allowClear
            disabled={isComplete || savingDate}
            style={{ width: 160 }}
          />
        </Descriptions.Item>
        <Descriptions.Item label="Total">${total}</Descriptions.Item>
        <Descriptions.Item label="Qty">{invoice.serviceQty}</Descriptions.Item>
      </Descriptions>

      <Space style={{ marginBottom: 16 }}>
        {!isComplete && (
          <Popconfirm
            title="Mark this invoice as complete? This cannot be undone."
            okText="Mark Complete"
            onConfirm={handleMarkComplete}
          >
            <Button type="primary" loading={completing}>
              Mark Complete
            </Button>
          </Popconfirm>
        )}
        <Button onClick={handleOpenPdf}>View PDF</Button>
      </Space>

      <Table<DisplayLine>
        dataSource={displayLines}
        columns={svcLineColumns}
        rowKey="id"
        size="small"
        pagination={false}
        loading={linesLoading}
        locale={{ emptyText: 'No service lines' }}
      />

      {!isComplete && (
        <Space style={{ marginTop: 8 }}>
          {!adding && (
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              size="small"
              onClick={() => setAdding(true)}
            >
              Add Line
            </Button>
          )}
          {editedLines.length > 0 && (
            <Button
              type="primary"
              size="small"
              onClick={handleSaveLines}
              loading={savingLines}
            >
              Save Lines
            </Button>
          )}
        </Space>
      )}
    </Drawer>
  )
}
