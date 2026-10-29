import { GUEST_PRICING,clampQty,groupProducts,resolvePrice,type CartLine,type CatalogProduct,type PastOrder } from '@/entities/catalog'
import { getSource } from '@/features/shopping/api/source'
import { useQuery } from '@tanstack/react-query'
import { useCallback,useEffect,useMemo,useState,useSyncExternalStore } from 'react'

/* ── Данные каталога и клиента ─────────────────────────────────────────── */

export function useShopData() {
  const customerQ = useQuery({
    queryKey: ['shop-customer'],
    queryFn: async () => (await getSource()).customer(),
    staleTime: 300_000,
  })
  const customer = customerQ.data ?? null
  const isClient = !!customer?.isClient

  const productsQ = useQuery({
    queryKey: ['shop-products', customer?.companyId ?? customer?.id ?? 'guest'],
    queryFn: async () => (await getSource()).products(customer),
    enabled: customerQ.isFetched,
    staleTime: 300_000,
  })
  const pricingQ = useQuery({
    queryKey: ['shop-pricing', customer?.id],
    queryFn: async () => (await getSource()).pricing(customer!),
    enabled: isClient,
    staleTime: 120_000,
  })
  const ordersQ = useQuery<PastOrder[]>({
    queryKey: ['shop-orders', customer?.id],
    queryFn: async () => (await getSource()).orders(customer!),
    enabled: isClient,
    staleTime: 60_000,
  })

  const products = productsQ.data ?? []
  const groups = useMemo(() => groupProducts(products), [products])
  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

  return {
    customer,
    isClient,
    pricing: pricingQ.data ?? GUEST_PRICING,
    products, groups, byId,
    orders: ordersQ.data ?? [],
    isLoading: !customerQ.isFetched || productsQ.isLoading,
    error: productsQ.error as Error | null,
    refetch: productsQ.refetch,
  }
}

/* ── Хранилище в localStorage с подпиской (корзина, избранное) ─────────── */

function createStore<T>(fallback: T) {
  const listeners = new Set<() => void>()
  const cache = new Map<string, T>()
  const read = (key: string): T => {
    if (!cache.has(key)) {
      try { const raw = localStorage.getItem(key); cache.set(key, raw ? JSON.parse(raw) as T : fallback) }
      catch { cache.set(key, fallback) }
    }
    return cache.get(key)!
  }
  const write = (key: string, v: T) => {
    cache.set(key, v)
    try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* приватный режим — живём в памяти */ }
    listeners.forEach(l => l())
  }
  const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
  return { read, write, subscribe }
}

const EMPTY_CART: CartLine[] = []
const EMPTY_FAVORITES: string[] = []
const cartStore = createStore<CartLine[]>([])
const favStore = createStore<string[]>([])

/* ── Корзина ───────────────────────────────────────────────────────────── */

export function useCart(ownerId: string | null, byId: Map<string, CatalogProduct>, pricing = GUEST_PRICING) {
  const key = `nstore-shop-cart:${ownerId ?? 'guest'}`
  const lines = useSyncExternalStore(cartStore.subscribe, () => cartStore.read(key), () => EMPTY_CART)

  // Гость вошёл в аккаунт — переносим его корзину, чтобы не потерять подбор
  useEffect(() => {
    if (!ownerId) return
    const guestKey = 'nstore-shop-cart:guest'
    const guest = cartStore.read(guestKey)
    if (guest.length && !cartStore.read(key).length) { cartStore.write(key, guest); cartStore.write(guestKey, []) }
  }, [ownerId, key])

  const setQty = useCallback((p: CatalogProduct, qty: number) => {
    const q = clampQty(p, qty)
    const cur = cartStore.read(key)
    const next = q <= 0 ? cur.filter(l => l.productId !== p.id)
      : cur.some(l => l.productId === p.id) ? cur.map(l => l.productId === p.id ? { ...l, qty: q } : l)
      : [...cur, { productId: p.id, qty: q }]
    cartStore.write(key, next)
  }, [key])

  const qtyOf = useCallback((id: string) => lines.find(l => l.productId === id)?.qty ?? 0, [lines])
  const inc = useCallback((p: CatalogProduct) => setQty(p, Math.max(qtyOf(p.id) + p.step, p.minQty)), [setQty, qtyOf])
  const dec = useCallback((p: CatalogProduct) => {
    const cur = qtyOf(p.id)
    setQty(p, cur - p.step < p.minQty ? 0 : cur - p.step)
  }, [setQty, qtyOf])

  /** Добавить набор строк (повтор заказа / «добавить всё»). Возвращает число добавленных. */
  const addMany = useCallback((items: { product: CatalogProduct; qty: number }[]) => {
    let cur = cartStore.read(key)
    let added = 0
    for (const { product, qty } of items) {
      const q = clampQty(product, qty)
      if (q <= 0) continue
      added += 1
      cur = cur.some(l => l.productId === product.id)
        ? cur.map(l => l.productId === product.id ? { ...l, qty: clampQty(product, l.qty + q) } : l)
        : [...cur, { productId: product.id, qty: q }]
    }
    cartStore.write(key, cur)
    return added
  }, [key])

  const clear = useCallback(() => cartStore.write(key, []), [key])

  const detailed = useMemo(() => lines.flatMap(l => {
    const product = byId.get(l.productId)
    if (!product) return []
    const { unitPrice } = resolvePrice(product, pricing, l.qty)
    return [{ product, qty: l.qty, unitPrice: unitPrice ?? 0, sum: (unitPrice ?? 0) * l.qty }]
  }), [lines, byId, pricing])

  const total = detailed.reduce((s, l) => s + l.sum, 0)
  return { lines: detailed, count: detailed.length, total, qtyOf, inc, dec, setQty, addMany, clear }
}

export type Cart = ReturnType<typeof useCart>

/* ── Избранное ─────────────────────────────────────────────────────────── */

export function useFavorites(ownerId: string | null) {
  const key = `nstore-shop-fav:${ownerId ?? 'guest'}`
  const ids = useSyncExternalStore(favStore.subscribe, () => favStore.read(key), () => EMPTY_FAVORITES)
  const toggle = useCallback((id: string) => {
    const cur = favStore.read(key)
    favStore.write(key, cur.includes(id) ? cur.filter(x => x !== id) : [id, ...cur])
  }, [key])
  return { ids, has: (id: string) => ids.includes(id), toggle }
}

/* ── Адаптив ───────────────────────────────────────────────────────────── */

export function useMedia(query: string) {
  const [match, setMatch] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(query)
    setMatch(mq.matches)
    const fn = (e: MediaQueryListEvent) => setMatch(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [query])
  return match
}
