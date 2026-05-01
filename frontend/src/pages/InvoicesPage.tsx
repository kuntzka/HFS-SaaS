import { useState } from 'react'
import { Alert, Button, Card, Checkbox, Col, DatePicker, Divider, InputNumber, message,
         Modal, Popconfirm, Row, Select, Space, Spin, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CheckOutlined, EditOutlined, FileTextOutlined, PrinterOutlined, ThunderboltOutlined } from '@ant-design/icons'
import client, { getAccessToken } from '../api/client'
import dayjs, { type Dayjs } from 'dayjs'

const { Title, Text } = Typography

interface InvoiceItem {
  invoiceNumber: number
  customerId: number
  companyName: string
  routeCode: string | null
  servicePrice: number
  tax: number
  taxableAmount: number
  weekNumber: number
  schedYear: number
  isComplete: boolean
  isPrinted: boolean
  isAdHoc: boolean
  serviceDate: string | null
}

interface InvoiceSvcRow {
  serviceDesc: string
  serviceQty: number
  servicePrice: number
  tax: number
  comments: string | null
}

interface EditableSvcLine {
  id: number
  customerSvcId: number
  serviceDesc: string
  serviceQty: number
  servicePrice: number
  tax: number
  comments: string | null
}

interface Employee {
  employeeId: number
  firstName: string
  lastName: string
  isActive: boolean
}

interface CommissionPreviewItem {
  customerSvcId: number
  customerId: number
  companyName: string
  serviceTypeName: string
  servicePrice: number
  frequencyCode: string
  startWeek: number
  numServiceWeek: number
  commissionType: string
  employeeId: number | null
  employeeName: string
  commissionAmount: number
  payrollType: number
  ruleDescription: string
  isFirstCommission: boolean
}

interface ExistingCommission {
  id: number
  employeeName: string
  commissionAmount: number
  serviceTypeName: string
  payrollType: number
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

  // Complete invoice modal state
  const [editInvoice, setEditInvoice] = useState<InvoiceItem | null>(null)
  const [editServiceDate, setEditServiceDate] = useState<Dayjs | null>(null)
  const [editLines, setEditLines] = useState<EditableSvcLine[]>([])
  const [editSaving, setEditSaving] = useState(false)

  // Commission state within the modal
  const [employees, setEmployees] = useState<Employee[]>([])
  const [editSacEmployeeId, setEditSacEmployeeId] = useState<number | null>(null)
  const [editCalcAmc, setEditCalcAmc] = useState(false)
  const [editCommPreview, setEditCommPreview] = useState<CommissionPreviewItem[]>([])
  const [editCommPreviewing, setEditCommPreviewing] = useState(false)
  const [editExistingComm, setEditExistingComm] = useState<ExistingCommission[]>([])

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

  const openEditModal = async (record: InvoiceItem) => {
    setEditInvoice(record)
    setEditServiceDate(record.serviceDate ? dayjs(record.serviceDate) : null)
    setEditSacEmployeeId(null)
    setEditCalcAmc(false)
    setEditCommPreview([])

    const [linesRes, empRes, commRes] = await Promise.all([
      client.get<EditableSvcLine[]>(`/invoices/${record.invoiceNumber}/svc-lines`),
      employees.length === 0 ? client.get<Employee[]>('/employees') : Promise.resolve(null),
      client.get<ExistingCommission[]>(`/commissions/invoice/${record.invoiceNumber}`),
    ])
    setEditLines(linesRes.data)
    if (empRes) setEmployees(empRes.data.filter((e: { isActive: boolean }) => e.isActive))
    setEditExistingComm(commRes.data)
  }

  const calculateCommission = async () => {
    if (!editInvoice || !editServiceDate || !editSacEmployeeId) return
    setEditCommPreviewing(true)
    try {
      const res = await client.post<CommissionPreviewItem[]>('/commissions/preview', {
        invoiceNumber: editInvoice.invoiceNumber,
        serviceDate: editServiceDate.format('YYYY-MM-DD'),
        sacEmployeeId: editSacEmployeeId,
        calculateAmc: editCalcAmc,
      })
      setEditCommPreview(res.data)
    } catch {
      message.error('Failed to calculate commission.')
    } finally {
      setEditCommPreviewing(false)
    }
  }

  const saveEdit = async () => {
    if (!editInvoice) return
    setEditSaving(true)
    try {
      // Send date as YYYY-MM-DD to avoid UTC timezone shifting the day
      await client.put(`/invoices/${editInvoice.invoiceNumber}/service-date`, {
        serviceDate: editServiceDate ? editServiceDate.format('YYYY-MM-DD') : null,
      })

      if (editLines.length > 0) {
        await client.put(`/invoices/${editInvoice.invoiceNumber}/svc-lines`,
          editLines.map(l => ({ id: l.id, servicePrice: l.servicePrice, tax: l.tax })))
      }

      if (editCommPreview.length > 0 && editServiceDate) {
        await client.post('/commissions/save', {
          invoiceNumber: editInvoice.invoiceNumber,
          serviceDate: editServiceDate.format('YYYY-MM-DD'),
          items: editCommPreview.map(p => ({
            customerSvcId: p.customerSvcId,
            customerId: p.customerId,
            companyName: p.companyName,
            serviceTypeName: p.serviceTypeName,
            frequencyCode: p.frequencyCode,
            startWeek: p.startWeek,
            numServiceWeek: p.numServiceWeek,
            commissionType: p.commissionType,
            employeeId: p.employeeId,
            employeeName: p.employeeName,
            commissionAmount: p.commissionAmount,
            servicePrice: p.servicePrice,
            payrollType: p.payrollType,
            isFirstCommission: p.isFirstCommission,
          })),
        })
      }

      await loadInvoices()
      setEditInvoice(null)
    } catch {
      message.error('Failed to save. Please check your connection and try again.')
    } finally {
      setEditSaving(false)
    }
  }

  const lineTotal = editLines.reduce((s, l) => s + l.servicePrice + l.tax, 0)

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

      {/* Complete Invoice Modal */}
      <Modal
        title={editInvoice ? `Invoice #${editInvoice.invoiceNumber} — ${editInvoice.companyName}` : ''}
        open={!!editInvoice}
        onCancel={() => setEditInvoice(null)}
        onOk={saveEdit}
        okText="Save"
        confirmLoading={editSaving}
        width={700}
      >
        {editInvoice && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Space align="center">
              <Text strong>Service Date:</Text>
              <DatePicker
                value={editServiceDate}
                onChange={setEditServiceDate}
                format="MM/DD/YYYY"
                placeholder="Set date to mark complete"
              />
              {editServiceDate
                ? <Tag color="green"><CheckOutlined /> Will mark complete</Tag>
                : <Tag>Pending — no date set</Tag>}
            </Space>

            {editLines.length > 0 && (
              <>
                <Text strong>Service Lines</Text>
                <Table
                  dataSource={editLines}
                  rowKey="id"
                  size="small"
                  pagination={false}
                  summary={() => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={2}><Text strong>Total</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={2} align="right">
                        <Text strong>{fmt(editLines.reduce((s, l) => s + l.servicePrice, 0))}</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={3} align="right">
                        <Text strong>{fmt(editLines.reduce((s, l) => s + l.tax, 0))}</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={4} align="right">
                        <Text strong>{fmt(lineTotal)}</Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  )}
                  columns={[
                    { title: 'Description', dataIndex: 'serviceDesc', key: 'serviceDesc' },
                    { title: 'Qty', dataIndex: 'serviceQty', key: 'serviceQty', width: 50, align: 'right' },
                    { title: 'Price', key: 'servicePrice', width: 110, align: 'right',
                      render: (_: unknown, line: EditableSvcLine) => (
                        <InputNumber
                          size="small"
                          value={line.servicePrice}
                          min={0}
                          precision={2}
                          prefix="$"
                          style={{ width: 100 }}
                          onChange={v => setEditLines(prev =>
                            prev.map(l => l.id === line.id ? { ...l, servicePrice: v ?? 0 } : l))}
                        />
                      )},
                    { title: 'Tax', key: 'tax', width: 110, align: 'right',
                      render: (_: unknown, line: EditableSvcLine) => (
                        <InputNumber
                          size="small"
                          value={line.tax}
                          min={0}
                          precision={2}
                          prefix="$"
                          style={{ width: 100 }}
                          onChange={v => setEditLines(prev =>
                            prev.map(l => l.id === line.id ? { ...l, tax: v ?? 0 } : l))}
                        />
                      )},
                    { title: 'Line Total', key: 'lineTotal', width: 90, align: 'right',
                      render: (_: unknown, line: EditableSvcLine) => fmt(line.servicePrice + line.tax) },
                  ]}
                />
              </>
            )}

            <Divider style={{ margin: '8px 0' }} />
            <Text strong>Commission</Text>

            <Space wrap align="center">
              <Text>Technician:</Text>
              <Select
                style={{ width: 200 }}
                placeholder="Select technician"
                allowClear
                value={editSacEmployeeId ?? undefined}
                onChange={v => { setEditSacEmployeeId(v ?? null); setEditCommPreview([]) }}
                options={employees
                  .filter(e => e.isActive)
                  .map(e => ({ value: e.employeeId, label: `${e.lastName}, ${e.firstName}` }))}
              />
              <Checkbox
                checked={editCalcAmc}
                onChange={e => { setEditCalcAmc(e.target.checked); setEditCommPreview([]) }}
              >
                Include AMC
              </Checkbox>
              <Button
                onClick={calculateCommission}
                disabled={!editServiceDate || !editSacEmployeeId}
              >
                Calculate
              </Button>
            </Space>

            {editCommPreviewing && <Spin size="small" />}

            {editCommPreview.length > 0 && (
              <Table
                dataSource={editCommPreview}
                rowKey={(_, i) => String(i)}
                size="small"
                pagination={false}
                columns={[
                  { title: 'Employee', dataIndex: 'employeeName', key: 'employeeName' },
                  { title: 'Type', dataIndex: 'commissionType', key: 'commissionType', width: 60 },
                  { title: 'Service', dataIndex: 'serviceTypeName', key: 'serviceTypeName' },
                  { title: 'Amount', key: 'commissionAmount', width: 120, align: 'right',
                    render: (_: unknown, item: CommissionPreviewItem, idx: number) => (
                      <InputNumber
                        size="small"
                        value={item.commissionAmount}
                        min={0}
                        precision={2}
                        prefix="$"
                        style={{ width: 110 }}
                        onChange={v => setEditCommPreview(prev =>
                          prev.map((p, i) => i === idx ? { ...p, commissionAmount: v ?? 0 } : p))}
                      />
                    )},
                  { title: '', key: 'flags', width: 90,
                    render: (_: unknown, item: CommissionPreviewItem) => (
                      <Space size={4}>
                        {item.isFirstCommission && <Tag color="purple">1st</Tag>}
                      </Space>
                    )},
                ]}
              />
            )}

            {editCommPreview.length === 0 && editExistingComm.length > 0 && (
              <Alert
                type="info"
                showIcon
                message="Commission already saved for this invoice"
                description={editExistingComm
                  .map(c => `${c.employeeName}: ${fmt(c.commissionAmount)}`)
                  .join(' · ')}
              />
            )}
          </Space>
        )}
      </Modal>
    </div>
  )
}
