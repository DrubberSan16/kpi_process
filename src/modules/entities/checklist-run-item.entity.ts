import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'kpi_process', name: 'tb_checklist_run_item' })
export class ChecklistRunItem {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) run_id: string;
  @Column({ type: 'uuid' }) template_item_id: string;
  @Column({ type: 'text', nullable: true }) value_text?: string | null;
  @Column({ type: 'numeric', precision: 18, scale: 6, nullable: true }) value_number?: string | null;
  @Column({ type: 'boolean', nullable: true }) value_boolean?: boolean | null;
  @Column({ type: 'date', nullable: true }) value_date?: string | null;
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" }) evidence_urls: unknown[];
  @Column({ type: 'timestamp without time zone', default: () => 'now()' }) created_at: Date;
  @Column({ type: 'timestamp without time zone', default: () => 'now()' }) updated_at: Date;
  @Column({ type: 'boolean', default: false }) is_deleted: boolean;
}
