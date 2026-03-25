import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrudService } from '../../common/crud/crud.service';
import { ChecklistTemplate } from '../entities/checklist-template.entity';

@Injectable()
export class ChecklistTemplateService extends CrudService<ChecklistTemplate> {
  constructor(@InjectRepository(ChecklistTemplate) repository: Repository<ChecklistTemplate>) {
    super(repository);
  }
}
