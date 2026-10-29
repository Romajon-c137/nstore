'use client'

// Отдельный чанк только для AreaChart (тянет recharts ~230КБ gzip).
// Подгружается лениво, чтобы не блокировать первый показ дашборда после входа.
import { AreaChart } from '@/shared/ui/charts'
export default AreaChart
