import { useState, useEffect, useMemo } from 'react'
import { Table, Select, Button, Space, Typography, Tag } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table/interface'
import dayjs from 'dayjs'
import client from '../api/client'

const { Text } = Typography

const HIGHLIGHT_COLORS = [
  '#fff3cd',
  '#cce5ff',
  '#d4edda',
  '#f8d7da',
  '#e2d9f3',
  '#d1ecf1',
  '#ffddd0',
  '#e8f5e9',
]

interface ScheduleRow {
  scheduleId: number
  customerSvcId: number
  serviceTypeName: string
  weekNumber: number
  scheduledDate: string
  comments: string | null
}

interface Props {
  customerId: number
}

export function CustomerScheduleTab({ customerId }: Props) {
  const [year, setYear] = useState(dayjs().year())
  const [rows, setRows] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedServices, setSelectedServices] = useState<string[]>([])

  useEffect(() => {
    setLoading(true)
    client
      .get<ScheduleRow[]>(`/customers/${customerId}/schedule`, { params: { year } })
      .then(r => setRows(r.data))
      .finally(() => setLoading(false))
  }, [customerId, year])

  const serviceOptions = useMemo(() => {
    const names = Array.from(new Set(rows.map(r => r.serviceTypeName))).sort()
    return names.map(n => ({ value: n, label: n }))
  }, [rows])

  // Remove any selected services that no longer exist in the new year's data
  useEffect(() => {
    const names = new Set(rows.map(r => r.serviceTypeName))
    setSelectedServices(prev => prev.filter(s => names.has(s)))
  }, [rows])

  const colorMap: Record<string, string> = {}
  selectedServices.forEach((s, i) => {
    colorMap[s] = HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length]
  })

  const columns: ColumnsType<ScheduleRow> = [
    {
      title: 'Service',
      dataIndex: 'serviceTypeName',
      key: 'serviceTypeName',
      defaultSortOrder: 'ascend',
      sorter: (a, b) => a.serviceTypeName.localeCompare(b.serviceTypeName),
    },
    {
      title: 'Week',
      dataIndex: 'weekNumber',
      key: 'weekNumber',
      width: 70,
      sorter: (a, b) => a.weekNumber - b.weekNumber,
    },
    {
      title: 'Date',
      dataIndex: 'scheduledDate',
      key: 'scheduledDate',
      width: 110,
      sorter: (a, b) => a.scheduledDate.localeCompare(b.scheduledDate),
      render: (v: string) => dayjs(v).format('MM/DD/YYYY'),
    },
    {
      title: 'Comments',
      dataIndex: 'comments',
      key: 'comments',
      render: (v: string | null) => v ?? '—',
    },
  ]

  return (
    <div>
      {/* Year navigation */}
      <Space style={{ marginBottom: 12 }}>
        <Button size="small" icon={<LeftOutlined />} onClick={() => setYear(y => y - 1)} />
        <Text strong style={{ minWidth: 40, textAlign: 'center', display: 'inline-block' }}>
          {year}
        </Text>
        <Button size="small" icon={<RightOutlined />} onClick={() => setYear(y => y + 1)} />
      </Space>

      {/* Service highlight selector */}
      <Select
        mode="multiple"
        placeholder="Highlight services…"
        style={{ width: '100%', marginBottom: 12 }}
        options={serviceOptions}
        value={selectedServices}
        onChange={setSelectedServices}
        tagRender={({ label, value, closable, onClose }) => {
          const color = colorMap[value as string]
          return (
            <Tag
              color={color}
              style={{ color: '#333', marginRight: 4 }}
              closable={closable}
              onClose={onClose}
            >
              {label}
            </Tag>
          )
        }}
        allowClear
      />

      <Table<ScheduleRow>
        dataSource={rows}
        columns={columns}
        rowKey="scheduleId"
        size="small"
        loading={loading}
        pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: ['25', '50', '100'] }}
        locale={{ emptyText: loading ? 'Loading…' : 'No schedule entries for this year' }}
        onRow={record => ({
          style: colorMap[record.serviceTypeName]
            ? { backgroundColor: colorMap[record.serviceTypeName] }
            : {},
        })}
      />
    </div>
  )
}
