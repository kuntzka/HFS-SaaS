import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Table, Input, Button, Space, Typography } from 'antd'
import { PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { useCustomers } from '../hooks/useCustomers'

const { Title } = Typography

export default function CustomersPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const { data, isLoading } = useCustomers(search)

  const columns = [
    { title: 'Account #',    dataIndex: 'customerId',   key: 'customerId',   width: 100 },
    { title: 'Company Name', dataIndex: 'companyName',  key: 'companyName',
      render: (name: string, record: { customerId: number }) => (
        <a onClick={() => navigate(`/customers/${record.customerId}`)}>{name}</a>
      ),
    },
    { title: 'Route',        dataIndex: 'routeCode',    key: 'routeCode',    width: 100 },
    { title: 'Pay Type',     dataIndex: 'payTypeName',  key: 'payTypeName',  width: 120 },
    { title: 'City',         dataIndex: 'city',         key: 'city' },
    { title: 'State',        dataIndex: 'state',        key: 'state',        width: 70 },
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
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/customers/new')}>
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
    </>
  )
}
