export type UserRole = 'admin' | 'manager' | 'logist' | 'client'

export interface Profile {
  id: string
  role: UserRole
  name: string | null
  email: string | null
  phone: string | null
  company_id: string | null
  created_at: string
}
