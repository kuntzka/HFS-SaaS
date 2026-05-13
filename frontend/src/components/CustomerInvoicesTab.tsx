import { useState } from 'react'
import { Table, Tag, DatePicker, Space } from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { useQuery } from '@tanstack/react-query'
import client from '../api/client'
import { InvoiceDrawer } from './InvoiceDrawer'

const { RangePicker } = DatePicker

export interface CustomerInvoiceSummary {
  invoiceNumber: number
  invoiceDate: string
  serviceDate: string | null
  serviceQty: number
  servicePrice: number
  tax: number
  isComplete: boolean
  completeDate: string | null
}

interface Props {
  customerId: number
}

const startOfYear = dayjs().startOf('year')

export function CustomerInvoicesTab({ customerId }: Props) {
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(90, 'day'),
    dayjs(),
  ])

  const from = dateRange[0].format('YYYY-MM-DD')
  const to   = dateRange[1].format('YYYY-MM-DD')

  const [selectedInvoice, setSelectedInvoice] = useState<CustomerInvoiceSummary | null>(null)

  const { data = [], isLoading } = useQuery<CustomerInvoiceSummary[]>({
    queryKey: ['customer-invoices', customerId, from, to],
    queryFn: () =>
      client
        .get(`/customers/${customerId}/invoices`, { params: { from, to } })
        .then(r => r.data),
  })

  const columns = [
    {
      title: 'Invoice #',
      dataIndex: 'invoiceNumber',
      key: 'invoiceNumber',
      sorter: (a: CustomerInvoiceSummary, b: CustomerInvoiceSummary) =>
        a.invoiceNumber - b.invoiceNumber,
      width: 110,
    },
    {
      title: 'Invoice Date',
      dataIndex: 'invoiceDate',
      key: 'invoiceDate',
      width: 125,
      render: (v: string) => dayjs(v).format('MM/DD/YYYY'),
    },
    {
      title: 'Service Date',
      dataIndex: 'serviceDate',
      key: 'serviceDate',
      width: 125,
      render: (v: string | null) => v ? dayjs(v).format('MM/DD/YYYY') : '—',
    },
    {
      title: 'Qty',
      dataIndex: 'serviceQty',
      key: 'serviceQty',
      width: 60,
    },
    {
      title: 'Total',
      key: 'total',
      width: 100,
      render: (_: unknown, record: CustomerInvoiceSummary) =>
        `$${(record.servicePrice + record.tax).toFixed(2)}`,
    },
    {
      title: 'Status',
      key: 'status',
      width: 100,
      render: (_: unknown, record: CustomerInvoiceSummary) =>
        record.isComplete
          ? <Tag color="green">Complete</Tag>
          : <Tag>Pending</Tag>,
    },
  ]

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <RangePicker
          value={dateRange}
          onChange={(range) => {
            if (range?.[0] && range?.[1]) {
              setDateRange([range[0], range[1]])
            }
          }}
          disabledDate={(current) => current.isBefore(startOfYear, 'day')}
          format="MM/DD/YYYY"
        />
      </Space>

      <Table<CustomerInvoiceSummary>
        dataSource={data}
        columns={columns}
        rowKey="invoiceNumber"
        loading={isLoading}
        size="small"
        pagination={false}
        onRow={(record) => ({
          onClick: () => setSelectedInvoice(record),
          style: { cursor: 'pointer' },
        })}
        locale={{ emptyText: 'No invoices in selected date range' }}
      />

      <InvoiceDrawer invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />
    </>
  )
}
