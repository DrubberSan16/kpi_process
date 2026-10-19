import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { DigitalTwinService } from './digital-twin.service';
import { DigitalTwinAccessGuard } from './digital-twin-access.guard';
import {
  CreateDigitalTwinDto,
  UpdateDigitalTwinDto,
  DigitalTwinListQueryDto,
  EquipmentCatalogQueryDto,
  DigitalTwinSimulationDto,
} from './digital-twin.dto';

@ApiExcludeController()
@UseGuards(DigitalTwinAccessGuard)
@Controller('digital-twins')
export class DigitalTwinController {
  constructor(private readonly service: DigitalTwinService) {}
  @Get('equipment-options') equipment(@Query() q: EquipmentCatalogQueryDto) {
    return this.service.getEquipmentCatalog(q.search);
  }
  @Get('next-code') code() {
    return this.service.getNextCode();
  }
  @Get() list(@Query() q: DigitalTwinListQueryDto) {
    return this.service.findAll(q);
  }
  @Post() create(@Body() dto: CreateDigitalTwinDto, @Req() req: any) {
    return this.service.create(dto, req.digitalTwinActor.id);
  }
  @Get(':id/state') state(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.state(id);
  }
  @Get(':id/history') history(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.history(id);
  }
  @Get(':id/history/:captureId') historicalState(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('captureId', ParseUUIDPipe) captureId: string,
  ) {
    return this.service.historicalState(id, captureId);
  }
  @Post(':id/capture') capture(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
  ) {
    return this.service.capture(id, req.digitalTwinActor.id);
  }
  @Post(':id/simulate') simulate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DigitalTwinSimulationDto,
  ) {
    return this.service.simulate(id, dto);
  }
  @Patch(':id') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDigitalTwinDto,
    @Req() req: any,
  ) {
    return this.service.update(id, dto, req.digitalTwinActor.id);
  }
  @Delete(':id') remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
  ) {
    return this.service.remove(id, req.digitalTwinActor.id);
  }
}
