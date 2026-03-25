import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CrudController } from '../../common/crud/crud.controller';
import { WorkOrder } from '../entities/work-order.entity';
import { WorkOrderService } from './work-order.service';

@ApiTags('work-orders')
@Controller('work-orders')
export class WorkOrderController extends CrudController<WorkOrder> {
  constructor(protected readonly service: WorkOrderService) {
    super(service);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Listar historial de una orden de trabajo' })
  @ApiParam({ name: 'id', type: String, description: 'UUID de la orden de trabajo' })
  findHistory(@Param('id') id: string) {
    return this.service.findHistory(id);
  }

  @Post(':id/history')
  @ApiOperation({ summary: 'Agregar registro manual al historial de una orden de trabajo' })
  @ApiParam({ name: 'id', type: String, description: 'UUID de la orden de trabajo' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  addHistory(@Param('id') id: string, @Body() payload: Record<string, unknown>) {
    return this.service.addHistory(id, payload as never);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Cambiar el estado workflow de una orden de trabajo' })
  @ApiParam({ name: 'id', type: String, description: 'UUID de la orden de trabajo' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  changeStatus(@Param('id') id: string, @Body() payload: { to_status: string; note?: string; changed_by?: string | null }) {
    return this.service.changeStatus(id, payload);
  }
}
