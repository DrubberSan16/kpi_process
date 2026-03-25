import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChecklistRun } from '../entities/checklist-run.entity';
import { ChecklistRunController } from './checklist-run.controller';
import { ChecklistRunService } from './checklist-run.service';

@Module({
  imports: [TypeOrmModule.forFeature([ChecklistRun])],
  controllers: [ChecklistRunController],
  providers: [ChecklistRunService],
  exports: [ChecklistRunService],
})
export class ChecklistRunModule {}
