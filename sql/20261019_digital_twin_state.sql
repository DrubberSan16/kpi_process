BEGIN;
CREATE TABLE IF NOT EXISTS kpi_process.tb_digital_twin_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  digital_twin_id uuid NOT NULL REFERENCES kpi_process.tb_digital_twin(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by text NOT NULL,
  state_json jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_digital_twin_state_history
  ON kpi_process.tb_digital_twin_state (digital_twin_id, recorded_at DESC);
GRANT SELECT, INSERT ON kpi_process.tb_digital_twin_state TO justice_app;
REVOKE UPDATE, DELETE, TRUNCATE ON kpi_process.tb_digital_twin_state FROM justice_app;
COMMIT;
