import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CrudController } from '../../common/crud/crud.controller';
import { WorkOrderStatusHistory } from '../entities/work-order-status-history.entity';
import { WorkOrderStatusHistoryService } from './work-order-status-history.service';

@ApiTags('work-order-status-history')
@Controller('work-order-status-history')
export class WorkOrderStatusHistoryController extends CrudController<WorkOrderStatusHistory> {
  constructor(protected readonly service: WorkOrderStatusHistoryService) {
    super(service);
  }
}
