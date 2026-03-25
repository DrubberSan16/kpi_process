import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrudService } from '../../common/crud/crud.service';
import { Equipment } from '../entities/equipment.entity';

@Injectable()
export class EquipmentService extends CrudService<Equipment> {
  constructor(@InjectRepository(Equipment) repository: Repository<Equipment>) {
    super(repository);
  }
}
