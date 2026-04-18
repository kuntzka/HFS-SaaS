import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu } from 'antd'
import {
  TeamOutlined,
  CalendarOutlined,
  FileTextOutlined,
  DollarOutlined,
  InboxOutlined,
  BarChartOutlined,
  SettingOutlined,
} from '@ant-design/icons'

const { Sider, Content, Header } = Layout

const menuItems = [
  { key: '/customers',  icon: <TeamOutlined />,     label: 'Customers' },
  { key: '/schedule',   icon: <CalendarOutlined />,  label: 'Schedule' },
  { key: '/invoices',   icon: <FileTextOutlined />,  label: 'Invoices' },
  { key: '/commission', icon: <DollarOutlined />,    label: 'Commission' },
  { key: '/inventory',  icon: <InboxOutlined />,     label: 'Inventory' },
  { key: '/reports',    icon: <BarChartOutlined />,  label: 'Reports' },
  { key: '/settings',   icon: <SettingOutlined />,   label: 'Settings' },
]

export default function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()

  const selectedKey = menuItems.find(item =>
    location.pathname.startsWith(item.key)
  )?.key ?? '/customers'

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
        <Header style={{ background: '#fff', padding: '0 24px', borderBottom: '1px solid #f0f0f0' }} />
        <Content style={{ padding: 24, background: '#f5f5f5' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
