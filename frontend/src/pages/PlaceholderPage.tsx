import { Typography, Empty } from 'antd'

interface Props { title: string }

export default function PlaceholderPage({ title }: Props) {
  return (
    <>
      <Typography.Title level={4} style={{ marginTop: 0 }}>{title}</Typography.Title>
      <Empty description={`${title} — coming in a future phase`} />
    </>
  )
}
