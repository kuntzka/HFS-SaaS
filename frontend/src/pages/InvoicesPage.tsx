import { useState } from 'react'
import { Alert, Button, Card, Col, InputNumber,
         Popconfirm, Row, Select, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { EditOutlined, FileTextOutlined, PrinterOutlined, ThunderboltOutlined } from '@ant-design/icons'
import client, { getAccessToken } from '../api/client'
import dayjs from 'dayjs'
import { InvoiceEditModal } from '../components/InvoiceEditModal'
import type { InvoiceItem } from '../components/InvoiceEditModal'

const { Title, Text } = Typography

interface InvoiceSvcRow {
  serviceDesc: string
  serviceQty: number
  servicePrice: number
  tax: number
  comments: string | null
}

interface GenerateEvent {
  type: 'progress' | 'done' | 'error' | 'alreadyExists'
  invoicesCreated?: number
  servicesProcessed?: number
  message?: string
}

const currentYear = new Date().getFullYear()

export default function InvoicesPage() {
  const [week, setWeek] = useState<number>(1)
  const [year, setYear] = useState<number>(currentYear)
  const [invoices, setInvoices] = useState<InvoiceItem[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genStatus, setGenStatus] = useState<{ type: string; message: string } | null>(null)
  const [alreadyExists, setAlreadyExists] = useState(false)
  const [expandedDetails, setExpandedDetails] = useState<Record<number, InvoiceSvcRow[]>>({})

  // Edit invoice modal state
  const [editInvoice, setEditInvoice] = useState<InvoiceItem | null>(null)

  const loadInvoices = async () => {
    setLoading(true)
    try {
      const res = await client.get<InvoiceItem[]>('/invoices', { params: { week, year } })
      setInvoices(res.data)
    } finally {
      setLoading(false)
    }
  }

  const generate = async (force = false) => {
    setGenerating(true)
    setGenStatus(null)
    setAlreadyExists(false)

    const token = getAccessToken()
    try {
      const res = await fetch('/api/invoices/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ week, year, force }),
      })

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) return
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''
        for (const event of events) {
          if (!event.startsWith('data:')) continue
          const payload: GenerateEvent = JSON.parse(event.slice(5).trim())
          if (payload.type === 'done') {
            setGenStatus({ type: 'success', message: `Generated ${payload.invoicesCreated} invoices (${payload.servicesProcessed} services).` })
            await loadInvoices()
          } else if (payload.type === 'alreadyExists') {
            setAlreadyExists(true)
            setGenStatus({ type: 'warning', message: payload.message ?? '' })
          } else if (payload.type === 'error') {
            setGenStatus({ type: 'error', message: payload.message ?? 'Generation failed.' })
          }
        }
      }
    } finally {
      setGenerating(false)
    }
  }

  const openEditModal = (record: InvoiceItem) => setEditInvoice(record)

  const [printComplete, setPrintComplete] = useState<string>('all')
  const [printing, setPrinting] = useState(false)

  const printInvoices = async () => {
    setPrinting(true)
    try {
      const params: Record<string, string | number> = { week, year }
      if (printComplete !== 'all') params.complete = printComplete === 'complete' ? 'true' : 'false'
      const token = getAccessToken()
      const res = await fetch(`/api/reports/invoices-batch?${new URLSearchParams(params as Record<string, string>).toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } finally {
      setPrinting(false)
    }
  }

  const loadDetail = async (invoiceNumber: number) => {
    if (expandedDetails[invoiceNumber]) return
    const res = await client.get<InvoiceSvcRow[]>(`/invoices/${invoiceNumber}/detail`)
    setExpandedDetails(prev => ({ ...prev, [invoiceNumber]: res.data }))
  }

  const fmt = (n: number) => `$${n.toFixed(2)}`

  const columns: ColumnsType<InvoiceItem> = [
    { title: '#', dataIndex: 'invoiceNumber', key: 'invoiceNumber', width: 80 },
    { title: 'Customer', dataIndex: 'companyName', key: 'companyName' },
    { title: 'Route', dataIndex: 'routeCode', key: 'routeCode', width: 70, render: v => v ?? '—' },
    { title: 'Service Date', dataIndex: 'serviceDate', key: 'serviceDate', width: 110,
      render: (v: string | null) => v ? dayjs(v).format('MM/DD/YYYY') : <Text type="secondary">—</Text> },
    { title: 'Price', dataIndex: 'servicePrice', key: 'servicePrice', width: 90, render: fmt, align: 'right' },
    { title: 'Tax', dataIndex: 'tax', key: 'tax', width: 80, render: fmt, align: 'right' },
    { title: 'Total', key: 'total', width: 90, align: 'right',
      render: (_: unknown, r: InvoiceItem) => fmt(r.servicePrice + r.tax) },
    { title: 'Status', key: 'status', width: 110,
      render: (_: unknown, r: InvoiceItem) => (
        <Space size={4}>
          {r.isComplete && <Tag color="green">Complete</Tag>}
          {r.isPrinted  && <Tag color="blue">Printed</Tag>}
          {r.isAdHoc    && <Tag color="orange">Ad-hoc</Tag>}
          {!r.isComplete && <Tag>Pending</Tag>}
        </Space>
      )},
    { title: '', key: 'actions', width: 70,
      render: (_: unknown, r: InvoiceItem) => (
        <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(r)}>
          Edit
        </Button>
      )},
  ]

  const total = invoices.reduce((s, i) => s + i.servicePrice + i.tax, 0)

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>Invoices</Title>

      <Space style={{ marginBottom: 12 }}>
        <Text>Week:</Text>
        <InputNumber min={1} max={53} value={week} onChange={v => setWeek(v ?? 1)} />
        <Text>Year:</Text>
        <InputNumber min={2020} max={2035} value={year} onChange={v => setYear(v ?? currentYear)} />
      </Space>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Card title={<><ThunderboltOutlined /> Generate</>}>
            <Space direction="vertical" style={{ width: '100%' }}>
              {genStatus && (
                <Alert
                  message={genStatus.message}
                  type={genStatus.type as 'success' | 'warning' | 'error'}
                  showIcon
                />
              )}
              <Space>
                <Button type="primary" icon={<ThunderboltOutlined />} loading={generating} onClick={() => generate(false)}>
                  Generate
                </Button>
                {alreadyExists && (
                  <Popconfirm
                    title="Delete existing invoices and regenerate?"
                    onConfirm={() => generate(true)}
                    okText="Regenerate" cancelText="Cancel"
                  >
                    <Button danger>Regenerate</Button>
                  </Popconfirm>
                )}
              </Space>
            </Space>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title={<><PrinterOutlined /> Print Invoices</>}>
            <Space>
              <Select value={printComplete} onChange={setPrintComplete} style={{ width: 120 }}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'pending', label: 'Pending' },
                  { value: 'complete', label: 'Complete' },
                ]} />
              <Button icon={<PrinterOutlined />} loading={printing} onClick={printInvoices}>
                Print
              </Button>
            </Space>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title={<><FileTextOutlined /> Load Invoices</>}>
            <Button onClick={loadInvoices} loading={loading}>Load Week {week}</Button>
          </Card>
        </Col>
      </Row>

      {invoices.length > 0 && (
        <Card title={`Week ${week}, ${year} — ${invoices.length} invoices  |  Total: ${fmt(total)}`}>
          <Table
            dataSource={invoices}
            columns={columns}
            rowKey="invoiceNumber"
            size="small"
            pagination={{ pageSize: 50 }}
            expandable={{
              onExpand: (expanded, record) => { if (expanded) loadDetail(record.invoiceNumber) },
              expandedRowRender: (record) => {
                const rows = expandedDetails[record.invoiceNumber]
                if (!rows) return <span>Loading…</span>
                return (
                  <Table
                    dataSource={rows}
                    rowKey="serviceDesc"
                    size="small"
                    pagination={false}
                    columns={[
                      { title: 'Service', dataIndex: 'serviceDesc', key: 'serviceDesc' },
                      { title: 'Qty', dataIndex: 'serviceQty', key: 'serviceQty', width: 60, align: 'right' },
                      { title: 'Price', dataIndex: 'servicePrice', key: 'servicePrice', width: 90, align: 'right', render: fmt },
                      { title: 'Tax', dataIndex: 'tax', key: 'tax', width: 80, align: 'right', render: fmt },
                      { title: 'Comments', dataIndex: 'comments', key: 'comments', render: (v: string | null) => v ?? '—' },
                    ]}
                  />
                )
              },
            }}
          />
        </Card>
      )}

      <InvoiceEditModal
        invoice={editInvoice}
        onClose={() => setEditInvoice(null)}
        onSaved={loadInvoices}
      />
    </div>
  )
}
