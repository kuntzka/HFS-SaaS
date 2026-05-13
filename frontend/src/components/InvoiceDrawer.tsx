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
