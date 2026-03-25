import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CrudController } from '../../common/crud/crud.controller';
import { ChecklistTemplateItem } from '../entities/checklist-template-item.entity';
import { ChecklistTemplateItemService } from './checklist-template-item.service';

@ApiTags('checklist-template-items')
@Controller('checklist-template-items')
export class ChecklistTemplateItemController extends CrudController<ChecklistTemplateItem> {
  constructor(protected readonly service: ChecklistTemplateItemService) {
    super(service);
  }
}
