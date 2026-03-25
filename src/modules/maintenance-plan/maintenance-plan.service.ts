import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrudService } from '../../common/crud/crud.service';
import { MaintenancePlan } from '../entities/maintenance-plan.entity';

@Injectable()
export class MaintenancePlanService extends CrudService<MaintenancePlan> {
  constructor(@InjectRepository(MaintenancePlan) repository: Repository<MaintenancePlan>) {
    super(repository);
  }
}
