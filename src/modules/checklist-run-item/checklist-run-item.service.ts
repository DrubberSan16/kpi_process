import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrudService } from '../../common/crud/crud.service';
import { ChecklistRunItem } from '../entities/checklist-run-item.entity';

@Injectable()
export class ChecklistRunItemService extends CrudService<ChecklistRunItem> {
  constructor(@InjectRepository(ChecklistRunItem) repository: Repository<ChecklistRunItem>) {
    super(repository);
  }
}
