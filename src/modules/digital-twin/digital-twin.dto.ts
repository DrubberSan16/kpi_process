import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class CreateDigitalTwinDto {
  @ApiPropertyOptional({ description: 'Código autogenerado o manual del gemelo digital' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiProperty({ description: 'Nombre del gemelo digital' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'ID del equipo operativo asociado en mantenimiento', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  equipment_id?: string;

  @ApiPropertyOptional({ description: 'Código del equipo' })
  @IsOptional()
  @IsString()
  equipment_code?: string;

  @ApiPropertyOptional({ description: 'Nombre del equipo' })
  @IsOptional()
  @IsString()
  equipment_name?: string;

  @ApiPropertyOptional({ description: 'Modelo del equipo' })
  @IsOptional()
  @IsString()
  equipment_model?: string;

  @ApiPropertyOptional({ description: 'Tipo de gemelo digital', example: 'OPERATIVO' })
  @IsOptional()
  @IsString()
  twin_type?: string;

  @ApiPropertyOptional({ description: 'Alcance del proceso', example: 'MANTENIMIENTO' })
  @IsOptional()
  @IsString()
  process_scope?: string;

  @ApiPropertyOptional({ description: 'Habilita análisis con IA' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  ai_enabled?: boolean;

  @ApiPropertyOptional({ description: 'Configuración adicional del gemelo' })
  @IsOptional()
  @IsObject()
  config_json?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Estado del registro', example: 'ACTIVE' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Usuario creador o actualizador' })
  @IsOptional()
  @IsString()
  updated_by?: string;
}

export class UpdateDigitalTwinDto extends CreateDigitalTwinDto {}

export class DigitalTwinListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Texto para buscar por código, nombre, equipo o modelo' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filtra por nivel de riesgo', example: 'ALTO' })
  @IsOptional()
  @IsString()
  risk_level?: string;

  @ApiPropertyOptional({ description: 'Filtra por estado del gemelo', example: 'ACTIVE' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class DigitalTwinDashboardQueryDto {
  @ApiPropertyOptional({ description: 'Año del periodo', example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;

  @ApiPropertyOptional({ description: 'Mes del periodo', example: 3, minimum: 1, maximum: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @ApiPropertyOptional({ description: 'Busca dentro del dashboard' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class DigitalTwinAiAnalysisDto {
  @ApiPropertyOptional({ description: 'Año del periodo' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;

  @ApiPropertyOptional({ description: 'Mes del periodo', minimum: 1, maximum: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @ApiPropertyOptional({ description: 'Contexto adicional para el análisis IA' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Usuario que ejecuta el análisis' })
  @IsOptional()
  @IsString()
  created_by?: string;
}

export class EquipmentCatalogQueryDto {
  @ApiPropertyOptional({ description: 'Texto para buscar equipo por código o nombre' })
  @IsOptional()
  @IsString()
  search?: string;
}
