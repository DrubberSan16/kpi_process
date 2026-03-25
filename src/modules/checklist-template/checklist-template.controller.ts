import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CrudController } from '../../common/crud/crud.controller';
import { ChecklistTemplate } from '../entities/checklist-template.entity';
import { ChecklistTemplateService } from './checklist-template.service';

@ApiTags('checklist-templates')
@Controller('checklist-templates')
export class ChecklistTemplateController extends CrudController<ChecklistTemplate> {
  constructor(protected readonly service: ChecklistTemplateService) {
    super(service);
  }
}
