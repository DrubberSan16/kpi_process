import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CrudController } from '../../common/crud/crud.controller';
import { ChecklistRunItem } from '../entities/checklist-run-item.entity';
import { ChecklistRunItemService } from './checklist-run-item.service';

@ApiTags('checklist-run-items')
@Controller('checklist-run-items')
export class ChecklistRunItemController extends CrudController<ChecklistRunItem> {
  constructor(protected readonly service: ChecklistRunItemService) {
    super(service);
  }
}
