import { useQuery } from '@tanstack/react-query'
import client from '../api/client'

export interface CustomerSummary {
  customerId: number
  companyName: string
  routeCode: string
  payTypeName: string
  city: string
  state: string
}

export interface CustomerDetail extends CustomerSummary {
  address1: string
  address2: string | null
  zip: string
  phone: string | null
  callFirst: boolean
  isTest: boolean
  isConsolidatedBilling: boolean
}

export function useCustomers(search: string) {
  return useQuery<CustomerSummary[]>({
    queryKey: ['customers', search],
    queryFn: () =>
      client.get('/customers', { params: { search } }).then(r => r.data),
    enabled: true,
    staleTime: 30_000,
  })
}

export function useCustomer(id: number) {
  return useQuery<CustomerDetail>({
    queryKey: ['customer', id],
    queryFn: () => client.get(`/customers/${id}`).then(r => r.data),
    enabled: !!id && id > 0,
  })
}
