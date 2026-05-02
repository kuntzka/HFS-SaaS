import { useState, useEffect } from 'react'
import {
  Drawer, Descriptions, Tag, Button, DatePicker, Popconfirm,
  Space, Table, InputNumber, message,
} from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import client from '../api/client'
import type { CustomerInvoiceSummary } from './CustomerInvoicesTab'

interface EditableSvcLine {
  id: number
  customerSvcId: number
  serviceDesc: string
  serviceQty: number
  servicePrice: number
  tax: number
  comments: string | null
}

interface Props {
  invoice: CustomerInvoiceSummary | null
  onClose: () => void
  onMutated: () => void
}

export function InvoiceDrawer({ invoice, onClose, onMutated }: Props) {
  const open = invoice !== null

  // Local state so the drawer reflects mutations without waiting for parent re-fetch
  const [isComplete, setIsComplete] = useState(false)
  const [serviceDate, setServiceDate] = useState<Dayjs | null>(null)

  const [linesLoading, setLinesLoading] = useState(false)
  const [editedLines, setEditedLines] = useState<EditableSvcLine[]>([])
  const [savingLines, setSavingLines] = useState(false)
  const [savingDate, setSavingDate] = useState(false)
  const [completing, setCompleting] = useState(false)

  // Sync local state when a new invoice is selected
  useEffect(() => {
    if (!invoice) return
    setIsComplete(invoice.isComplete)
    setServiceDate(invoice.serviceDate ? dayjs(invoice.serviceDate) : null)
    setEditedLines([])
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
      // Backend auto-marks complete when serviceDate is non-null
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

  function handleOpenPdf() {
    if (!invoice) return
    window.open(`/api/reports/invoice/${invoice.invoiceNumber}/pdf`, '_blank')
  }

  const svcLineColumns = [
    {
      title: 'Description',
      dataIndex: 'serviceDesc',
      key: 'serviceDesc',
    },
    {
      title: 'Price',
      key: 'servicePrice',
      width: 110,
      render: (_: unknown, record: EditableSvcLine) => {
        if (!isComplete) {
          return (
            <InputNumber
              size="small"
              min={0}
              precision={2}
              prefix="$"
              value={record.servicePrice}
              onChange={v => setEditedLines(prev =>
                prev.map(l => l.id === record.id ? { ...l, servicePrice: v ?? 0 } : l)
              )}
              style={{ width: '100%' }}
            />
          )
        }
        return `$${record.servicePrice.toFixed(2)}`
      },
    },
    {
      title: 'Qty',
      dataIndex: 'serviceQty',
      key: 'serviceQty',
      width: 60,
    },
    {
      title: 'Tax',
      key: 'tax',
      width: 100,
      render: (_: unknown, record: EditableSvcLine) => {
        if (!isComplete) {
          return (
            <InputNumber
              size="small"
              min={0}
              precision={2}
              prefix="$"
              value={record.tax}
              onChange={v => setEditedLines(prev =>
                prev.map(l => l.id === record.id ? { ...l, tax: v ?? 0 } : l)
              )}
              style={{ width: '100%' }}
            />
          )
        }
        return `$${record.tax.toFixed(2)}`
      },
    },
    {
      title: 'Comments',
      dataIndex: 'comments',
      key: 'comments',
      render: (v: string | null) => v ?? '—',
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
      {/* Details */}
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

      {/* Actions */}
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

      {/* Service Lines */}
      <Table<EditableSvcLine>
        dataSource={editedLines}
        columns={svcLineColumns}
        rowKey="id"
        size="small"
        pagination={false}
        loading={linesLoading}
        locale={{ emptyText: 'No service lines' }}
      />

      {!isComplete && (
        <Button
          type="primary"
          style={{ marginTop: 8 }}
          onClick={handleSaveLines}
          loading={savingLines}
        >
          Save Lines
        </Button>
      )}
    </Drawer>
  )
}
