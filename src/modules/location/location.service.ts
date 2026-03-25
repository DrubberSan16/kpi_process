import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrudService } from '../../common/crud/crud.service';
import { Location } from '../entities/location.entity';

@Injectable()
export class LocationService extends CrudService<Location> {
  constructor(@InjectRepository(Location) repository: Repository<Location>) {
    super(repository);
  }
}
