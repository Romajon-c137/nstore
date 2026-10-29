'use client'
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return <main style={{ padding: 32 }}><h1>Не удалось загрузить страницу</h1><button onClick={reset}>Попробовать снова</button></main>
}
