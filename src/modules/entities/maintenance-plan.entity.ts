import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'kpi_process', name: 'tb_maintenance_plan' })
export class MaintenancePlan {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'text' }) code: string;
  @Column({ type: 'text' }) name: string;
  @Column({ type: 'integer', nullable: true }) interval_hours?: number | null;
  @Column({ type: 'text', nullable: true }) description?: string | null;
  @Column({ type: 'text', default: 'ACTIVE' }) status: string;
  @Column({ type: 'timestamp without time zone', default: () => 'now()' }) created_at: Date;
  @Column({ type: 'timestamp without time zone', default: () => 'now()' }) updated_at: Date;
  @Column({ type: 'text', nullable: true }) created_by?: string | null;
  @Column({ type: 'text', nullable: true }) updated_by?: string | null;
  @Column({ type: 'boolean', default: false }) is_deleted: boolean;
}
