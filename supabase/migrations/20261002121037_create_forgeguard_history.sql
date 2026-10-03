/*
# Create ForgeGuard shared history

1. New Tables
- `machine_alerts` stores AI-generated machine risk alerts with the machine identity, severity, risk score, likely failure type, explanation, and acknowledgement state.
- `maintenance_events` stores technician actions and their outcomes so the dashboard can show a maintenance timeline.

2. Security
- Row-level security is enabled on both tables.
- This prototype has no sign-in screen, so the shared single-tenant dashboard allows anonymous and authenticated users to read and write the intentionally shared demo history.
- Separate SELECT, INSERT, UPDATE, and DELETE policies are defined for each table.

3. Notes
- The tables are append-friendly and preserve the history needed for a live demonstration.
- Machine sensor values remain simulated in the browser because they represent the demonstration scenario, while alerts and maintenance actions persist across reloads.
*/

CREATE TABLE IF NOT EXISTS public.machine_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id text NOT NULL,
  machine_name text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('warning', 'critical')),
  message text NOT NULL,
  failure_type text NOT NULL,
  risk_score integer NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  contributing_factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  acknowledged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.maintenance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id text NOT NULL,
  machine_name text NOT NULL,
  action text NOT NULL,
  result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.machine_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Shared users can view machine alerts" ON public.machine_alerts;
CREATE POLICY "Shared users can view machine alerts" ON public.machine_alerts FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Shared users can create machine alerts" ON public.machine_alerts;
CREATE POLICY "Shared users can create machine alerts" ON public.machine_alerts FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Shared users can update machine alerts" ON public.machine_alerts;
CREATE POLICY "Shared users can update machine alerts" ON public.machine_alerts FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Shared users can delete machine alerts" ON public.machine_alerts;
CREATE POLICY "Shared users can delete machine alerts" ON public.machine_alerts FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Shared users can view maintenance events" ON public.maintenance_events;
CREATE POLICY "Shared users can view maintenance events" ON public.maintenance_events FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Shared users can create maintenance events" ON public.maintenance_events;
CREATE POLICY "Shared users can create maintenance events" ON public.maintenance_events FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Shared users can update maintenance events" ON public.maintenance_events;
CREATE POLICY "Shared users can update maintenance events" ON public.maintenance_events FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Shared users can delete maintenance events" ON public.maintenance_events;
CREATE POLICY "Shared users can delete maintenance events" ON public.maintenance_events FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS machine_alerts_created_at_idx ON public.machine_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS maintenance_events_created_at_idx ON public.maintenance_events (created_at DESC);