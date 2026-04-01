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
  providers: [DigitalTwinService],
  exports: [DigitalTwinService],
})
export class DigitalTwinModule {}
