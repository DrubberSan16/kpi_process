import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'kpi_process', name: 'tb_equipment' })
export class Equipment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'text' }) code: string;
  @Column({ type: 'text' }) name: string;
  @Column({ type: 'uuid', nullable: true }) location_id?: string | null;
  @Column({ type: 'text', default: 'OPERATIVE' }) status_operational: string;
  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 }) hours_counter: string;
  @Column({ type: 'text', default: 'ACTIVE' }) status: string;
  @Column({ type: 'timestamp without time zone', default: () => 'now()' }) created_at: Date;
  @Column({ type: 'timestamp without time zone', default: () => 'now()' }) updated_at: Date;
  @Column({ type: 'text', nullable: true }) created_by?: string | null;
  @Column({ type: 'text', nullable: true }) updated_by?: string | null;
  @Column({ type: 'boolean', default: false }) is_deleted: boolean;
}
