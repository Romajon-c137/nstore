## Next.js frontend

Приложение перенесено с React/Vite на Next.js App Router и FSD.
Запуск, структура, переменные окружения и проверки: [docs/NEXT-FSD.md](docs/NEXT-FSD.md).

```sh
npm ci
# Создайте .env.local по .env.example
npm run dev
```

## Существующие внешние сервисы

﻿**Внешние сервисы**
Vercel          — Хостинг (auto-deploy из GitHub main)
Supabase        — БД + Auth + Edge Functions + Realtime
Meta Cloud API  — WhatsApp Business API v20.0
Google Fonts    — Manrope шрифт
