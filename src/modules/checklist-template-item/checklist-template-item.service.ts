import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrudService } from '../../common/crud/crud.service';
import { ChecklistTemplateItem } from '../entities/checklist-template-item.entity';

@Injectable()
export class ChecklistTemplateItemService extends CrudService<ChecklistTemplateItem> {
  constructor(@InjectRepository(ChecklistTemplateItem) repository: Repository<ChecklistTemplateItem>) {
    super(repository);
  }
}
