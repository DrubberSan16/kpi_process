import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { DigitalTwinService } from './digital-twin.service';
import {
  CreateDigitalTwinDto,
  DigitalTwinAiAnalysisDto,
  DigitalTwinDashboardQueryDto,
  DigitalTwinListQueryDto,
  EquipmentCatalogQueryDto,
  UpdateDigitalTwinDto,
} from './digital-twin.dto';

@ApiTags('digital-twins')
@ApiBearerAuth('process')
@Controller('digital-twins')
export class DigitalTwinController {
  constructor(private readonly service: DigitalTwinService) {}

  @Get('next-code')
  @ApiOperation({ summary: 'Obtener siguiente código de gemelo digital' })
  getNextCode() {
    return this.service.getNextCode();
  }

  @Get('equipment-options')
  @ApiOperation({ summary: 'Listar equipos disponibles para asociar al gemelo digital' })
  getEquipmentOptions(@Query() query: EquipmentCatalogQueryDto) {
    return this.service.getEquipmentCatalog(query.search);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Dashboard KPI de gemelos digitales por mes y año' })
  getDashboard(@Query() query: DigitalTwinDashboardQueryDto) {
    return this.service.getDashboard(query);
  }

  @Post('refresh-all')
  @ApiOperation({ summary: 'Recalcular snapshots KPI de todos los gemelos digitales' })
  refreshAll(@Body() payload: DigitalTwinDashboardQueryDto) {
    return this.service.refreshAll(payload);
  }

  @Post()
  @ApiOperation({ summary: 'Crear gemelo digital' })
  @ApiBody({ type: CreateDigitalTwinDto })
  create(@Body() payload: CreateDigitalTwinDto) {
    return this.service.create(payload);
  }

  @Get()
  @ApiOperation({ summary: 'Listar gemelos digitales' })
  findAll(@Query() query: DigitalTwinListQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener gemelo digital por ID' })
  @ApiParam({ name: 'id', description: 'UUID del gemelo digital' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/detail')
  @ApiOperation({ summary: 'Detalle operativo y KPI del gemelo digital' })
  @ApiParam({ name: 'id', description: 'UUID del gemelo digital' })
  getDetail(
    @Param('id') id: string,
    @Query() query: DigitalTwinDashboardQueryDto,
  ) {
    return this.service.getDetail(id, query);
  }

  @Post(':id/refresh')
  @ApiOperation({ summary: 'Recalcular snapshot operativo del gemelo digital' })
  @ApiParam({ name: 'id', description: 'UUID del gemelo digital' })
  refresh(
    @Param('id') id: string,
    @Body() payload: DigitalTwinDashboardQueryDto,
  ) {
    return this.service.refreshTwin(id, payload.year, payload.month);
  }

  @Post(':id/ai-analysis')
  @ApiOperation({ summary: 'Generar análisis IA del gemelo digital' })
  @ApiParam({ name: 'id', description: 'UUID del gemelo digital' })
  @ApiBody({ type: DigitalTwinAiAnalysisDto })
  aiAnalysis(
    @Param('id') id: string,
    @Body() payload: DigitalTwinAiAnalysisDto,
  ) {
    return this.service.analyzeWithAi(id, payload);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar gemelo digital' })
  @ApiParam({ name: 'id', description: 'UUID del gemelo digital' })
  @ApiBody({ type: UpdateDigitalTwinDto })
  update(@Param('id') id: string, @Body() payload: UpdateDigitalTwinDto) {
    return this.service.update(id, payload);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar gemelo digital' })
  @ApiParam({ name: 'id', description: 'UUID del gemelo digital' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
