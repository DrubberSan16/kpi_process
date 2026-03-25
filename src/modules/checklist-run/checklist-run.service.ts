import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrudService } from '../../common/crud/crud.service';
import { ChecklistRun } from '../entities/checklist-run.entity';

@Injectable()
export class ChecklistRunService extends CrudService<ChecklistRun> {
  constructor(@InjectRepository(ChecklistRun) repository: Repository<ChecklistRun>) {
    super(repository);
  }
}
