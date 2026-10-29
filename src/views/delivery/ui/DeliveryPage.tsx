'use client'

import { Link } from '@/shared/lib/navigation'
import { ORG } from '@/shared/lib/seo'
import { H1,H2,P,StaticPage,UL } from '@/widgets/static-page'

export default function DeliveryPage() {
  return (
    <StaticPage
      path="/page/delivery"
      breadcrumb="Доставка и оплата"
      title="Доставка и оплата — Nstore, доставка продуктов по Астане и Казахстану"
      description="Условия доставки Nstore: бесплатная доставка по Астане от 30 000 ₸, доставка по регионам Казахстана и СНГ, самовывоз со склада. Оплата и сроки."
    >
      <H1>Доставка и оплата</H1>
      <P>
        Nstore доставляет продукты питания оптом и в розницу по Астане и всему Казахстану.
        Ниже — условия доставки, самовывоза и оплаты.
      </P>

      <H2>Доставка по Астане</H2>
      <UL>
        <li><strong>Бесплатная доставка</strong> по Астане при заказе на сумму более 30 000 ₸.</li>
        <li>Платная доставка — <strong>1 500 ₸</strong> при заказе на сумму менее 30 000 ₸.</li>
        <li>При оформлении заказа до 09:00 доставка осуществляется в этот же день.</li>
      </UL>

      <H2>Доставка по регионам</H2>
      <UL>
        <li>Доставка во все регионы Казахстана, а также в страны СНГ.</li>
        <li>Оплата за доставку по регионам производится за счёт покупателя.</li>
      </UL>

      <H2>Самовывоз</H2>
      <P>Забрать заказ можно по адресу:</P>
      <P>
        г. Астана, {ORG.address.street} (вывеска «Coffee Boutique»).{' '}
        <a href={ORG.map2gis} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', fontWeight: 700 }}>Смотреть в 2ГИС</a>
      </P>

      <H2>Оплата</H2>
      <P>
        Для юридических лиц и оптовых клиентов условия оплаты (счёт, отсрочка, спеццена по договору)
        уточняйте у менеджера отдела продаж: <a href={'tel:' + ORG.salesPhone.replace(/[^\d+]/g, '')} style={{ color: 'var(--primary)', fontWeight: 700 }}>{ORG.salesPhone}</a>.
      </P>

      <div style={{ marginTop: 28, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link href="/" style={{ padding: '13px 24px', borderRadius: 12, background: 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}>В каталог</Link>
        <Link href="/page/contacts" style={{ padding: '13px 24px', borderRadius: 12, background: '#F2F5F3', color: '#12201A', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}>Контакты</Link>
      </div>
    </StaticPage>
  )
}
