import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';

export class PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Número de página (inicia en 1)', example: 1, default: 1 })
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ description: 'Cantidad de registros por página (máximo 100)', example: 10, default: 10 })
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({ description: 'Incluye registros soft deleted', example: false, default: false })
  @Transform(({ value }) => String(value).toLowerCase() === 'true')
  includeDeleted?: boolean;
}
