import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrudService } from '../../common/crud/crud.service';
import { WorkOrderStatusHistory } from '../entities/work-order-status-history.entity';

@Injectable()
export class WorkOrderStatusHistoryService extends CrudService<WorkOrderStatusHistory> {
  constructor(@InjectRepository(WorkOrderStatusHistory) repository: Repository<WorkOrderStatusHistory>) {
    super(repository);
  }
}
