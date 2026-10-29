'use client'

import type { HTMLAttributes } from 'react'
import { Area,Bar,CartesianGrid,Legend,AreaChart as RAreaChart,BarChart as RBarChart,ResponsiveContainer,Tooltip,XAxis,YAxis } from 'recharts'

export type Color = 'emerald' | 'slate' | 'blue' | 'amber' | 'red' | 'violet' | 'cyan' | 'orange' | 'rose' | 'teal' | 'indigo' | 'green' | 'yellow' | 'pink' | 'lime' | 'sky' | 'purple' | 'fuchsia' | 'gray' | 'zinc' | 'neutral' | 'stone'
const palette: Record<string, string> = { emerald: '#10a35b', slate: '#64748b', blue: '#3b82f6', amber: '#f59e0b', red: '#ef4444', violet: '#8b5cf6', cyan: '#06b6d4', orange: '#f97316', rose: '#f43f5e', teal: '#14b8a6', indigo: '#6366f1' }
type BoxProps = HTMLAttributes<HTMLDivElement> & { decoration?: string; decorationColor?: Color }
export function Card({ decoration, decorationColor, style, ...props }: BoxProps) {
  return <div {...props} style={{ background: 'var(--bg2, #fff)', border: '1px solid var(--bd2, #e5e7eb)', borderRadius: 12, padding: 20, ...style }} />
}
export function Metric(props: HTMLAttributes<HTMLParagraphElement>) { return <p {...props} style={{ fontSize: 28, fontWeight: 700, ...props.style }} /> }
export function Text(props: HTMLAttributes<HTMLParagraphElement>) { return <p {...props} style={{ fontSize: 14, color: 'var(--t3, #64748b)', ...props.style }} /> }

interface ChartProps {
  data: Record<string, unknown>[]
  index?: string
  categories: string[]
  colors?: Color[]
  className?: string
  valueFormatter?: (value: number) => string
  showLegend?: boolean
  showYAxis?: boolean
  showXAxis?: boolean
  stack?: boolean
  [key: string]: unknown
}
function Chart({ data, index, categories, colors = ['emerald', 'blue', 'amber'], className, valueFormatter, showLegend = true, showYAxis = true, showXAxis = true, stack, kind = 'area' }: ChartProps & { kind?: 'area' | 'bar' | 'spark' }) {
  const Frame = kind === 'bar' ? RBarChart : RAreaChart
  const spark = kind === 'spark'
  return <div className={className} style={{ minHeight: spark ? 36 : 160, width: '100%' }}>
    <ResponsiveContainer width="100%" height="100%" minHeight={spark ? 36 : 160}>
      <Frame data={data} accessibilityLayer>
        {!spark && <CartesianGrid strokeDasharray="3 3" vertical={false} />}
        {!spark && showXAxis && <XAxis dataKey={index} tick={{ fontSize: 11 }} />}
        {!spark && showYAxis && <YAxis tickFormatter={valueFormatter} tick={{ fontSize: 11 }} />}
        <Tooltip formatter={value => valueFormatter ? valueFormatter(Number(value)) : String(value)} />
        {!spark && showLegend && <Legend />}
        {categories.map((category, i) => kind === 'bar'
          ? <Bar key={category} dataKey={category} fill={palette[colors[i % colors.length]] || '#10a35b'} stackId={stack ? 'stack' : undefined} radius={[4, 4, 0, 0]} />
          : <Area key={category} type="monotone" dataKey={category} stroke={palette[colors[i % colors.length]] || '#10a35b'} fill={palette[colors[i % colors.length]] || '#10a35b'} fillOpacity={0.15} stackId={stack ? 'stack' : undefined} />)}
      </Frame>
    </ResponsiveContainer>
  </div>
}
export const AreaChart = (props: ChartProps) => <Chart {...props} />
export const BarChart = (props: ChartProps) => <Chart {...props} kind="bar" />
export const SparkAreaChart = (props: ChartProps) => <Chart {...props} kind="spark" />
export function BarList({ data, color = 'emerald', valueFormatter = String, sortOrder = 'descending', className, onValueChange }: {
  data: { name: string; value: number; color?: Color; href?: string; key?: string }[]
  color?: Color; valueFormatter?: (value: number) => string; sortOrder?: string; className?: string; showAnimation?: boolean; onValueChange?: (value: { name: string; value: number; key?: string }) => void
}) {
  const sorted = sortOrder === 'none' ? data : [...data].sort((a, b) => sortOrder === 'ascending' ? a.value - b.value : b.value - a.value)
  const max = Math.max(1, ...sorted.map(item => Math.abs(item.value)))
  return <ul className={className} style={{ listStyle: 'none', padding: 0, margin: 0 }}>{sorted.map((item, i) => <li key={item.key ?? `${item.name}-${i}`} style={{ position: 'relative', padding: '8px 10px', marginBottom: 6, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
    <span style={{ position: 'absolute', inset: 0, width: `${Math.abs(item.value) / max * 100}%`, background: palette[item.color ?? color] || '#10a35b', opacity: 0.12, borderRadius: 6 }} />
    <span style={{ position: 'relative' }}>{onValueChange ? <button onClick={() => onValueChange(item)}>{item.name}</button> : item.href ? <a href={item.href}>{item.name}</a> : item.name}</span><b style={{ position: 'relative' }}>{valueFormatter(item.value)}</b>
  </li>)}</ul>
}
