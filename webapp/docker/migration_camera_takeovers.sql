-- A camera put on the wall displays from outside, for a minute (#335).
--
-- Home Assistant calls `show_camera` when the doorbell rings, and the screens
-- it names — by default every kiosk device — show that camera full screen
-- until `ends_at`. One row per family: a second call, a second ring, replaces
-- the first, which restarts the time or switches the camera, and the table
-- never grows. `ends_at` comes from the server's clock; a screen compares it
-- with its measured offset to that clock (RFC-005 §4.3), so a screen that
-- catches up late shows only what is left.
--
-- `camera_id` is TEXT: cameras live in the `cameras` setting, where an id is
-- whatever string the settings page gave it, not a row a foreign key could
-- point at. `device_ids` is resolved when the call is made, so a screen only
-- has to look for itself in it.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'camera_takeovers'
  ) THEN
    CREATE TABLE public.camera_takeovers (
      family_id UUID PRIMARY KEY REFERENCES public.families(id) ON DELETE CASCADE,
      camera_id TEXT NOT NULL,
      device_ids UUID[] NOT NULL DEFAULT '{}',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ends_at TIMESTAMPTZ NOT NULL
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='camera_takeovers') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.camera_takeovers;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
