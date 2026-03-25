import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CrudController } from '../../common/crud/crud.controller';
import { Location } from '../entities/location.entity';
import { LocationService } from './location.service';

@ApiTags('locations')
@Controller('locations')
export class LocationController extends CrudController<Location> {
  constructor(protected readonly service: LocationService) {
    super(service);
  }
}
