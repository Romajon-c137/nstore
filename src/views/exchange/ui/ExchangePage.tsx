'use client'

import { Link } from '@/shared/lib/navigation'

export default function ExchangePage() {
  return (
    <div style={{ minHeight: '100dvh', background: '#EEF1F0', fontFamily: "'Onest', system-ui, sans-serif", color: '#12201A' }}>
      <div className="lp-outer" style={{ maxWidth: 860, margin: '0 auto', padding: '20px 20px 80px' }}>

        {/* Шапка */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 33, height: 33, borderRadius: 10, background: 'linear-gradient(135deg,#10A35B,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 }}>N</div>
            <Link href="/" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, letterSpacing: '-0.02em', color: '#12201A', textDecoration: 'none' }}>nstore</Link>
          </div>
          <span style={{ color: '#8FA197', fontSize: 13 }}>/</span>
          <Link href="/" style={{ color: '#8FA197', fontSize: 13, textDecoration: 'none' }}>Главная</Link>
        </div>

        {/* Контент */}
        <div style={{ background: '#fff', borderRadius: 20, padding: '40px 48px', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, marginBottom: 32, color: '#12201A' }}>
            Политика возврата товара
          </h1>

          <section style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: '#12201A' }}>
              Наша гарантия качества и политика возврата
            </h2>
            <p style={{ fontSize: 14, lineHeight: 1.7, color: '#3D5246', marginBottom: 10 }}>
              Все наши товары хранятся в оптимальных условиях, соответствующих стандартам, с регулярной проверкой сроков годности и качества.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.7, color: '#3D5246' }}>
              Убедительно просим всех клиентов внимательно проверять товар при приемке, чтобы убедиться в его комплектности и соответствии качества. Это поможет избежать недоразумений, связанных с недостачей или дефектами. Ознакомьтесь с нашей Политикой возврата продовольственных товаров ниже.
            </p>
          </section>

          <section style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: '#12201A' }}>
              Отмена заказа до оплаты
            </h2>
            <p style={{ fontSize: 14, lineHeight: 1.7, color: '#3D5246' }}>
              Мы доставляем ваш заказ в выбранный вами временной интервал и по указанному адресу, чтобы вы могли осмотреть товары перед покупкой. Если вы решите отказаться от заказа до его доставки, просто свяжитесь с нами по контактам, указанным в конце страницы, чтобы отменить заказ.
            </p>
          </section>

          <section style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: '#12201A' }}>
              Возврат товаров после оплаты
            </h2>
            <p style={{ fontSize: 14, lineHeight: 1.7, color: '#3D5246', marginBottom: 10 }}>
              Вы можете отказаться от продовольственных товаров только в случае, если он прибыл к вам в ненадлежащем качестве.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.7, color: '#3D5246', marginBottom: 10 }}>
              Согласно пунктам 1-1 и 2 статьи 30 Закона Республики Казахстан «О защите прав потребителей», продовольственный товар подлежит возврату или обмену в случае продажи товаров с истекшим сроком годности или обнаружения потребителем недостатков.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.7, color: '#3D5246' }}>
              <strong>Недостаток</strong> — это нарушение обязательных требований к товару.
            </p>
          </section>

          <div style={{ borderTop: '1px solid #E4E9E6', paddingTop: 24, marginTop: 8 }}>
            <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--primary)', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
              ↩ Вернуться на главную
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
