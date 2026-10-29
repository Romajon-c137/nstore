import { supabase } from '@/shared/lib/supabase'
import type { CartItem,Product } from '@/views/cabinet/ui/shared'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function useServerCart(userId: string | undefined) {
  const qc = useQueryClient()
  const KEY = ['server-cart', userId] as const

  const { data: cart = [], isLoading } = useQuery<CartItem[]>({
    queryKey: KEY,
    queryFn: async () => {
      if (!userId) return []

      // Step 1 — строки корзины
      const { data: rows, error: e1 } = await supabase
        .from('cart')
        .select('product_id, qty, unit_price')
        .eq('user_id', userId)
      if (e1) throw e1
      if (!rows?.length) return []

      // Step 2 — детали товаров (two-step, паттерн из handoff §6)
      const ids = rows.map(r => r.product_id)
      const { data: products, error: e2 } = await supabase
        .from('products')
        .select('id, sku, name, section_name, price, price_tp, price_top, box_qty, vol, is_active, stock, image_url')
        .in('id', ids)
      if (e2) throw e2

      const map = new Map((products ?? []).map(p => [p.id, p as Product]))
      return rows
        .filter(r => map.has(r.product_id))
        .map(r => ({ product: map.get(r.product_id)!, qty: r.qty, unitPrice: r.unit_price }))
    },
    enabled: !!userId,
    staleTime: 0,
  })

  function snapshot() {
    return qc.getQueryData<CartItem[]>(KEY) ?? []
  }

  // ── addToCart ─────────────────────────────────────────────────────────────
  // prevQty читается ДО вызова mutate, чтобы mutationFn не зависел от уже
  // оптимистически обновлённого кэша (onMutate выполняется ПЕРЕД mutationFn).
  // step = box_qty товара (кратность упаковки); по умолчанию 1.
  type AddVars = { product: Product; unitPrice: number; prevQty: number; step: number }

  const addMut = useMutation({
    mutationFn: async ({ product, unitPrice, prevQty, step }: AddVars) => {
      if (!userId) return
      if (prevQty > 0) {
        const { error } = await supabase.from('cart')
          .update({ qty: prevQty + step })
          .eq('user_id', userId).eq('product_id', product.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('cart')
          .insert({ user_id: userId, product_id: product.id, qty: step, unit_price: unitPrice })
        if (error) throw error
      }
    },
    onMutate: async ({ product, unitPrice, step }) => {
      await qc.cancelQueries({ queryKey: KEY })
      const prev = snapshot()
      const existing = prev.find(i => i.product.id === product.id)
      qc.setQueryData<CartItem[]>(KEY,
        existing
          ? prev.map(i => i.product.id === product.id ? { ...i, qty: i.qty + step } : i)
          : [...prev, { product, qty: step, unitPrice }]
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(KEY, ctx.prev) },
  })

  // ── removeFromCart ────────────────────────────────────────────────────────
  // step = box_qty; если qty - step <= 0, строка удаляется целиком.
  type RemoveVars = { productId: string; prevQty: number; step: number }

  const removeMut = useMutation({
    mutationFn: async ({ productId, prevQty, step }: RemoveVars) => {
      if (!userId) return
      if (prevQty > step) {
        const { error } = await supabase.from('cart')
          .update({ qty: prevQty - step })
          .eq('user_id', userId).eq('product_id', productId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('cart')
          .delete().eq('user_id', userId).eq('product_id', productId)
        if (error) throw error
      }
    },
    onMutate: async ({ productId, step }) => {
      await qc.cancelQueries({ queryKey: KEY })
      const prev = snapshot()
      const existing = prev.find(i => i.product.id === productId)
      if (!existing) return { prev }
      qc.setQueryData<CartItem[]>(KEY,
        existing.qty > step
          ? prev.map(i => i.product.id === productId ? { ...i, qty: i.qty - step } : i)
          : prev.filter(i => i.product.id !== productId)
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(KEY, ctx.prev) },
  })

  // ── clearCart — вызывается после успешного оформления заявки ─────────────
  const clearMut = useMutation({
    mutationFn: async () => {
      if (!userId) return
      const { error } = await supabase.from('cart').delete().eq('user_id', userId)
      if (error) throw error
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: KEY })
      const prev = snapshot()
      qc.setQueryData<CartItem[]>(KEY, [])
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(KEY, ctx.prev) },
  })

  // ── setCart — для repeatOrder: заменить всю корзину ──────────────────────
  const setCartMut = useMutation({
    mutationFn: async (items: CartItem[]) => {
      if (!userId) return
      await supabase.from('cart').delete().eq('user_id', userId)
      const rows = items
        .filter(i => UUID_RE.test(i.product.id))
        .map(i => ({ user_id: userId, product_id: i.product.id, qty: i.qty, unit_price: i.unitPrice }))
      if (rows.length > 0) {
        const { error } = await supabase.from('cart').insert(rows)
        if (error) throw error
      }
    },
    onMutate: async (items) => {
      await qc.cancelQueries({ queryKey: KEY })
      const prev = snapshot()
      qc.setQueryData<CartItem[]>(KEY, items)
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(KEY, ctx.prev) },
  })

  return {
    cart,
    isLoading,
    // step = box_qty товара; по умолчанию 1
    addToCart: (product: Product, unitPrice: number, step = 1) => {
      const prevQty = snapshot().find(i => i.product.id === product.id)?.qty ?? 0
      addMut.mutate({ product, unitPrice, prevQty, step })
    },
    removeFromCart: (productId: string, step = 1) => {
      const prevQty = snapshot().find(i => i.product.id === productId)?.qty ?? 0
      removeMut.mutate({ productId, prevQty, step })
    },
    clearCart:  () => clearMut.mutate(),
    setCart:    (items: CartItem[]) => setCartMut.mutate(items),
  }
}
