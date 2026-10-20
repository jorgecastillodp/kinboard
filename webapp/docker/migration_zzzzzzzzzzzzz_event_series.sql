-- migration_zzzzzzzzzzzzz_event_series.sql
-- Repeating events in Kinboard's own (local) calendars.
--
--   event_series       one row per series: its rule and what every occurrence copies
--   events.series_id   the series an occurrence belongs to
--
-- THE OCCURRENCES are ordinary rows in public.events, one per occurrence,
-- each pointing back here and carrying the rule in events.recurrence_rule
-- (a column that has been in init.sql all along, unused until now). That is
-- how a synced Google or CalDAV calendar already stores its repeats, so the
-- calendar, the Home widgets, reminders, the calendar feed and the Integration
-- API show a series without knowing it is one. The rules are in code
-- (webapp/src/lib/event-repeat.ts) and the writes in lib/event-series.ts.
--
-- HOW FAR AHEAD. A series keeps occurrences up to a horizon that depends on
-- how often it repeats (about four months daily, thirteen weekly, three years
-- monthly, ten yearly), and generated_through is the last day made so far. A
-- daily job (/api/cron/extend-event-series) makes the next ones, from the day
-- after generated_through: an occurrence deleted on its own is never made
-- again, because nothing looks for gaps.
--
-- WHO MAY WRITE. The browser roles read their family's series and write
-- nothing; every write is on the service role, in the routes under
-- /api/calendar/series and the cron. TRUNCATE goes with REVOKE ALL.
--
-- Deleting a family or a calendar takes its series with it (ON DELETE
-- CASCADE), and deleting a series takes its occurrences.
--
-- THE NAME sorts after every other migration: it only adds a table and a
-- column to public.events, which init.sql creates.
--
-- Safe to run twice, and twice at once: the session advisory lock serialises
-- two runs.

SELECT pg_advisory_lock(hashtextextended('migration_zzzzzzzzzzzzz_event_series', 0));

CREATE TABLE IF NOT EXISTS public.event_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  calendar_id UUID NOT NULL REFERENCES public.calendars(id) ON DELETE CASCADE,
  -- iCalendar RRULE text, the subset lib/event-repeat.ts writes and reads.
  rule TEXT NOT NULL
    CONSTRAINT event_series_rule_check CHECK (rule ~ '^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[A-Z0-9,]+)*$' AND length(rule) <= 120),
  -- The zone the occurrences keep their wall-clock time in: the browser's,
  -- where the first one was made.
  time_zone TEXT NOT NULL
    CONSTRAINT event_series_time_zone_check CHECK (length(time_zone) BETWEEN 1 AND 64),
  -- The first occurrence, which every other one copies the time and length of.
  first_start_at TIMESTAMPTZ NOT NULL,
  first_end_at TIMESTAMPTZ NOT NULL,
  all_day BOOLEAN NOT NULL DEFAULT false,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  person_id UUID REFERENCES public.people(id) ON DELETE SET NULL,
  -- The last day occurrences have been made for, in time_zone.
  generated_through DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT event_series_order_check CHECK (first_end_at >= first_start_at)
);

CREATE INDEX IF NOT EXISTS event_series_family_idx ON public.event_series (family_id);
CREATE INDEX IF NOT EXISTS event_series_generated_idx ON public.event_series (generated_through);

ALTER TABLE public.event_series ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_series_family_read ON public.event_series;
CREATE POLICY event_series_family_read ON public.event_series
  FOR SELECT USING (family_id = public.current_family_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.event_series FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.event_series FROM authenticated;
    GRANT SELECT ON TABLE public.event_series TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_series TO service_role;
  END IF;
END $$;

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS series_id UUID
  REFERENCES public.event_series(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS events_series_idx ON public.events (series_id) WHERE series_id IS NOT NULL;

SELECT pg_advisory_unlock(hashtextextended('migration_zzzzzzzzzzzzz_event_series', 0));

NOTIFY pgrst, 'reload schema';
