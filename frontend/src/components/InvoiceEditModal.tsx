import { useState, useEffect, useCallback } from 'react'
import {
  Modal, DatePicker, Select, Checkbox, Table, InputNumber, Button,
  Space, Divider, Tag, message, Popconfirm, Input, Typography,
} from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import client from '../api/client'

const { Text } = Typography

export interface InvoiceItem {
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
  customerEmployeeId: number | null
  routeEmployeeId: number | null
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

interface NewLineValues {
  serviceDesc: string
  serviceQty: number
  servicePrice: number
  tax: number
  comments: string
}

const NEW_LINE_ID = 0 as const
type DisplayLine = EditableSvcLine | { id: typeof NEW_LINE_ID }

interface Props {
  invoice: InvoiceItem | null
  onClose: () => void
  onSaved: () => void
}

export function InvoiceEditModal({ invoice, onClose, onSaved }: Props) {
  const open = invoice !== null

  const [serviceDate, setServiceDate] = useState<Dayjs | null>(null)
  const [sacEmployeeId, setSacEmployeeId] = useState<number | null>(null)
  const [amcEmployeeId, setAmcEmployeeId] = useState<number | null>(null)
  const [includeAmc, setIncludeAmc] = useState(true)

  const [editedLines, setEditedLines] = useState<EditableSvcLine[]>([])
  const [localQtys, setLocalQtys] = useState<Record<number, number>>({})
  const [linesLoading, setLinesLoading] = useState(false)

  const [employees, setEmployees] = useState<Employee[]>([])

  const [commPreview, setCommPreview] = useState<CommissionPreviewItem[]>([])
  const [commPreviewing, setCommPreviewing] = useState(false)

  const [adding, setAdding] = useState(false)
  const [newLine, setNewLine] = useState<NewLineValues>({
    serviceDesc: '', serviceQty: 1, servicePrice: 0, tax: 0, comments: '',
  })
  const [savingNew, setSavingNew] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const [saving, setSaving] = useState(false)

  const runCommissionPreview = useCallback(async (
    inv: InvoiceItem,
    date: Dayjs | null,
    sac: number | null,
    amc: number | null,
    incAmc: boolean,
    lines: EditableSvcLine[]
  ) => {
    if (!date) return
    setCommPreviewing(true)
    try {
      const overrides = lines.map(l => ({ customerSvcId: l.customerSvcId, servicePrice: l.servicePrice }))
      const res = await client.post<CommissionPreviewItem[]>('/commissions/preview', {
        invoiceNumber: inv.invoiceNumber,
        serviceDate: date.format('YYYY-MM-DD'),
        sacEmployeeId: sac,
        calculateAmc: incAmc,
        amcEmployeeId: amc,
        overrides,
      })
      setCommPreview(res.data)
    } catch {
      message.error('Failed to calculate commission')
    } finally {
      setCommPreviewing(false)
    }
  }, [])

  // Load service lines and employees when invoice changes; set all defaults.
  useEffect(() => {
    if (!invoice) return
    const defaultDate = invoice.serviceDate ? dayjs(invoice.serviceDate) : dayjs()
    setServiceDate(defaultDate)
    setSacEmployeeId(invoice.routeEmployeeId ?? null)
    setAmcEmployeeId(invoice.customerEmployeeId ?? null)
    setIncludeAmc(true)
    setCommPreview([])
    setAdding(false)
    setNewLine({ serviceDesc: '', serviceQty: 1, servicePrice: 0, tax: 0, comments: '' })

    setLinesLoading(true)
    Promise.all([
      client.get<EditableSvcLine[]>(`/invoices/${invoice.invoiceNumber}/svc-lines`),
      employees.length === 0 ? client.get<Employee[]>('/employees') : Promise.resolve(null),
    ])
      .then(([linesRes, empRes]) => {
        const lines = linesRes.data
        setEditedLines(lines)
        const qtys: Record<number, number> = {}
        lines.forEach(l => { qtys[l.id] = l.serviceQty })
        setLocalQtys(qtys)
        if (empRes) setEmployees(empRes.data.filter((e: Employee) => e.isActive))
        // Auto-calculate using freshly loaded lines and already-set defaults
        runCommissionPreview(
          invoice,
          defaultDate,
          invoice.routeEmployeeId ?? null,
          invoice.customerEmployeeId ?? null,
          true,
          lines
        )
      })
      .catch(() => message.error('Failed to load invoice data'))
      .finally(() => setLinesLoading(false))
  }, [invoice?.invoiceNumber]) // eslint-disable-line react-hooks/exhaustive-deps

  function triggerRecalc(
    date: Dayjs | null = serviceDate,
    sac: number | null = sacEmployeeId,
    amc: number | null = amcEmployeeId,
    incAmc: boolean = includeAmc,
    lines: EditableSvcLine[] = editedLines
  ) {
    if (!invoice) return
    runCommissionPreview(invoice, date, sac, amc, incAmc, lines)
  }

  function handleQtyBlur(lineId: number) {
    const newQty = localQtys[lineId]
    if (newQty == null || newQty < 1) return
    const line = editedLines.find(l => l.id === lineId)
    if (!line) return
    // Compute unit price from the committed servicePrice / committed serviceQty
    // (editedLines still holds the old qty since we only update it here on blur)
    const unitPrice = line.serviceQty > 0 ? line.servicePrice / line.serviceQty : 0
    const newPrice = Math.round(unitPrice * newQty * 100) / 100
    const updatedLines = editedLines.map(l =>
      l.id === lineId ? { ...l, serviceQty: newQty, servicePrice: newPrice } : l
    )
    setEditedLines(updatedLines)
    triggerRecalc(serviceDate, sacEmployeeId, amcEmployeeId, includeAmc, updatedLines)
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
      const linesRes = await client.get<EditableSvcLine[]>(`/invoices/${invoice.invoiceNumber}/svc-lines`)
      const lines = linesRes.data
      setEditedLines(lines)
      const qtys: Record<number, number> = {}
      lines.forEach(l => { qtys[l.id] = l.serviceQty })
      setLocalQtys(qtys)
      setAdding(false)
      setNewLine({ serviceDesc: '', serviceQty: 1, servicePrice: 0, tax: 0, comments: '' })
      triggerRecalc(serviceDate, sacEmployeeId, amcEmployeeId, includeAmc, lines)
    } catch {
      message.error('Failed to add service line')
    } finally {
      setSavingNew(false)
    }
  }

  async function handleDeleteLine(id: number) {
    if (!invoice) return
    setDeletingId(id)
    try {
      await client.delete(`/invoices/${invoice.invoiceNumber}/svc-lines/${id}`)
      const updatedLines = editedLines.filter(l => l.id !== id)
      setEditedLines(updatedLines)
      setLocalQtys(prev => { const n = { ...prev }; delete n[id]; return n })
      triggerRecalc(serviceDate, sacEmployeeId, amcEmployeeId, includeAmc, updatedLines)
    } catch {
      message.error('Failed to delete service line')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleSave() {
    if (!invoice) return
    setSaving(true)
    try {
      await client.put(`/invoices/${invoice.invoiceNumber}/service-date`, {
        serviceDate: serviceDate ? serviceDate.format('YYYY-MM-DD') : null,
      })
      if (editedLines.length > 0) {
        await client.put(`/invoices/${invoice.invoiceNumber}/svc-lines`,
          editedLines.map(l => ({
            id: l.id,
            serviceQty: l.serviceQty,
            servicePrice: l.servicePrice,
            tax: l.tax,
          }))
        )
      }
      if (commPreview.length > 0 && serviceDate) {
        await client.post('/commissions/save', {
          invoiceNumber: invoice.invoiceNumber,
          serviceDate: serviceDate.format('YYYY-MM-DD'),
          items: commPreview.map(p => ({
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
      onSaved()
      onClose()
    } catch {
      message.error('Failed to save invoice')
    } finally {
      setSaving(false)
    }
  }

  const fmt = (n: number) => `$${n.toFixed(2)}`
  const lineTotal = editedLines.reduce((s, l) => s + l.servicePrice + l.tax, 0)
  const displayLines: DisplayLine[] = [...editedLines, ...(adding ? [{ id: NEW_LINE_ID }] : [])]

  const empOptions = employees.map(e => ({
    value: e.employeeId,
    label: `${e.lastName}, ${e.firstName}`,
  }))

  const svcColumns = [
    {
      title: 'Description', key: 'serviceDesc',
      render: (_: unknown, record: DisplayLine) => {
        if (record.id === NEW_LINE_ID) return (
          <Input size="small" placeholder="Description" value={newLine.serviceDesc}
            onChange={e => setNewLine(prev => ({ ...prev, serviceDesc: e.target.value }))} />
        )
        return (record as EditableSvcLine).serviceDesc
      },
    },
    {
      title: 'Qty', key: 'serviceQty', width: 80,
      render: (_: unknown, record: DisplayLine) => {
        if (record.id === NEW_LINE_ID) return (
          <InputNumber size="small" min={1} value={newLine.serviceQty} style={{ width: '100%' }}
            onChange={v => setNewLine(prev => ({ ...prev, serviceQty: v ?? 1 }))} />
        )
        const line = record as EditableSvcLine
        return (
          <InputNumber
            size="small" min={1} style={{ width: '100%' }}
            value={localQtys[line.id] ?? line.serviceQty}
            onChange={v => setLocalQtys(prev => ({ ...prev, [line.id]: v ?? 1 }))}
            onBlur={() => handleQtyBlur(line.id)}
          />
        )
      },
    },
    {
      title: 'Price', key: 'servicePrice', width: 110,
      render: (_: unknown, record: DisplayLine) => {
        if (record.id === NEW_LINE_ID) return (
          <InputNumber size="small" min={0} precision={2} prefix="$"
            value={newLine.servicePrice} style={{ width: '100%' }}
            onChange={v => setNewLine(prev => ({ ...prev, servicePrice: v ?? 0 }))} />
        )
        const line = record as EditableSvcLine
        return (
          <InputNumber size="small" min={0} precision={2} prefix="$"
            value={line.servicePrice} style={{ width: '100%' }}
            onChange={v => setEditedLines(prev =>
              prev.map(l => l.id === line.id ? { ...l, servicePrice: v ?? 0 } : l))}
            onBlur={() => triggerRecalc()} />
        )
      },
    },
    {
      title: 'Tax', key: 'tax', width: 100,
      render: (_: unknown, record: DisplayLine) => {
        if (record.id === NEW_LINE_ID) return (
          <InputNumber size="small" min={0} precision={2} prefix="$"
            value={newLine.tax} style={{ width: '100%' }}
            onChange={v => setNewLine(prev => ({ ...prev, tax: v ?? 0 }))} />
        )
        const line = record as EditableSvcLine
        return (
          <InputNumber size="small" min={0} precision={2} prefix="$"
            value={line.tax} style={{ width: '100%' }}
            onChange={v => setEditedLines(prev =>
              prev.map(l => l.id === line.id ? { ...l, tax: v ?? 0 } : l))}
            onBlur={() => triggerRecalc()} />
        )
      },
    },
    {
      title: 'Total', key: 'lineTotal', width: 90,
      render: (_: unknown, record: DisplayLine) => {
        if (record.id === NEW_LINE_ID) return fmt(newLine.servicePrice + newLine.tax)
        const line = record as EditableSvcLine
        return fmt(line.servicePrice + line.tax)
      },
    },
    {
      title: '', key: 'actions', width: 110,
      render: (_: unknown, record: DisplayLine) => {
        if (record.id === NEW_LINE_ID) return (
          <Space size={4}>
            <Button size="small" type="primary" loading={savingNew}
              disabled={!newLine.serviceDesc.trim()} onClick={handleSaveNew}>
              Save
            </Button>
            <Button size="small" onClick={() => setAdding(false)}>Cancel</Button>
          </Space>
        )
        const line = record as EditableSvcLine
        return (
          <Popconfirm title="Remove this line?" okText="Remove" okButtonProps={{ danger: true }}
            onConfirm={() => handleDeleteLine(line.id)}>
            <Button size="small" icon={<DeleteOutlined />} danger loading={deletingId === line.id} />
          </Popconfirm>
        )
      },
    },
  ]

  const commColumns = [
    { title: 'Employee', dataIndex: 'employeeName', key: 'employeeName' },
    { title: 'Type', dataIndex: 'commissionType', key: 'commissionType', width: 60 },
    { title: 'Service', dataIndex: 'serviceTypeName', key: 'serviceTypeName' },
    {
      title: 'Amount', key: 'commissionAmount', width: 120, align: 'right' as const,
      render: (_: unknown, item: CommissionPreviewItem, idx: number) => (
        <InputNumber size="small" value={item.commissionAmount} min={0} precision={2}
          prefix="$" style={{ width: 110 }}
          onChange={v => setCommPreview(prev =>
            prev.map((p, i) => i === idx ? { ...p, commissionAmount: v ?? 0 } : p))} />
      ),
    },
    {
      title: '', key: 'flags', width: 60,
      render: (_: unknown, item: CommissionPreviewItem) =>
        item.isFirstCommission ? <Tag color="purple">1st</Tag> : null,
    },
  ]

  if (!invoice) return null

  return (
    <Modal
      title={`Invoice #${invoice.invoiceNumber} — ${invoice.companyName}`}
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      okText="Save"
      confirmLoading={saving}
      width={900}
      destroyOnClose
    >
      {/* Row 1: Header controls */}
      <Space wrap align="center" style={{ marginBottom: 16 }}>
        <Text strong>Service Date:</Text>
        <DatePicker
          value={serviceDate}
          format="MM/DD/YYYY"
          onChange={date => {
            setServiceDate(date)
            triggerRecalc(date)
          }}
        />
        <Text strong>Technician:</Text>
        <Select
          style={{ width: 190 }}
          placeholder="None"
          allowClear
          value={sacEmployeeId ?? undefined}
          onChange={v => {
            const val = v ?? null
            setSacEmployeeId(val)
            triggerRecalc(serviceDate, val)
          }}
          options={empOptions}
        />
        <Text strong>Sales Person:</Text>
        <Select
          style={{ width: 190 }}
          placeholder="None"
          allowClear
          value={amcEmployeeId ?? undefined}
          onChange={v => {
            const val = v ?? null
            setAmcEmployeeId(val)
            triggerRecalc(serviceDate, sacEmployeeId, val)
          }}
          options={empOptions}
        />
        <Checkbox
          checked={includeAmc}
          onChange={e => {
            setIncludeAmc(e.target.checked)
            triggerRecalc(serviceDate, sacEmployeeId, amcEmployeeId, e.target.checked)
          }}
        >
          Include AMC
        </Checkbox>
      </Space>

      {/* Row 2: Service lines */}
      <Table<DisplayLine>
        dataSource={displayLines}
        columns={svcColumns}
        rowKey="id"
        size="small"
        pagination={false}
        loading={linesLoading}
        locale={{ emptyText: 'No service lines' }}
        summary={() =>
          editedLines.length > 0 ? (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4}>
                <Text strong>Total</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={4}>
                <Text strong>{fmt(lineTotal)}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={5} />
            </Table.Summary.Row>
          ) : null
        }
      />

      {/* Row 3: Add line */}
      <Space style={{ marginTop: 8, marginBottom: 8 }}>
        {!adding && (
          <Button type="dashed" icon={<PlusOutlined />} size="small" onClick={() => setAdding(true)}>
            Add Line
          </Button>
        )}
      </Space>

      <Divider style={{ margin: '8px 0' }} />

      {/* Row 4: Commission */}
      <Space style={{ marginBottom: 8 }}>
        <Text strong>Commission</Text>
        <Button size="small" loading={commPreviewing} onClick={() => triggerRecalc()}>
          Recalculate
        </Button>
      </Space>

      <Table<CommissionPreviewItem>
        dataSource={commPreview}
        columns={commColumns}
        rowKey={(_, i) => String(i)}
        size="small"
        pagination={false}
        loading={commPreviewing}
        locale={{ emptyText: 'No commission — service date or technician not set' }}
      />
    </Modal>
  )
}
