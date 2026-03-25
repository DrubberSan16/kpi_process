import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrudService } from '../../common/crud/crud.service';
import { WorkOrder } from '../entities/work-order.entity';
import { WorkOrderStatusHistory } from '../entities/work-order-status-history.entity';

@Injectable()
export class WorkOrderService extends CrudService<WorkOrder> {
  constructor(
    @InjectRepository(WorkOrder) repository: Repository<WorkOrder>,
    @InjectRepository(WorkOrderStatusHistory)
    private readonly historyRepo: Repository<WorkOrderStatusHistory>,
  ) {
    super(repository);
  }

  private normalizeWorkflowStatus(value: unknown) {
    const raw = String(value || '').trim().toUpperCase();
    if (['PLANNED', 'PLANIFICADA', 'PLANIFICADO', 'CREADA', 'CREADO'].includes(raw)) return 'PLANNED';
    if (['IN_PROGRESS', 'IN PROGRESS', 'EN_PROCESO', 'EN PROCESO', 'PROCESSING'].includes(raw)) return 'IN_PROGRESS';
    if (['CLOSED', 'CERRADA', 'CERRADO', 'DONE', 'COMPLETED'].includes(raw)) return 'CLOSED';
    return raw || 'PLANNED';
  }

  private applyWorkflowDates(entity: WorkOrder, previousStatus: string | null, nextStatus: string) {
    if (nextStatus === 'IN_PROGRESS' && !entity.started_at) entity.started_at = new Date();
    if (nextStatus === 'CLOSED' && !entity.closed_at) {
      entity.closed_at = new Date();
      if (!entity.started_at) entity.started_at = new Date();
    }
    if (previousStatus === 'CLOSED' && nextStatus !== 'CLOSED') entity.closed_at = null;
  }

  private async appendHistory(
    workOrderId: string,
    toStatus: string,
    note: string,
    fromStatus?: string | null,
    changedBy?: string | null,
  ) {
    return this.historyRepo.save(
      this.historyRepo.create({
        work_order_id: workOrderId,
        from_status: fromStatus ?? null,
        to_status: toStatus,
        changed_by: changedBy ?? null,
        note,
      }),
    );
  }

  override async create(payload: Partial<WorkOrder>) {
    const nextStatus = this.normalizeWorkflowStatus(payload.status_workflow ?? 'PLANNED');
    const entity = this.repository.create({
      ...payload,
      status_workflow: nextStatus,
    });
    this.applyWorkflowDates(entity, null, nextStatus);
    const saved = await this.repository.save(entity);
    await this.appendHistory(saved.id, nextStatus, 'Orden creada desde kpi_process');
    return saved;
  }

  override async update(id: string, payload: Partial<WorkOrder>) {
    const current = await this.findOne(id);
    const previousStatus = this.normalizeWorkflowStatus(current.status_workflow);
    const merged = this.repository.merge(current, payload, {
      status_workflow: this.normalizeWorkflowStatus(payload.status_workflow ?? current.status_workflow),
    });
    this.applyWorkflowDates(merged, previousStatus, merged.status_workflow);
    const saved = await this.repository.save(merged);
    await this.appendHistory(
      saved.id,
      saved.status_workflow,
      previousStatus !== saved.status_workflow
        ? `Cambio de estado ${previousStatus} → ${saved.status_workflow}`
        : 'Orden actualizada desde kpi_process',
      previousStatus,
    );
    return saved;
  }

  async findHistory(workOrderId: string) {
    await this.findOne(workOrderId);
    return this.historyRepo.find({
      where: { work_order_id: workOrderId },
      order: { changed_at: 'DESC' },
    });
  }

  async addHistory(workOrderId: string, payload: Partial<WorkOrderStatusHistory>) {
    const workOrder = await this.findOne(workOrderId);
    const toStatus = this.normalizeWorkflowStatus(payload.to_status ?? workOrder.status_workflow);
    return this.appendHistory(
      workOrderId,
      toStatus,
      payload.note ?? 'Movimiento manual de historial',
      payload.from_status ?? workOrder.status_workflow,
      payload.changed_by ?? null,
    );
  }

  async changeStatus(workOrderId: string, payload: { to_status: string; note?: string; changed_by?: string | null }) {
    const current = await this.findOne(workOrderId);
    if (!current) throw new NotFoundException('Orden no encontrada');
    const previousStatus = this.normalizeWorkflowStatus(current.status_workflow);
    current.status_workflow = this.normalizeWorkflowStatus(payload.to_status);
    this.applyWorkflowDates(current, previousStatus, current.status_workflow);
    const saved = await this.repository.save(current);
    await this.appendHistory(
      workOrderId,
      saved.status_workflow,
      payload.note ?? `Cambio manual a ${saved.status_workflow}`,
      previousStatus,
      payload.changed_by ?? null,
    );
    return saved;
  }
}
