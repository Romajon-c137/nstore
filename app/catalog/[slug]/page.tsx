import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPublicCategory } from '@/entities/catalog/server'
import { Page } from '@/views/category'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const category = await getPublicCategory(slug)
  if (!category) return { title: 'Категория не найдена — nStore', robots: { index: false } }
  const title = `${category.name} оптом в Астане — купить в nStore`
  const description = `${category.name} оптом от дистрибьютора nStore. ${category.products.length} товаров с доставкой по Астане и Казахстану.`
  return { title, description, alternates: { canonical: `/catalog/${slug}` }, openGraph: { title, description } }
}

export default async function RoutePage({ params }: Props) {
  const { slug } = await params
  const category = await getPublicCategory(slug)
  if (!category) notFound()
  return <Page slug={slug} name={category.name} products={category.products} />
}
