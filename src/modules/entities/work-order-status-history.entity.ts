import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'kpi_process', name: 'tb_work_order_status_history' })
export class WorkOrderStatusHistory {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) work_order_id: string;
  @Column({ type: 'text', nullable: true }) from_status?: string | null;
  @Column({ type: 'text' }) to_status: string;
  @Column({ type: 'uuid', nullable: true }) changed_by?: string | null;
  @Column({ type: 'timestamp without time zone', default: () => 'now()' }) changed_at: Date;
  @Column({ type: 'text', nullable: true }) note?: string | null;
}
