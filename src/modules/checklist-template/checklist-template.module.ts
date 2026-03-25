import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChecklistTemplate } from '../entities/checklist-template.entity';
import { ChecklistTemplateController } from './checklist-template.controller';
import { ChecklistTemplateService } from './checklist-template.service';

@Module({
  imports: [TypeOrmModule.forFeature([ChecklistTemplate])],
  controllers: [ChecklistTemplateController],
  providers: [ChecklistTemplateService],
  exports: [ChecklistTemplateService],
})
export class ChecklistTemplateModule {}
