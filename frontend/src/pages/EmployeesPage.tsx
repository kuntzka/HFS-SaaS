import { useState } from 'react'
import {
  Card, Table, Button, Modal, Form, Input, DatePicker,
  Tag, Space, Popconfirm, Tooltip, message,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { Dayjs } from 'dayjs'
import axios from 'axios'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import { EmployeePeriodTable } from '../components/EmployeePeriodTable'

interface Employee {
  employeeId: number
  firstName: string
  lastName: string
  isActive: boolean
  isInUse: boolean
}

interface AddFormValues { firstName: string; lastName: string; startDate: Dayjs }
interface EditFormValues { firstName: string; lastName: string }

export default function EmployeesPage() {
  const queryClient = useQueryClient()
  const { data: employees, isLoading } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: () => client.get('/employees').then(r => r.data),
  })

  const [addOpen, setAddOpen] = useState(false)
  const [addSaving, setAddSaving] = useState(false)
  const [addForm] = Form.useForm<AddFormValues>()

  const [editOpen, setEditOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Employee | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editForm] = Form.useForm<EditFormValues>()

  const [actioning, setActioning] = useState<number | null>(null)

  async function handleAdd() {
    let values: AddFormValues
    try { values = await addForm.validateFields() } catch { return }
    setAddSaving(true)
    try {
      await client.post('/employees', {
        firstName: values.firstName,
        lastName: values.lastName,
        firstPeriodStart: values.startDate.format('YYYY-MM-DD'),
      })
      message.success('Employee added')
      setAddOpen(false)
      addForm.resetFields()
      queryClient.invalidateQueries({ queryKey: ['employees'] })
    } catch {
      message.error('Failed to add employee')
    } finally {
      setAddSaving(false)
    }
  }

  function openEdit(emp: Employee) {
    setEditTarget(emp)
    editForm.setFieldsValue({ firstName: emp.firstName, lastName: emp.lastName })
    setEditOpen(true)
  }

  async function handleEdit() {
    if (!editTarget) return
    let values: EditFormValues
    try { values = await editForm.validateFields() } catch { return }
    setEditSaving(true)
    try {
      await client.put(`/employees/${editTarget.employeeId}`, values)
      message.success('Employee updated')
      setEditOpen(false)
      queryClient.invalidateQueries({ queryKey: ['employees'] })
    } catch {
      message.error('Failed to update employee')
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete(emp: Employee) {
    setActioning(emp.employeeId)
    try {
      await client.delete(`/employees/${emp.employeeId}`)
      message.success('Employee deleted')
      queryClient.invalidateQueries({ queryKey: ['employees'] })
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.message) {
        message.error(err.response.data.message as string)
      } else {
        message.error('Failed to delete employee')
      }
    } finally {
      setActioning(null)
    }
  }

  async function handleDeactivate(emp: Employee) {
    setActioning(emp.employeeId)
    try {
      await client.post(`/employees/${emp.employeeId}/deactivate`)
      message.success('Employee deactivated')
      queryClient.invalidateQueries({ queryKey: ['employees'] })
    } catch {
      message.error('Failed to deactivate employee')
    } finally {
      setActioning(null)
    }
  }

  const columns = [
    {
      title: 'Last Name',
      dataIndex: 'lastName',
      key: 'lastName',
      sorter: (a: Employee, b: Employee) => a.lastName.localeCompare(b.lastName),
    },
    { title: 'First Name', dataIndex: 'firstName', key: 'firstName' },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 100,
      render: (v: boolean) => v ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>,
    },
    {
      title: '',
      key: 'actions',
      width: 120,
      render: (_: unknown, emp: Employee) => (
        <Space size={4}>
          <Button icon={<EditOutlined />} size="small" onClick={() => openEdit(emp)} />
          {emp.isInUse ? (
            <Tooltip title="Has commission or customer records — delete not allowed">
              <Button
                size="small"
                loading={actioning === emp.employeeId}
                onClick={() => handleDeactivate(emp)}
              >
                Deactivate
              </Button>
            </Tooltip>
          ) : (
            <Popconfirm
              title="Delete this employee?"
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(emp)}
            >
              <Button
                icon={<DeleteOutlined />}
                size="small"
                danger
                loading={actioning === emp.employeeId}
              />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <>
      <Card
        title="Employees"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            Add Employee
          </Button>
        }
      >
        <Table
          dataSource={employees ?? []}
          columns={columns}
          rowKey="employeeId"
          loading={isLoading}
          size="small"
          pagination={false}
          expandable={{
            expandedRowRender: (record) => <EmployeePeriodTable employeeId={record.employeeId} />,
          }}
        />
      </Card>

      {/* Add Modal */}
      <Modal
        title="Add Employee"
        open={addOpen}
        onOk={handleAdd}
        onCancel={() => { setAddOpen(false); addForm.resetFields() }}
        okText="Add"
        confirmLoading={addSaving}
        destroyOnClose
      >
        <Form form={addForm} layout="vertical" style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="firstName" label="First Name" style={{ flex: 1 }}
              rules={[{ required: true, message: 'Required' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="lastName" label="Last Name" style={{ flex: 1 }}
              rules={[{ required: true, message: 'Required' }]}>
              <Input />
            </Form.Item>
          </div>
          <Form.Item name="startDate" label="Start Date"
            rules={[{ required: true, message: 'Required' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        title="Edit Employee"
        open={editOpen}
        onOk={handleEdit}
        onCancel={() => setEditOpen(false)}
        okText="Save"
        confirmLoading={editSaving}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="firstName" label="First Name" style={{ flex: 1 }}
              rules={[{ required: true, message: 'Required' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="lastName" label="Last Name" style={{ flex: 1 }}
              rules={[{ required: true, message: 'Required' }]}>
              <Input />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </>
  )
}
