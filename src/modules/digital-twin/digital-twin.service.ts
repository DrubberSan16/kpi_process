import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DigitalTwin } from '../entities';
import {
  CreateDigitalTwinDto,
  DigitalTwinListQueryDto,
  UpdateDigitalTwinDto,
} from './digital-twin.dto';
import { DigitalTwinStateService } from './digital-twin-state.service';
import { DigitalTwinStateRepository } from './digital-twin-state.repository';

/** Asset lifecycle only; physical-state reads and calculations live in separate units. */
@Injectable()
export class DigitalTwinService {
  constructor(
    @InjectRepository(DigitalTwin)
    private readonly twins: Repository<DigitalTwin>,
    private readonly db: DataSource,
    private readonly model: DigitalTwinStateService,
    private readonly source: DigitalTwinStateRepository,
  ) {}

  async findAll(query: DigitalTwinListQueryDto) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Math.min(Number(query.limit || 100), 100));
    const qb = this.twins.createQueryBuilder('t').where('t.is_deleted=false');
    if (query.search?.trim())
      qb.andWhere(
        '(t.name ilike :q or t.code ilike :q or t.equipment_name ilike :q or t.equipment_code ilike :q)',
        { q: `%${query.search.trim()}%` },
      );
    const [rows, total] = await qb
      .orderBy('t.code', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return {
      data: rows.map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        equipment_id: t.equipment_id,
        equipment_code: t.equipment_code,
        equipment_name: t.equipment_name,
        status: t.status,
        last_snapshot_at: t.last_snapshot_at,
        condition:
          t.snapshot_json?.version === 2 ? t.snapshot_json.condition : null,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
  async findOne(id: string) {
    const twin = await this.twins.findOne({ where: { id, is_deleted: false } });
    if (!twin) throw new NotFoundException('Recurso no encontrado');
    return twin;
  }
  async getEquipmentCatalog(search?: string) {
    return this.db.query(
      `select e.id,e.codigo,e.nombre,e.nombre_real,e.modelo,e.numero_serie as serie,m.nombre as marca_nombre
      from kpi_maintenance.tb_equipo e left join kpi_inventory.tb_marca m on m.id=e.marca_id
      where not e.is_deleted and ($1='' or concat_ws(' ',e.codigo,e.nombre,e.nombre_real,e.modelo,e.numero_serie,m.nombre) ilike '%'||$1||'%')
      order by e.codigo limit 100`,
      [
        String(search ?? '')
          .trim()
          .slice(0, 200),
      ],
    );
  }
  async getNextCode() {
    const [row] = await this.db.query(
      `select coalesce(max(substring(code from '^DT-A([0-9]+)$')::bigint),0)+1 as n from kpi_process.tb_digital_twin`,
    );
    return { code: `DT-A${String(row.n).padStart(5, '0')}` };
  }
  async create(dto: CreateDigitalTwinDto, actor: string) {
    if (!dto.equipment_id)
      throw new BadRequestException('Selecciona un equipo real');
    if (!dto.name?.trim())
      throw new BadRequestException('El nombre es obligatorio');
    const [equipment] = await this.source.equipment(dto.equipment_id);
    if (!equipment) throw new BadRequestException('Equipo no disponible');
    return this.db.transaction(async (manager) => {
      await manager.query('select pg_advisory_xact_lock(16001019)');
      const duplicate = await manager.findOne(DigitalTwin, {
        where: { equipment_id: equipment.id, is_deleted: false },
      });
      if (duplicate)
        throw new ConflictException('Este equipo ya tiene un modelo activo');
      const [sequence] = await manager.query(
        `select coalesce(max(substring(code from '^DT-A([0-9]+)$')::bigint),0)+1 as n from kpi_process.tb_digital_twin`,
      );
      const saved = await manager.save(
        DigitalTwin,
        manager.create(DigitalTwin, {
          code: `DT-A${String(sequence.n).padStart(5, '0')}`,
          name: dto.name.trim(),
          equipment_id: equipment.id,
          equipment_code: equipment.codigo,
          equipment_name: equipment.nombre_real || equipment.nombre,
          equipment_model: equipment.modelo,
          ai_enabled: false,
          operational_status: 'SIN_DATOS',
          risk_level: 'SIN_DATOS',
          config_json: {},
          snapshot_json: {},
          created_by: actor,
          updated_by: actor,
        }),
      );
      return {
        id: saved.id,
        code: saved.code,
        name: saved.name,
        equipment_id: saved.equipment_id,
      };
    });
  }
  async update(id: string, dto: UpdateDigitalTwinDto, actor: string) {
    const twin = await this.findOne(id);
    if (!dto.name?.trim())
      throw new BadRequestException('El nombre es obligatorio');
    // Physical identity is immutable once linked: history must belong to the same asset.
    if (
      twin.equipment_id &&
      dto.equipment_id &&
      dto.equipment_id !== twin.equipment_id
    )
      throw new BadRequestException(
        'Crea un modelo para el otro equipo; el historial pertenece a este activo',
      );
    if (!twin.equipment_id && dto.equipment_id) {
      const [equipment] = await this.source.equipment(dto.equipment_id);
      if (!equipment) throw new BadRequestException('Equipo no disponible');
      const duplicate = await this.twins.findOne({
        where: { equipment_id: equipment.id, is_deleted: false },
      });
      if (duplicate && duplicate.id !== id)
        throw new ConflictException('Este equipo ya tiene un modelo activo');
      twin.equipment_id = equipment.id;
      twin.equipment_code = equipment.codigo;
      twin.equipment_name = equipment.nombre_real || equipment.nombre;
    }
    twin.name = dto.name.trim();
    twin.updated_by = actor;
    twin.updated_at = new Date();
    await this.twins.save(twin);
    return {
      id: twin.id,
      code: twin.code,
      name: twin.name,
      equipment_id: twin.equipment_id,
    };
  }
  async remove(id: string, actor: string) {
    const twin = await this.findOne(id);
    twin.is_deleted = true;
    twin.deleted_at = new Date();
    twin.deleted_by = actor;
    await this.twins.save(twin);
    return { success: true };
  }
  async state(id: string) {
    return this.model.state(await this.findOne(id));
  }
  async capture(id: string, actor: string) {
    return this.model.capture(await this.findOne(id), actor);
  }
  async history(id: string) {
    await this.findOne(id);
    return this.source.history(id);
  }
  async historicalState(id: string, captureId: string) {
    await this.findOne(id);
    const [record] = await this.source.captureById(id, captureId);
    if (!record) throw new NotFoundException('Recurso no encontrado');
    return record;
  }
  async simulate(id: string, input: any) {
    return this.model.simulate(await this.findOne(id), input);
  }
}
