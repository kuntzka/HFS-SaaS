import { useParams, useNavigate } from 'react-router-dom'
import { Tabs, Button, Typography, Skeleton } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { useCustomer } from '../hooks/useCustomers'

const { Title } = Typography

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: customer, isLoading } = useCustomer(Number(id))

  if (isLoading) return <Skeleton active />

  return (
    <>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/customers')} style={{ marginBottom: 16 }}>
        Back
      </Button>
      <Title level={4} style={{ marginTop: 0 }}>
        {customer?.companyName ?? `Customer #${id}`}
      </Title>
      <Tabs
        items={[
          { key: 'services',   label: 'Services',   children: <div>Services — Phase 2</div> },
          { key: 'inventory',  label: 'Inventory',  children: <div>Inventory — Phase 2</div> },
          { key: 'invoices',   label: 'Invoices',   children: <div>Invoices — Phase 4</div> },
          { key: 'commission', label: 'Commission', children: <div>Commission — Phase 5</div> },
        ]}
      />
    </>
  )
}
