import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkOrderStatusHistory } from '../entities/work-order-status-history.entity';
import { WorkOrderStatusHistoryController } from './work-order-status-history.controller';
import { WorkOrderStatusHistoryService } from './work-order-status-history.service';

@Module({
  imports: [TypeOrmModule.forFeature([WorkOrderStatusHistory])],
  controllers: [WorkOrderStatusHistoryController],
  providers: [WorkOrderStatusHistoryService],
  exports: [WorkOrderStatusHistoryService],
})
export class WorkOrderStatusHistoryModule {}
