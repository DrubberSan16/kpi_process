import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'kpi_process', name: 'tb_checklist_run' })
export class ChecklistRun {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) work_order_id: string;
  @Column({ type: 'uuid' }) template_id: string;
  @Column({ type: 'text', default: 'IN_PROGRESS' }) status_run: string;
  @Column({ type: 'timestamp without time zone', nullable: true }) completed_at?: Date | null;
  @Column({ type: 'timestamp without time zone', default: () => 'now()' }) created_at: Date;
  @Column({ type: 'timestamp without time zone', default: () => 'now()' }) updated_at: Date;
  @Column({ type: 'text', nullable: true }) created_by?: string | null;
  @Column({ type: 'text', nullable: true }) updated_by?: string | null;
  @Column({ type: 'boolean', default: false }) is_deleted: boolean;
}
