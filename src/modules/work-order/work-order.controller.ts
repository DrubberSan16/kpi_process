import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CrudController } from '../../common/crud/crud.controller';
import { WorkOrder } from '../entities/work-order.entity';
import { WorkOrderService } from './work-order.service';

@ApiTags('work-orders')
@Controller('work-orders')
export class WorkOrderController extends CrudController<WorkOrder> {
  constructor(protected readonly service: WorkOrderService) {
    super(service);
  }
}
