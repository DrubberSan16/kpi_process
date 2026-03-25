import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MaintenancePlan } from '../entities/maintenance-plan.entity';
import { MaintenancePlanController } from './maintenance-plan.controller';
import { MaintenancePlanService } from './maintenance-plan.service';

@Module({
  imports: [TypeOrmModule.forFeature([MaintenancePlan])],
  controllers: [MaintenancePlanController],
  providers: [MaintenancePlanService],
  exports: [MaintenancePlanService],
})
export class MaintenancePlanModule {}
