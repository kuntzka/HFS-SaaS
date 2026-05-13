import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Tabs, Button, Typography, Skeleton, Descriptions, Table, Tag,
  Modal, Form, Select, InputNumber, DatePicker, Checkbox, Input,
  Space, Popconfirm, message,
} from 'antd'
import { ArrowLeftOutlined, PlusOutlined, EditOutlined, DeleteOutlined, StopOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import { useCustomer, useCustomerServices, CustomerServiceDetail } from '../hooks/useCustomers'
import { useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import { CustomerFormModal } from '../components/CustomerFormModal'
import { ServiceInventoryTable, SkuOption } from '../components/ServiceInventoryTable'
import { CustomerInvoicesTab } from '../components/CustomerInvoicesTab'

const { Title } = Typography

// ─── Reference-data types ────────────────────────────────────────────────────
interface ServiceType  { serviceTypeId: number; serviceName: string; isActive: boolean }
interface FrequencyCode { frequencyCode: string; description: string }
interface SalesTax     { salesTaxId: number; description: string; taxRate: number }

// ─── Form shape ──────────────────────────────────────────────────────────────
interface SvcFormValues {
  serviceTypeId: number
  frequencyCode: string
  servicePrice: number
  serviceQty: number
  startWeek: number
  firstServiceDate: Dayjs | null
  lastServiceDate: Dayjs | null
  salesTaxId: number | null
  commissionPaid: boolean
  comments: string | null
  isActive: boolean
}

// ─── ServicesTab ─────────────────────────────────────────────────────────────
function ServicesTab({ customerId }: { customerId: number }) {
  const { data, isLoading } = useCustomerServices(customerId)
  const queryClient = useQueryClient()

  const [modalOpen, setModalOpen]   = useState(false)
  const [editing, setEditing]       = useState<CustomerServiceDetail | null>(null)
  const [saving, setSaving]         = useState(false)
  const [deleting, setDeleting]     = useState<number | null>(null)

  const [serviceTypes, setServiceTypes]   = useState<ServiceType[]>([])
  const [frequencyCodes, setFrequencyCodes] = useState<FrequencyCode[]>([])
  const [taxRates, setTaxRates]           = useState<SalesTax[]>([])
  const [refLoaded, setRefLoaded]         = useState(false)

  const [skus, setSkus]             = useState<SkuOption[]>([])
  const [skusLoaded, setSkusLoaded] = useState(false)

  const [form] = Form.useForm<SvcFormValues>()

  async function loadRefData() {
    if (refLoaded) return
    const [st, fc, tr] = await Promise.all([
      client.get('/service-types').then(r => r.data),
      client.get('/frequency-codes').then(r => r.data),
      client.get('/tax-rates').then(r => r.data),
    ])
    setServiceTypes(st)
    setFrequencyCodes(fc)
    setTaxRates(tr)
    setRefLoaded(true)
  }

  async function openAdd() {
    await loadRefData()
    setEditing(null)
    form.setFieldsValue({
      serviceTypeId: undefined,
      frequencyCode: undefined,
      servicePrice: 0,
      serviceQty: 1,
      startWeek: 1,
      firstServiceDate: null,
      lastServiceDate: null,
      salesTaxId: null,
      commissionPaid: false,
      comments: null,
      isActive: true,
    })
    setModalOpen(true)
  }

  async function openEdit(svc: CustomerServiceDetail) {
    await loadRefData()
    setEditing(svc)
    form.setFieldsValue({
      serviceTypeId: svc.serviceTypeId,
      frequencyCode: svc.frequencyCode,
      servicePrice: svc.servicePrice,
      serviceQty: svc.serviceQty,
      startWeek: svc.startWeek,
      firstServiceDate: svc.firstServiceDate ? dayjs(svc.firstServiceDate) : null,
      lastServiceDate:  svc.lastServiceDate  ? dayjs(svc.lastServiceDate)  : null,
      salesTaxId: svc.salesTaxId ?? null,
      commissionPaid: svc.commissionPaid,
      comments: svc.comments ?? null,
      isActive: svc.isActive,
    })
    setModalOpen(true)
  }

  async function handleSave() {
    let values: SvcFormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    const body = {
      serviceTypeId:    values.serviceTypeId,
      frequencyCode:    values.frequencyCode,
      servicePrice:     values.servicePrice,
      serviceQty:       values.serviceQty,
      startWeek:        values.startWeek,
      firstServiceDate: values.firstServiceDate ? values.firstServiceDate.format('YYYY-MM-DD') : null,
      lastServiceDate:  values.lastServiceDate  ? values.lastServiceDate.format('YYYY-MM-DD')  : null,
      salesTaxId:       values.salesTaxId ?? null,
      commissionPaid:   values.commissionPaid,
      comments:         values.comments || null,
      isActive:         values.isActive,
    }

    setSaving(true)
    try {
      if (editing) {
        await client.put(`/customers/${customerId}/services/${editing.customerSvcId}`, body)
        message.success('Service updated')
      } else {
        await client.post(`/customers/${customerId}/services`, body)
        message.success('Service added')
      }
      setModalOpen(false)
      queryClient.invalidateQueries({ queryKey: ['customer-services', customerId] })
    } catch {
      message.error('Failed to save service')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(svcId: number) {
    setDeleting(svcId)
    try {
      await client.delete(`/customers/${customerId}/services/${svcId}`)
      message.success('Service removed')
      queryClient.invalidateQueries({ queryKey: ['customer-services', customerId] })
    } catch {
      message.error('Failed to delete service')
    } finally {
      setDeleting(null)
    }
  }

  async function handleExpand(expanded: boolean) {
    if (expanded && !skusLoaded) {
      try {
        const data = await client.get('/inventory').then(r => r.data)
        setSkus(data.map((item: { sku: string; description: string }) => ({
          sku: item.sku,
          description: item.description,
        })))
        setSkusLoaded(true)
      } catch {
        message.error('Failed to load SKU list')
      }
    }
  }

  const columns = [
    { title: 'Service',    dataIndex: 'serviceName',          key: 'serviceName' },
    { title: 'Frequency',  dataIndex: 'frequencyDescription', key: 'frequencyDescription', width: 130 },
    { title: 'Price',      dataIndex: 'servicePrice',         key: 'servicePrice',  width: 90,
      render: (v: number) => `$${v.toFixed(2)}` },
    { title: 'Qty',        dataIndex: 'serviceQty',           key: 'serviceQty',    width: 55 },
    { title: 'Start Wk',  dataIndex: 'startWeek',            key: 'startWeek',     width: 85 },
    { title: 'Tax',        dataIndex: 'taxDescription',       key: 'taxDescription', width: 120,
      render: (v: string | null) => v ?? '—' },
    { title: 'Active',     dataIndex: 'isActive',             key: 'isActive',      width: 75,
      render: (v: boolean) => v ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag> },
    {
      title: '',
      key: 'actions',
      width: 90,
      render: (_: unknown, row: CustomerServiceDetail) => (
        <Space size={4}>
          <Button
            icon={<EditOutlined />}
            size="small"
            onClick={() => openEdit(row)}
          />
          <Popconfirm
            title="Remove this service?"
            okText="Remove"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(row.customerSvcId)}
          >
            <Button
              icon={<DeleteOutlined />}
              size="small"
              danger
              loading={deleting === row.customerSvcId}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <>
      <div style={{ marginBottom: 12, textAlign: 'right' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
          Add Service
        </Button>
      </div>

      <Table
        dataSource={data ?? []}
        columns={columns}
        rowKey="customerSvcId"
        loading={isLoading}
        size="small"
        pagination={false}
        expandable={{
          expandedRowRender: (record) => (
            <ServiceInventoryTable
              customerId={customerId}
              customerSvcId={record.customerSvcId}
              skus={skus}
            />
          ),
          onExpand: handleExpand,
        }}
      />

      <Modal
        title={editing ? 'Edit Service' : 'Add Service'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        okText={editing ? 'Save' : 'Add'}
        confirmLoading={saving}
        width={620}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          {/* Row 1: Service Type + Frequency */}
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="serviceTypeId" label="Service Type" style={{ flex: 2 }}
              rules={[{ required: true, message: 'Required' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Select service type"
                options={serviceTypes
                  .filter(s => s.isActive || (editing && editing.serviceTypeId === s.serviceTypeId))
                  .map(s => ({ value: s.serviceTypeId, label: s.serviceName }))}
              />
            </Form.Item>
            <Form.Item name="frequencyCode" label="Frequency" style={{ flex: 1 }}
              rules={[{ required: true, message: 'Required' }]}>
              <Select
                placeholder="Frequency"
                options={frequencyCodes.map(f => ({ value: f.frequencyCode, label: f.description }))}
              />
            </Form.Item>
          </div>

          {/* Row 2: Price + Qty + Start Week + Tax */}
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="servicePrice" label="Price" style={{ width: 110 }}
              rules={[{ required: true, message: 'Required' }]}>
              <InputNumber prefix="$" min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="serviceQty" label="Qty" style={{ width: 70 }}
              rules={[{ required: true, message: 'Required' }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="startWeek" label="Start Week" style={{ width: 100 }}
              rules={[{ required: true, message: 'Required' }]}>
              <InputNumber min={1} max={53} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="salesTaxId" label="Tax Rate" style={{ width: 155 }}>
              <Select
                allowClear
                placeholder="No tax"
                options={taxRates.map(t => ({
                  value: t.salesTaxId,
                  label: `${t.description} (${(t.taxRate * 100).toFixed(2)}%)`,
                }))}
              />
            </Form.Item>
          </div>

          {/* Row 3: First Date + Last Date + Commission Paid + Active */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <Form.Item name="firstServiceDate" label="First Service Date" style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="lastServiceDate" label="Last Service Date" style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <div style={{ display: 'flex', gap: 16, paddingBottom: 24 }}>
              <Form.Item name="commissionPaid" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Checkbox>Commission Paid</Checkbox>
              </Form.Item>
              <Form.Item name="isActive" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Checkbox>Active</Checkbox>
              </Form.Item>
            </div>
          </div>

          <Form.Item name="comments" label="Comments" style={{ marginBottom: 0 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

// ─── CustomerDetailPage ───────────────────────────────────────────────────────
export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const customerId = Number(id)
  const { data: customer, isLoading } = useCustomer(customerId)
  const queryClient = useQueryClient()
  const [modalOpen, setModalOpen]       = useState(false)
  const [deactivating, setDeactivating] = useState(false)

  async function handleDeactivate() {
    setDeactivating(true)
    try {
      await client.delete(`/customers/${customerId}`)
      message.success('Customer deactivated')
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      navigate('/customers')
    } catch {
      message.error('Failed to deactivate customer')
      setDeactivating(false)
    }
  }

  function handleSaved() {
    queryClient.invalidateQueries({ queryKey: ['customer', customerId] })
    queryClient.invalidateQueries({ queryKey: ['customers'] })
  }

  if (isLoading) return <Skeleton active />

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/customers')}>
          Back
        </Button>
        <Button icon={<EditOutlined />} onClick={() => setModalOpen(true)}>
          Edit
        </Button>
        <Popconfirm
          title="Deactivate this customer? They will no longer appear in the active customers list."
          okText="Deactivate"
          okButtonProps={{ danger: true }}
          onConfirm={handleDeactivate}
        >
          <Button icon={<StopOutlined />} danger loading={deactivating}>
            Deactivate
          </Button>
        </Popconfirm>
      </Space>
      <Title level={4} style={{ marginTop: 0 }}>
        {customer?.companyName ?? `Customer #${id}`}
      </Title>
      <Tabs
        items={[
          {
            key: 'info',
            label: 'Info',
            children: customer ? (
              <Descriptions bordered size="small" column={2}>
                <Descriptions.Item label="Company">{customer.companyName}</Descriptions.Item>
                <Descriptions.Item label="Phone">{customer.phone ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="Address">
                  {[customer.address1, customer.city, customer.stateCode, customer.zip].filter(Boolean).join(', ') || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="Route">{customer.routeCode ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="Pay Type">{customer.payTypeName ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="Employee">{customer.employeeName ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="Call First">{customer.callFirst ? 'Yes' : 'No'}</Descriptions.Item>
                <Descriptions.Item label="Consolidated Billing">{customer.isConsolidatedBilling ? 'Yes' : 'No'}</Descriptions.Item>
              </Descriptions>
            ) : null,
          },
          {
            key: 'services',
            label: 'Services',
            children: <ServicesTab customerId={customerId} />,
          },
          {
            key: 'invoices',
            label: 'Invoices',
            children: <CustomerInvoicesTab customerId={customerId} />,
          },
          { key: 'commission', label: 'Commission', children: <div>Commission — Phase 5</div> },
        ]}
      />
      <CustomerFormModal
        open={modalOpen}
        customerId={customerId}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
      />
    </>
  )
}
