import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CrudController } from '../../common/crud/crud.controller';
import { Equipment } from '../entities/equipment.entity';
import { EquipmentService } from './equipment.service';

@ApiTags('equipments')
@Controller('equipments')
export class EquipmentController extends CrudController<Equipment> {
  constructor(protected readonly service: EquipmentService) {
    super(service);
  }
}
