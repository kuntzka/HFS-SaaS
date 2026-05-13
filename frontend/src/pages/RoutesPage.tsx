import { useState, useEffect } from 'react'
import { Table, Select, Button, Typography, message } from 'antd'
import client from '../api/client'

const { Title } = Typography

interface RouteItem {
  routeId: number
  routeCode: string
  description: string | null
  employeeId: number | null
  employeeName: string | null
}

interface Employee {
  employeeId: number
  firstName: string
  lastName: string
  isActive: boolean
}

export default function RoutesPage() {
  const [routes, setRoutes] = useState<RouteItem[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<number | null>(null)
  const [pending, setPending] = useState<Record<number, number | null>>({})

  useEffect(() => {
    Promise.all([
      client.get<RouteItem[]>('/routes'),
      client.get<Employee[]>('/employees'),
    ])
      .then(([routesRes, empRes]) => {
        setRoutes(routesRes.data)
        setEmployees(empRes.data.filter((e: Employee) => e.isActive))
        const init: Record<number, number | null> = {}
        routesRes.data.forEach((r: RouteItem) => { init[r.routeId] = r.employeeId })
        setPending(init)
      })
      .catch(() => message.error('Failed to load routes'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave(routeId: number) {
    setSaving(routeId)
    try {
      await client.put(`/routes/${routeId}`, { employeeId: pending[routeId] ?? null })
      message.success('Route saved')
      setRoutes(prev =>
        prev.map(r => r.routeId === routeId ? { ...r, employeeId: pending[routeId] ?? null } : r)
      )
    } catch {
      message.error('Failed to save route')
    } finally {
      setSaving(null)
    }
  }

  const columns = [
    { title: 'Route', dataIndex: 'routeCode', key: 'routeCode', width: 120 },
    {
      title: 'Description', dataIndex: 'description', key: 'description',
      render: (v: string | null) => v ?? '—',
    },
    {
      title: 'Default Technician',
      key: 'technician',
      render: (_: unknown, record: RouteItem) => (
        <Select
          style={{ width: 220 }}
          allowClear
          placeholder="None"
          value={pending[record.routeId] ?? undefined}
          onChange={v => setPending(prev => ({ ...prev, [record.routeId]: v ?? null }))}
          options={employees.map(e => ({
            value: e.employeeId,
            label: `${e.lastName}, ${e.firstName}`,
          }))}
        />
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_: unknown, record: RouteItem) => (
        <Button
          size="small"
          type="primary"
          loading={saving === record.routeId}
          onClick={() => handleSave(record.routeId)}
        >
          Save
        </Button>
      ),
    },
  ]

  return (
    <>
      <Title level={4} style={{ marginTop: 0 }}>Routes</Title>
      <Table
        dataSource={routes}
        columns={columns}
        rowKey="routeId"
        loading={loading}
        size="small"
        pagination={false}
      />
    </>
  )
}
