import { useState, useEffect } from 'react'
import { Table, Button, DatePicker, Space, Popconfirm, Alert, message } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import client from '../api/client'

interface Period {
  id: number
  startDate: string
  endDate: string | null
}

const NEW_ID = 0 as const
type EditingRow = { id: number | typeof NEW_ID; start: Dayjs | null; end: Dayjs | null }

export function EmployeePeriodTable({ employeeId }: { employeeId: number }) {
  const [periods, setPeriods] = useState<Period[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<EditingRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [overlapError, setOverlapError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)

  useEffect(() => {
    client.get(`/employees/${employeeId}/periods`)
      .then(r => setPeriods(r.data))
      .catch(() => message.error('Failed to load periods'))
      .finally(() => setLoading(false))
  }, [employeeId])

  function startAdd() {
    setEditing({ id: NEW_ID, start: null, end: null })
    setOverlapError(null)
  }

  function startEdit(p: Period) {
    setEditing({ id: p.id, start: dayjs(p.startDate), end: p.endDate ? dayjs(p.endDate) : null })
    setOverlapError(null)
  }

  function cancelEdit() {
    setEditing(null)
    setOverlapError(null)
  }

  async function handleSave() {
    if (!editing || !editing.start) return
    const body = {
      startDate: editing.start.format('YYYY-MM-DD'),
      endDate: editing.end ? editing.end.format('YYYY-MM-DD') : null,
    }
    setSaving(true)
    setOverlapError(null)
    try {
      if (editing.id === NEW_ID) {
        const res = await client.post(`/employees/${employeeId}/periods`, body)
        const newPeriod: Period = { id: res.data.id, startDate: body.startDate, endDate: body.endDate }
        setPeriods(prev => [newPeriod, ...prev])
      } else {
        await client.put(`/employees/${employeeId}/periods/${editing.id}`, body)
        setPeriods(prev => prev.map(p => p.id === editing.id
          ? { ...p, startDate: body.startDate, endDate: body.endDate }
          : p))
      }
      setEditing(null)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      if (msg) setOverlapError(msg)
      else message.error('Failed to save period')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(periodId: number) {
    setDeleting(periodId)
    try {
      await client.delete(`/employees/${employeeId}/periods/${periodId}`)
      setPeriods(prev => prev.filter(p => p.id !== periodId))
    } catch {
      message.error('Failed to delete period')
    } finally {
      setDeleting(null)
    }
  }

  type DisplayRow = Period | { id: 0 }

  const columns = [
    {
      title: 'Start',
      key: 'start',
      render: (_: unknown, row: DisplayRow) => {
        if (row.id === NEW_ID && editing?.id === NEW_ID) {
          return <DatePicker value={editing.start} onChange={v => setEditing(e => e ? { ...e, start: v } : null)} size="small" />
        }
        if (row.id !== NEW_ID && editing?.id === row.id) {
          return <DatePicker value={editing.start} onChange={v => setEditing(e => e ? { ...e, start: v } : null)} size="small" />
        }
        return 'startDate' in row ? row.startDate : null
      },
    },
    {
      title: 'End',
      key: 'end',
      render: (_: unknown, row: DisplayRow) => {
        const isEditing = editing && editing.id === row.id
        if (isEditing) {
          return (
            <Space direction="vertical" size={4}>
              <DatePicker
                value={editing.end}
                onChange={v => setEditing(e => e ? { ...e, end: v } : null)}
                allowClear
                size="small"
              />
              {overlapError && <Alert type="error" message={overlapError} banner style={{ fontSize: 12 }} />}
            </Space>
          )
        }
        if ('endDate' in row) return row.endDate ?? 'Present'
        return null
      },
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_: unknown, row: DisplayRow) => {
        const isEditing = editing && editing.id === row.id
        if (isEditing) {
          return (
            <Space size={4}>
              <Button icon={<SaveOutlined />} size="small" type="primary" loading={saving} onClick={handleSave} />
              <Button icon={<CloseOutlined />} size="small" onClick={cancelEdit} />
            </Space>
          )
        }
        if (row.id === NEW_ID) return null
        const period = row as Period
        return (
          <Space size={4}>
            <Button icon={<EditOutlined />} size="small" onClick={() => startEdit(period)} disabled={!!editing} />
            <Popconfirm title="Delete this period?" okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => handleDelete(period.id)}>
              <Button icon={<DeleteOutlined />} size="small" danger loading={deleting === period.id} disabled={!!editing} />
            </Popconfirm>
          </Space>
        )
      },
    },
  ]

  const dataSource: DisplayRow[] = editing?.id === NEW_ID
    ? [{ id: NEW_ID }, ...periods]
    : periods

  return (
    <div style={{ margin: '0 0 12px 48px' }}>
      <Table<DisplayRow>
        dataSource={dataSource}
        columns={columns}
        rowKey="id"
        size="small"
        pagination={false}
        loading={loading}
      />
      <Button
        icon={<PlusOutlined />}
        size="small"
        style={{ marginTop: 8 }}
        onClick={startAdd}
        disabled={!!editing}
      >
        Add Period
      </Button>
    </div>
  )
}
