import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChecklistRunItem } from '../entities/checklist-run-item.entity';
import { ChecklistRunItemController } from './checklist-run-item.controller';
import { ChecklistRunItemService } from './checklist-run-item.service';

@Module({
  imports: [TypeOrmModule.forFeature([ChecklistRunItem])],
  controllers: [ChecklistRunItemController],
  providers: [ChecklistRunItemService],
  exports: [ChecklistRunItemService],
})
export class ChecklistRunItemModule {}
