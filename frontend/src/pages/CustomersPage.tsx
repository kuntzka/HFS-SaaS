import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Table, Input, Button, Space, Typography, Tag, Popconfirm, message } from 'antd'
import { PlusOutlined, SearchOutlined, EditOutlined, StopOutlined } from '@ant-design/icons'
import { useCustomers, CustomerSummary } from '../hooks/useCustomers'
import { useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import { CustomerFormModal } from '../components/CustomerFormModal'

const { Title } = Typography

export default function CustomersPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const { data, isLoading } = useCustomers(search)

  const [modalOpen, setModalOpen]         = useState(false)
  const [editingId, setEditingId]         = useState<number | undefined>(undefined)
  const [deactivating, setDeactivating]   = useState<number | null>(null)

  function openCreate() {
    setEditingId(undefined)
    setModalOpen(true)
  }

  function openEdit(customerId: number) {
    setEditingId(customerId)
    setModalOpen(true)
  }

  function handleSaved() {
    queryClient.invalidateQueries({ queryKey: ['customers'] })
  }

  async function handleDeactivate(customerId: number) {
    setDeactivating(customerId)
    try {
      await client.delete(`/customers/${customerId}`)
      message.success('Customer deactivated')
      queryClient.invalidateQueries({ queryKey: ['customers'] })
    } catch {
      message.error('Failed to deactivate customer')
    } finally {
      setDeactivating(null)
    }
  }

  const columns = [
    { title: 'Account #',    dataIndex: 'customerId',  key: 'customerId',  width: 100 },
    {
      title: 'Company Name', dataIndex: 'companyName', key: 'companyName',
      render: (name: string, record: CustomerSummary) => (
        <a onClick={() => navigate(`/customers/${record.customerId}`)}>{name}</a>
      ),
    },
    { title: 'Route',    dataIndex: 'routeCode',   key: 'routeCode',   width: 100 },
    { title: 'Phone',    dataIndex: 'phone',       key: 'phone',       width: 140 },
    { title: 'Pay Type', dataIndex: 'payTypeName', key: 'payTypeName', width: 100 },
    {
      title: 'Active', dataIndex: 'isActive', key: 'isActive', width: 80,
      render: (v: boolean) => v ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>,
    },
    {
      title: '',
      key: 'actions',
      width: 90,
      render: (_: unknown, record: CustomerSummary) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEdit(record.customerId)}
          />
          <Popconfirm
            title="Deactivate this customer?"
            okText="Deactivate"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDeactivate(record.customerId)}
          >
            <Button
              size="small"
              icon={<StopOutlined />}
              danger
              loading={deactivating === record.customerId}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <>
      <Title level={4} style={{ marginTop: 0 }}>Customers</Title>
      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder="Search by name..."
          prefix={<SearchOutlined />}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 280 }}
          allowClear
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          New Customer
        </Button>
      </Space>
      <Table
        dataSource={data ?? []}
        columns={columns}
        rowKey="customerId"
        loading={isLoading}
        size="small"
        pagination={{ pageSize: 25, showSizeChanger: true }}
      />
      <CustomerFormModal
        open={modalOpen}
        customerId={editingId}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
      />
    </>
  )
}
