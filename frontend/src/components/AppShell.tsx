import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Button, Space, Typography } from 'antd'
import { LogoutOutlined, TeamOutlined, CalendarOutlined, FileTextOutlined,
         DollarOutlined, InboxOutlined, UserOutlined, BarChartOutlined, ExportOutlined, SettingOutlined, EnvironmentOutlined } from '@ant-design/icons'
import { useAuth } from '../context/AuthContext'

const { Sider, Content, Header } = Layout
const { Text } = Typography

const menuItems = [
  { key: '/customers',  icon: <TeamOutlined />,     label: 'Customers' },
  { key: '/schedule',   icon: <CalendarOutlined />,  label: 'Schedule' },
  { key: '/invoices',   icon: <FileTextOutlined />,  label: 'Invoices' },
  { key: '/commission', icon: <DollarOutlined />,    label: 'Commission' },
  { key: '/inventory',  icon: <InboxOutlined />,     label: 'Inventory' },
  { key: '/employees',  icon: <UserOutlined />,      label: 'Employees' },
  { key: '/routes',     icon: <EnvironmentOutlined />, label: 'Routes' },
  { key: '/reports',    icon: <BarChartOutlined />,  label: 'Reports' },
  { key: '/export',     icon: <ExportOutlined />,    label: 'Export' },
  { key: '/settings',   icon: <SettingOutlined />,   label: 'Settings' },
]

export default function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuth()

  const selectedKey = menuItems.find(item =>
    location.pathname.startsWith(item.key)
  )?.key ?? '/customers'

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" width={220}>
        <div style={{ color: '#fff', fontSize: 18, fontWeight: 700, padding: '16px 24px', borderBottom: '1px solid #333' }}>
          HFS Field Services
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ marginTop: 8 }}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <Space>
            <Text type="secondary">{user?.displayName}</Text>
            <Button icon={<LogoutOutlined />} onClick={handleLogout} size="small">
              Sign Out
            </Button>
          </Space>
        </Header>
        <Content style={{ padding: 24, background: '#f5f5f5' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
