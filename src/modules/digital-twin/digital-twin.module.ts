import { DigitalTwinAccessGuard } from './digital-twin-access.guard';
import { DigitalTwinStateRepository } from './digital-twin-state.repository';
import { DigitalTwinStateService } from './digital-twin-state.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  DigitalTwin,
  DigitalTwinInsight,
  DigitalTwinSignal,
} from '../entities';
import { DigitalTwinController } from './digital-twin.controller';
import { DigitalTwinService } from './digital-twin.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DigitalTwin,
      DigitalTwinSignal,
      DigitalTwinInsight,
    ]),
  ],
  controllers: [DigitalTwinController],
  providers: [
    DigitalTwinService,
    DigitalTwinAccessGuard,
    DigitalTwinStateRepository,
    DigitalTwinStateService,
  ],
  exports: [DigitalTwinService],
})
export class DigitalTwinModule {}
