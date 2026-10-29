-- Migration: board_checklist
-- Apply this in Supabase Dashboard → SQL Editor
--
-- Добавляет чек-лист внутрь карточек Борда (src/pages/crm/tabs/BoardTab.tsx).
-- Формат элемента: {"id": string, "text": string, "done": boolean}.
-- RLS не требует изменений — политики на crm_tasks уже работают на уровне
-- строк, а не колонок (как и существующие priority/note/image_url).

ALTER TABLE public.crm_tasks
  ADD COLUMN IF NOT EXISTS checklist jsonb DEFAULT '[]'::jsonb;
