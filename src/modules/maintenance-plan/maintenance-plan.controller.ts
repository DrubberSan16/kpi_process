import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CrudController } from '../../common/crud/crud.controller';
import { MaintenancePlan } from '../entities/maintenance-plan.entity';
import { MaintenancePlanService } from './maintenance-plan.service';

@ApiTags('maintenance-plans')
@Controller('maintenance-plans')
export class MaintenancePlanController extends CrudController<MaintenancePlan> {
  constructor(protected readonly service: MaintenancePlanService) {
    super(service);
  }
}
