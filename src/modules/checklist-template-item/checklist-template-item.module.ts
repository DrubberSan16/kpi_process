import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChecklistTemplateItem } from '../entities/checklist-template-item.entity';
import { ChecklistTemplateItemController } from './checklist-template-item.controller';
import { ChecklistTemplateItemService } from './checklist-template-item.service';

@Module({
  imports: [TypeOrmModule.forFeature([ChecklistTemplateItem])],
  controllers: [ChecklistTemplateItemController],
  providers: [ChecklistTemplateItemService],
  exports: [ChecklistTemplateItemService],
})
export class ChecklistTemplateItemModule {}
