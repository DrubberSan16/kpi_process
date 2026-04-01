import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'kpi_process', name: 'tb_digital_twin' })
export class DigitalTwin {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'text', unique: true })
  code: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'uuid', nullable: true })
  equipment_id?: string | null;

  @Column({ type: 'text', nullable: true })
  equipment_code?: string | null;

  @Column({ type: 'text', nullable: true })
  equipment_name?: string | null;

  @Column({ type: 'text', nullable: true })
  equipment_model?: string | null;

  @Column({ type: 'text', default: 'OPERATIVO' })
  twin_type: string;

  @Column({ type: 'text', default: 'MANTENIMIENTO' })
  process_scope: string;

  @Column({ type: 'boolean', default: true })
  ai_enabled: boolean;

  @Column({ type: 'text', nullable: true })
  ai_last_status?: string | null;

  @Column({ type: 'text', nullable: true })
  ai_summary?: string | null;

  @Column('numeric', { precision: 6, scale: 2, default: 100 })
  health_score: number;

  @Column({ type: 'text', default: 'BAJO' })
  risk_level: string;

  @Column({ type: 'text', default: 'ESTABLE' })
  operational_status: string;

  @Column({ type: 'timestamp without time zone', nullable: true })
  last_snapshot_at?: Date | null;

  @Column({ type: 'timestamp without time zone', nullable: true })
  last_ai_analysis_at?: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  config_json: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  snapshot_json: Record<string, unknown>;

  @Column({ type: 'text', default: 'ACTIVE' })
  status: string;

  @Column({ type: 'timestamp without time zone', default: () => 'now()' })
  created_at: Date;

  @Column({ type: 'timestamp without time zone', default: () => 'now()' })
  updated_at: Date;

  @Column({ type: 'text', nullable: true })
  created_by?: string | null;

  @Column({ type: 'text', nullable: true })
  updated_by?: string | null;

  @Column({ type: 'boolean', default: false })
  is_deleted: boolean;

  @Column({ type: 'timestamp without time zone', nullable: true })
  deleted_at?: Date | null;

  @Column({ type: 'text', nullable: true })
  deleted_by?: string | null;
}

@Entity({ schema: 'kpi_process', name: 'tb_digital_twin_signal' })
export class DigitalTwinSignal {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'uuid' })
  digital_twin_id: string;

  @Column({ type: 'integer' })
  period_year: number;

  @Column({ type: 'integer' })
  period_month: number;

  @Column({ type: 'text' })
  signal_key: string;

  @Column({ type: 'text' })
  signal_label: string;

  @Column({ type: 'text' })
  signal_category: string;

  @Column('numeric', { precision: 18, scale: 4, default: 0 })
  signal_value: number;

  @Column({ type: 'text', nullable: true })
  signal_unit?: string | null;

  @Column('numeric', { precision: 18, scale: 4, nullable: true })
  reference_value?: number | null;

  @Column({ type: 'text', default: 'INFO' })
  severity: string;

  @Column({ type: 'timestamp without time zone', default: () => 'now()' })
  measured_at: Date;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload_json: Record<string, unknown>;
}

@Entity({ schema: 'kpi_process', name: 'tb_digital_twin_insight' })
export class DigitalTwinInsight {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'uuid' })
  digital_twin_id: string;

  @Column({ type: 'integer' })
  period_year: number;

  @Column({ type: 'integer' })
  period_month: number;

  @Column({ type: 'text', default: 'SYSTEM' })
  source: string;

  @Column({ type: 'text', default: 'AI_RECOMMENDATION' })
  insight_type: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text' })
  summary: string;

  @Column({ type: 'text', nullable: true })
  recommendation?: string | null;

  @Column({ type: 'text', default: 'MEDIA' })
  priority: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload_json: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  created_by?: string | null;

  @Column({ type: 'timestamp without time zone', default: () => 'now()' })
  created_at: Date;

  @Column({ type: 'text', default: 'ACTIVE' })
  status: string;

  @Column({ type: 'boolean', default: false })
  is_deleted: boolean;
}
