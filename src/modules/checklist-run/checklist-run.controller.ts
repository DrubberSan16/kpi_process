import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CrudController } from '../../common/crud/crud.controller';
import { ChecklistRun } from '../entities/checklist-run.entity';
import { ChecklistRunService } from './checklist-run.service';

@ApiTags('checklist-runs')
@Controller('checklist-runs')
export class ChecklistRunController extends CrudController<ChecklistRun> {
  constructor(protected readonly service: ChecklistRunService) {
    super(service);
  }
}
