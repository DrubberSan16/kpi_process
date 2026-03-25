import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrudService } from '../../common/crud/crud.service';
import { WorkOrder } from '../entities/work-order.entity';

@Injectable()
export class WorkOrderService extends CrudService<WorkOrder> {
  constructor(@InjectRepository(WorkOrder) repository: Repository<WorkOrder>) {
    super(repository);
  }
}
