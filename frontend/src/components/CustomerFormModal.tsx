import { useState, useEffect } from 'react'
import {
  Modal, Form, Input, InputNumber, Select, Checkbox, message, Row, Col,
} from 'antd'
import { useQuery } from '@tanstack/react-query'
import client from '../api/client'
import type { CustomerDetail } from '../hooks/useCustomers'

interface RouteOption      { routeId: number; routeCode: string }
interface PayTypeOption    { payTypeId: number; payTypeName: string }
interface EmployeeOption   { employeeId: number; firstName: string; lastName: string; isActive: boolean }
interface OffsetCodeOption { offsetCodeId: number; offsetCode: string }

interface FormValues {
  companyName: string
  address1: string | null
  address2: string | null
  city: string | null
  stateCode: string | null
  zip: string | null
  billingAddress1: string | null
  billingAddress2: string | null
  billingCity: string | null
  billingStateCode: string | null
  billingZip: string | null
  phone: string | null
  payTypeId: number | null
  routeId: number | null
  employeeId: number | null
  offsetCodeId: number | null
  arOffset: number
  distance: number | null
  customerType: number
  callFirst: boolean
  isTest: boolean
  isConsolidatedBilling: boolean
  isActive: boolean
}

interface Props {
  open: boolean
  customerId?: number
  onClose: () => void
  onSaved: () => void
}

export function CustomerFormModal({ open, customerId, onClose, onSaved }: Props) {
  const [form] = Form.useForm<FormValues>()
  const [saving, setSaving] = useState(false)

  const [routes, setRoutes]           = useState<RouteOption[]>([])
  const [payTypes, setPayTypes]       = useState<PayTypeOption[]>([])
  const [employees, setEmployees]     = useState<EmployeeOption[]>([])
  const [offsetCodes, setOffsetCodes] = useState<OffsetCodeOption[]>([])
  const [refLoaded, setRefLoaded]     = useState(false)

  const { data: customer } = useQuery<CustomerDetail>({
    queryKey: ['customer', customerId],
    queryFn: () => client.get(`/customers/${customerId}`).then(r => r.data),
    enabled: !!customerId,
  })

  // Load reference data once on first open
  useEffect(() => {
    if (!open || refLoaded) return
    Promise.all([
      client.get('/routes').then(r => r.data),
      client.get('/pay-types').then(r => r.data),
      client.get('/employees').then(r => r.data),
      client.get('/offset-codes').then(r => r.data),
    ]).then(([r, p, e, o]) => {
      setRoutes(r)
      setPayTypes(p)
      setEmployees((e as EmployeeOption[]).filter(emp => emp.isActive))
      setOffsetCodes(o)
      setRefLoaded(true)
    }).catch(() => message.error('Failed to load form data'))
  }, [open, refLoaded])

  // Pre-fill form when editing
  useEffect(() => {
    if (!open) return
    if (customerId && !customer) return  // query not yet resolved — effect re-fires when customer arrives
    if (customerId && customer) {
      form.setFieldsValue({
        companyName:        customer.companyName,
        address1:           customer.address1,
        address2:           customer.address2,
        city:               customer.city,
        stateCode:          customer.stateCode,
        zip:                customer.zip,
        billingAddress1:    customer.billingAddress1,
        billingAddress2:    customer.billingAddress2,
        billingCity:        customer.billingCity,
        billingStateCode:   customer.billingStateCode,
        billingZip:         customer.billingZip,
        phone:              customer.phone,
        payTypeId:          customer.payTypeId,
        routeId:            customer.routeId,
        employeeId:         customer.employeeId,
        offsetCodeId:       customer.offsetCodeId,
        arOffset:           customer.arOffset,
        distance:           customer.distance,
        customerType:       customer.customerType,
        callFirst:          customer.callFirst,
        isTest:             customer.isTest,
        isConsolidatedBilling: customer.isConsolidatedBilling,
        isActive:           customer.isActive,
      })
    } else if (!customerId) {
      form.resetFields()
    }
  }, [open, customer, customerId, form])

  async function handleSave() {
    let values: FormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSaving(true)
    try {
      if (customerId) {
        await client.put(`/customers/${customerId}`, values)
        message.success('Customer updated')
      } else {
        await client.post('/customers', values)
        message.success('Customer created')
      }
      onSaved()
      onClose()
    } catch {
      message.error('Failed to save customer')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={customerId ? 'Edit Customer' : 'New Customer'}
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      okText={customerId ? 'Save' : 'Create'}
      confirmLoading={saving}
      width={720}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        style={{ marginTop: 8 }}
        initialValues={{ arOffset: 0, customerType: 5, callFirst: false, isTest: false, isConsolidatedBilling: false, isActive: true }}
      >
        {/* Row 1: Company + Phone */}
        <Row gutter={12}>
          <Col span={16}>
            <Form.Item name="companyName" label="Company Name" rules={[{ required: true, message: 'Required' }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="phone" label="Phone">
              <Input />
            </Form.Item>
          </Col>
        </Row>

        {/* Row 2: Service Address */}
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="address1" label="Address 1">
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="address2" label="Address 2">
              <Input />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={10}>
            <Form.Item name="city" label="City">
              <Input />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="stateCode" label="State">
              <Input maxLength={2} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="zip" label="Zip">
              <Input />
            </Form.Item>
          </Col>
        </Row>

        {/* Row 3: Billing Address */}
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="billingAddress1" label="Billing Address 1">
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="billingAddress2" label="Billing Address 2">
              <Input />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={10}>
            <Form.Item name="billingCity" label="Billing City">
              <Input />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="billingStateCode" label="Billing State">
              <Input maxLength={2} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="billingZip" label="Billing Zip">
              <Input />
            </Form.Item>
          </Col>
        </Row>

        {/* Row 4: Route + Employee + Pay Type + Offset Code */}
        <Row gutter={12}>
          <Col span={6}>
            <Form.Item name="routeId" label="Route">
              <Select allowClear placeholder="None"
                options={routes.map(r => ({ value: r.routeId, label: r.routeCode }))} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="employeeId" label="Employee">
              <Select allowClear placeholder="None" showSearch optionFilterProp="label"
                options={employees.map(e => ({
                  value: e.employeeId,
                  label: `${e.firstName} ${e.lastName}`,
                }))} />
            </Form.Item>
          </Col>
          <Col span={5}>
            <Form.Item name="payTypeId" label="Pay Type">
              <Select allowClear placeholder="None"
                options={payTypes.map(p => ({ value: p.payTypeId, label: p.payTypeName }))} />
            </Form.Item>
          </Col>
          <Col span={5}>
            <Form.Item name="offsetCodeId" label="Offset Code">
              <Select allowClear placeholder="None"
                options={offsetCodes.map(o => ({ value: o.offsetCodeId, label: o.offsetCode }))} />
            </Form.Item>
          </Col>
        </Row>

        {/* Row 5: AR Offset + Distance + Customer Type */}
        <Row gutter={12}>
          <Col span={6}>
            <Form.Item name="arOffset" label="AR Offset" rules={[{ required: true, message: 'Required' }]}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="distance" label="Distance (mi)">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="customerType" label="Customer Type" rules={[{ required: true, message: 'Required' }]}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        {/* Row 6: Flags */}
        <Row gutter={24}>
          <Col><Form.Item name="callFirst" valuePropName="checked" style={{ marginBottom: 0 }}><Checkbox>Call First</Checkbox></Form.Item></Col>
          <Col><Form.Item name="isTest" valuePropName="checked" style={{ marginBottom: 0 }}><Checkbox>Test Account</Checkbox></Form.Item></Col>
          <Col><Form.Item name="isConsolidatedBilling" valuePropName="checked" style={{ marginBottom: 0 }}><Checkbox>Consolidated Billing</Checkbox></Form.Item></Col>
          <Col><Form.Item name="isActive" valuePropName="checked" style={{ marginBottom: 0 }}><Checkbox>Active</Checkbox></Form.Item></Col>
        </Row>
      </Form>
    </Modal>
  )
}
