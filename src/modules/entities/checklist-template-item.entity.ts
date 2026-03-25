import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'kpi_process', name: 'tb_checklist_template_item' })
export class ChecklistTemplateItem {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) template_id: string;
  @Column({ type: 'integer', default: 1 }) order_no: number;
  @Column({ type: 'text' }) label: string;
  @Column({ type: 'text', default: 'BOOLEAN' }) field_type: string;
  @Column({ type: 'boolean', default: false }) required: boolean;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) meta: Record<string, unknown>;
  @Column({ type: 'text', default: 'ACTIVE' }) status: string;
  @Column({ type: 'timestamp without time zone', default: () => 'now()' }) created_at: Date;
  @Column({ type: 'timestamp without time zone', default: () => 'now()' }) updated_at: Date;
  @Column({ type: 'boolean', default: false }) is_deleted: boolean;
}
