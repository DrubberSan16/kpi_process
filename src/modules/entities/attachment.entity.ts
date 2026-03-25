import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'kpi_process', name: 'tb_attachment' })
export class Attachment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'text' }) entity_type: string;
  @Column({ type: 'uuid' }) entity_id: string;
  @Column({ type: 'text' }) file_name: string;
  @Column({ type: 'text' }) file_url: string;
  @Column({ type: 'text', nullable: true }) mime_type?: string | null;
  @Column({ type: 'bigint', nullable: true }) size_bytes?: string | null;
  @Column({ type: 'uuid', nullable: true }) uploaded_by?: string | null;
  @Column({ type: 'timestamp without time zone', default: () => 'now()' }) created_at: Date;
  @Column({ type: 'timestamp without time zone', default: () => 'now()' }) updated_at: Date;
  @Column({ type: 'boolean', default: false }) is_deleted: boolean;
}
