import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'kpi_process', name: 'tb_work_order' })
export class WorkOrder {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'text' }) code: string;
  @Column({ type: 'text' }) type: string;
  @Column({ type: 'uuid', nullable: true }) equipment_id?: string | null;
  @Column({ type: 'uuid', nullable: true }) plan_id?: string | null;
  @Column({ type: 'text' }) title: string;
  @Column({ type: 'text', nullable: true }) description?: string | null;
  @Column({ type: 'text', default: 'PLANNED' }) status_workflow: string;
  @Column({ type: 'integer', default: 5 }) priority: number;
  @Column({ type: 'timestamp without time zone', nullable: true }) scheduled_start?: Date | null;
  @Column({ type: 'timestamp without time zone', nullable: true }) scheduled_end?: Date | null;
  @Column({ type: 'timestamp without time zone', nullable: true }) started_at?: Date | null;
  @Column({ type: 'timestamp without time zone', nullable: true }) closed_at?: Date | null;
  @Column({ type: 'uuid', nullable: true }) requested_by?: string | null;
  @Column({ type: 'uuid', nullable: true }) approved_by?: string | null;
  @Column({ type: 'uuid', nullable: true }) assigned_to?: string | null;
  @Column({ type: 'text', default: 'ACTIVE' }) status: string;
  @Column({ type: 'timestamp without time zone', default: () => 'now()' }) created_at: Date;
  @Column({ type: 'timestamp without time zone', default: () => 'now()' }) updated_at: Date;
  @Column({ type: 'text', nullable: true }) created_by?: string | null;
  @Column({ type: 'text', nullable: true }) updated_by?: string | null;
  @Column({ type: 'boolean', default: false }) is_deleted: boolean;
  @Column({ type: 'text', default: 'INTERNO' }) provider_type: string;
  @Column({ type: 'text', default: 'CORRECTIVO' }) maintenance_kind: string;
  @Column({ type: 'boolean', default: false }) safety_permit_required: boolean;
  @Column({ type: 'text', nullable: true }) safety_permit_code?: string | null;
  @Column({ type: 'uuid', nullable: true }) vendor_id?: string | null;
  @Column({ type: 'uuid', nullable: true }) purchase_request_id?: string | null;
  @Column({ type: 'jsonb', nullable: true }) valor_json?: Record<string, unknown> | null;
}
