import type { CustomerInvoiceSummary } from './CustomerInvoicesTab'

interface Props {
  customerId: number
  invoice: CustomerInvoiceSummary | null
  onClose: () => void
  onMutated: () => void
}

export function InvoiceDrawer(_props: Props) {
  return null
}
