-- Гео + браузер/ОС для аналитики трафика.
-- Заполняется через Vercel Edge Function /api/track (гео-заголовки x-vercel-ip-*).
ALTER TABLE public.site_visits
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS city    text,
  ADD COLUMN IF NOT EXISTS region  text,
  ADD COLUMN IF NOT EXISTS browser text,
  ADD COLUMN IF NOT EXISTS os      text;
