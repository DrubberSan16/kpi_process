import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  DigitalTwin,
  DigitalTwinInsight,
  DigitalTwinSignal,
} from '../entities';
import {
  CreateDigitalTwinDto,
  DigitalTwinAiAnalysisDto,
  DigitalTwinDashboardQueryDto,
  DigitalTwinListQueryDto,
  UpdateDigitalTwinDto,
} from './digital-twin.dto';

type DashboardPeriod = {
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  label: string;
};

type TwinInventoryWarehouse = {
  bodega_id: string | null;
  codigo: string | null;
  nombre: string | null;
  stock_actual: number;
  stock_min_bodega: number;
  stock_max_bodega: number;
  costo_promedio_bodega: number;
  estado_stock: string;
};

type TwinMaterialRecommendation = {
  producto_id: string | null;
  codigo: string | null;
  nombre: string | null;
  consumo_total: number;
  movimientos: number;
  costo_referencia: number;
  es_lubricante_esperado: boolean;
  stock_total: number;
  low_stock_bodegas: number;
  stock_status: string;
  bodega_sugerida: TwinInventoryWarehouse | null;
  bodegas: TwinInventoryWarehouse[];
};

type TwinComputedSnapshot = {
  twin: DigitalTwin;
  period: DashboardPeriod;
  equipment: {
    code: string | null;
    operational_name: string | null;
    real_name: string | null;
    display_name: string | null;
    model: string | null;
    brand_name: string | null;
    criticidad: string | null;
    estado_operativo: string | null;
    codigo_lubricante: string | null;
  };
  metrics: {
    critical_alerts: number;
    open_alerts: number;
    open_work_orders: number;
    closed_work_orders: number;
    planned_hours_month: number;
    weekly_activity_count: number;
    weekly_hours: number;
    daily_report_count: number;
    operation_hours: number;
    overdue_programaciones: number;
    lubricant_samples: number;
  };
  lubricant: {
    latest_state: string;
    latest_report_date: string | null;
    latest_report_code: string | null;
    latest_lubricant: string | null;
    latest_lubricant_brand: string | null;
    expected_lubricant_code: string | null;
    match_status: string;
  };
  inventory: {
    total_materials: number;
    low_stock_materials: number;
    recommended_materials: TwinMaterialRecommendation[];
  };
  health_score: number;
  risk_level: string;
  operational_status: string;
  kpis: Array<{
    key: string;
    label: string;
    value: number | string;
    helper: string;
    color: string;
  }>;
  signals: Array<{
    key: string;
    label: string;
    category: string;
    value: number;
    unit?: string | null;
    reference_value?: number | null;
    severity: string;
    helper: string;
  }>;
};

type AiInsightPayload = {
  source: string;
  title: string;
  summary: string;
  recommendation: string;
  priority: string;
  payload_json: Record<string, unknown>;
};

type SimilarEquipmentSuggestion = {
  twin_id?: string | null;
  twin_code?: string | null;
  equipment_id?: string | null;
  equipment_code?: string | null;
  equipment_name?: string | null;
  equipment_model?: string | null;
  health_score?: number | null;
  risk_level?: string | null;
  operational_status?: string | null;
  similarity_reason: string;
};

const MONTH_LABELS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

@Injectable()
export class DigitalTwinService {
  constructor(
    @InjectRepository(DigitalTwin)
    private readonly digitalTwinRepo: Repository<DigitalTwin>,
    @InjectRepository(DigitalTwinSignal)
    private readonly digitalTwinSignalRepo: Repository<DigitalTwinSignal>,
    @InjectRepository(DigitalTwinInsight)
    private readonly digitalTwinInsightRepo: Repository<DigitalTwinInsight>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async findAll(query: DigitalTwinListQueryDto) {
    const page = Number(query.page || 1);
    const limit = Math.min(Number(query.limit || 10), 100);

    const qb = this.digitalTwinRepo
      .createQueryBuilder('dt')
      .where('dt.is_deleted = false');

    if (query.search) {
      qb.andWhere(
        `(dt.code ILIKE :search OR dt.name ILIKE :search OR dt.equipment_code ILIKE :search OR dt.equipment_name ILIKE :search OR dt.equipment_model ILIKE :search)`,
        { search: `%${query.search}%` },
      );
    }

    if (query.risk_level) {
      qb.andWhere('upper(dt.risk_level) = upper(:riskLevel)', {
        riskLevel: query.risk_level,
      });
    }

    if (query.status) {
      qb.andWhere('upper(dt.status) = upper(:status)', { status: query.status });
    }

    const [data, total] = await qb
      .orderBy('dt.updated_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    return this.findDigitalTwinOrFail(id);
  }

  async create(dto: CreateDigitalTwinDto) {
    const equipment = await this.resolveEquipmentReference(dto.equipment_id);
    const code = await this.resolveDigitalTwinCode(dto.code);
    const entity = this.digitalTwinRepo.create({
      code,
      name: String(
        dto.name ||
          equipment?.nombre_real ||
          equipment?.nombre ||
          equipment?.codigo ||
          '',
      ).trim(),
      equipment_id: dto.equipment_id ?? null,
      equipment_code: this.firstText(dto.equipment_code, equipment?.codigo),
      equipment_name: this.firstText(
        dto.equipment_name,
        equipment?.nombre_real,
        equipment?.nombre,
      ),
      equipment_model: this.firstText(dto.equipment_model, equipment?.modelo),
      twin_type: this.firstText(dto.twin_type, 'OPERATIVO') ?? 'OPERATIVO',
      process_scope:
        this.firstText(dto.process_scope, 'MANTENIMIENTO') ?? 'MANTENIMIENTO',
      ai_enabled: dto.ai_enabled ?? true,
      config_json: dto.config_json ?? {},
      status: this.firstText(dto.status, 'ACTIVE') ?? 'ACTIVE',
      created_by: this.firstText(dto.updated_by),
      updated_by: this.firstText(dto.updated_by),
    });
    const saved = await this.digitalTwinRepo.save(entity);
    await this.refreshTwin(saved.id, undefined, undefined);
    return this.findOne(saved.id);
  }

  async update(id: string, dto: UpdateDigitalTwinDto) {
    const current = await this.findDigitalTwinOrFail(id);
    const equipment = await this.resolveEquipmentReference(
      dto.equipment_id ?? current.equipment_id ?? undefined,
    );

    current.name = this.firstText(dto.name, current.name) ?? current.name;
    current.equipment_id =
      dto.equipment_id !== undefined ? dto.equipment_id : current.equipment_id;
    current.equipment_code = this.firstText(
      dto.equipment_code,
      equipment?.codigo,
      current.equipment_code,
    );
    current.equipment_name = this.firstText(
      dto.equipment_name,
      equipment?.nombre_real,
      equipment?.nombre,
      current.equipment_name,
    );
    current.equipment_model = this.firstText(
      dto.equipment_model,
      equipment?.modelo,
      current.equipment_model,
    );
    current.twin_type = this.firstText(dto.twin_type, current.twin_type) ?? current.twin_type;
    current.process_scope =
      this.firstText(dto.process_scope, current.process_scope) ?? current.process_scope;
    if (dto.ai_enabled !== undefined) current.ai_enabled = Boolean(dto.ai_enabled);
    if (dto.config_json !== undefined) current.config_json = dto.config_json ?? {};
    current.status = this.firstText(dto.status, current.status) ?? current.status;
    current.updated_by = this.firstText(dto.updated_by, current.updated_by);
    current.updated_at = new Date();

    await this.digitalTwinRepo.save(current);
    await this.refreshTwin(current.id, undefined, undefined);
    return this.findOne(current.id);
  }

  async remove(id: string, deletedBy?: string) {
    const current = await this.findDigitalTwinOrFail(id);
    current.is_deleted = true;
    current.deleted_at = new Date();
    current.deleted_by = this.firstText(deletedBy, current.deleted_by);
    current.updated_at = new Date();
    await this.digitalTwinRepo.save(current);
    return { message: `Gemelo digital ${id} eliminado correctamente` };
  }

  async getNextCode() {
    return {
      code: await this.resolveDigitalTwinCode(undefined),
      prefix: 'DT-A',
    };
  }

  async getEquipmentCatalog(search?: string) {
    const term = String(search || '').trim();
    const params: unknown[] = [];
    let where = `where e.is_deleted = false`;

    if (term) {
      params.push(`%${term}%`);
      where += ` and (
        e.codigo ilike $1
        or e.nombre ilike $1
        or coalesce(e.nombre_real, '') ilike $1
        or coalesce(e.modelo, '') ilike $1
        or coalesce(e.codigo_lubricante, '') ilike $1
      )`;
    }

    const rows = await this.dataSource.query(
      `
        select
          e.id,
          e.codigo,
          e.nombre,
          e.nombre_real,
          e.modelo,
          e.codigo_lubricante,
          coalesce(m.nombre, '') as marca_nombre
        from kpi_maintenance.tb_equipo e
        left join kpi_inventory.tb_marca m on m.id = e.marca_id
        ${where}
        order by e.codigo asc
        limit 100
      `,
      params,
    );

    return rows.map((row: any) => ({
      id: row.id,
      codigo: row.codigo,
      nombre: row.nombre,
      nombre_real: row.nombre_real || null,
      modelo: row.modelo || null,
      codigo_lubricante: row.codigo_lubricante || null,
      marca_nombre: row.marca_nombre || null,
      label: [row.codigo, row.nombre].filter(Boolean).join(' · '),
    }));
  }

  async getDashboard(query: DigitalTwinDashboardQueryDto) {
    const period = this.resolvePeriod(query.year, query.month);
    const twins = await this.getTwinCollection(query.search);
    const rows = await Promise.all(
      twins.map((twin) => this.buildTwinSnapshot(twin, period, false)),
    );

    const totalTwins = rows.length;
    const activeTwins = rows.filter((row) => row.twin.status === 'ACTIVE').length;
    const averageHealth = totalTwins
      ? Number(
          (
            rows.reduce((sum, row) => sum + row.health_score, 0) / totalTwins
          ).toFixed(2),
        )
      : 0;
    const highRisk = rows.filter((row) => row.risk_level === 'ALTO').length;
    const criticalAlerts = rows.reduce(
      (sum, row) => sum + row.metrics.critical_alerts,
      0,
    );
    const totalPlannedHours = Number(
      rows
        .reduce((sum, row) => sum + row.metrics.planned_hours_month, 0)
        .toFixed(2),
    );
    const totalWeeklyActivities = rows.reduce(
      (sum, row) => sum + row.metrics.weekly_activity_count,
      0,
    );
    const aiAnalyses = await this.digitalTwinInsightRepo.count({
      where: {
        is_deleted: false,
        period_year: period.year,
        period_month: period.month,
      },
    });

    return {
      period,
      generated_at: new Date().toISOString(),
      kpis: [
        { key: 'total_twins', label: 'Gemelos digitales', value: totalTwins, helper: 'Activos y configurados en el módulo', icon: 'mdi-graph-outline' },
        { key: 'active_twins', label: 'Gemelos activos', value: activeTwins, helper: 'Registros operativos habilitados', icon: 'mdi-check-decagram' },
        { key: 'average_health', label: 'Salud promedio', value: `${averageHealth}%`, helper: 'Puntaje consolidado del período seleccionado', icon: 'mdi-heart-pulse' },
        { key: 'high_risk', label: 'Riesgo alto', value: highRisk, helper: 'Equipos que requieren intervención prioritaria', icon: 'mdi-alert-octagon' },
        { key: 'critical_alerts', label: 'Alertas críticas', value: criticalAlerts, helper: 'Alertas abiertas o críticas asociadas a los equipos', icon: 'mdi-bell-alert' },
        { key: 'planned_hours', label: 'Horas programadas', value: totalPlannedHours, helper: 'Horas de mantenimiento mensual programadas', icon: 'mdi-calendar-clock' },
        { key: 'weekly_activities', label: 'Actividades semanales', value: totalWeeklyActivities, helper: 'Actividades detalladas del cronograma semanal', icon: 'mdi-format-list-checks' },
        { key: 'ai_insights', label: 'Insights IA', value: aiAnalyses, helper: 'Análisis emitidos por IA o reglas expertas', icon: 'mdi-robot-industrial' },
      ],
      risk_breakdown: [
        { label: 'Alto', value: rows.filter((row) => row.risk_level === 'ALTO').length, color: 'error' },
        { label: 'Medio', value: rows.filter((row) => row.risk_level === 'MEDIO').length, color: 'warning' },
        { label: 'Bajo', value: rows.filter((row) => row.risk_level === 'BAJO').length, color: 'success' },
      ],
      rows,
    };
  }

  async getDetail(id: string, query: DigitalTwinDashboardQueryDto) {
    const twin = await this.findDigitalTwinOrFail(id);
    const period = this.resolvePeriod(query.year, query.month);
    const snapshot = await this.buildTwinSnapshot(twin, period, false);
    const insights = await this.digitalTwinInsightRepo.find({
      where: {
        digital_twin_id: id,
        period_year: period.year,
        period_month: period.month,
        is_deleted: false,
      },
      order: { created_at: 'DESC' },
    });
    const persistedSignals = await this.digitalTwinSignalRepo.find({
      where: {
        digital_twin_id: id,
        period_year: period.year,
        period_month: period.month,
      },
      order: { signal_category: 'ASC', signal_label: 'ASC' },
    });

    return {
      twin,
      period,
      snapshot,
      signals: persistedSignals.length ? persistedSignals : snapshot.signals,
      insights,
    };
  }

  async refreshTwin(id: string, year?: number, month?: number) {
    const twin = await this.findDigitalTwinOrFail(id);
    const period = this.resolvePeriod(year, month);
    return this.buildTwinSnapshot(twin, period, true);
  }

  async refreshAll(query: DigitalTwinDashboardQueryDto) {
    const period = this.resolvePeriod(query.year, query.month);
    const twins = await this.getTwinCollection(query.search);
    const rows = await Promise.all(
      twins.map((twin) => this.buildTwinSnapshot(twin, period, true)),
    );
    return { period, total: rows.length };
  }

  async analyzeWithAi(id: string, payload: DigitalTwinAiAnalysisDto) {
    const twin = await this.findDigitalTwinOrFail(id);
    const period = this.resolvePeriod(payload.year, payload.month);
    const snapshot = await this.buildTwinSnapshot(twin, period, true);
    const similarEquipment = await this.findSimilarEquipment(snapshot);
    const improvementSteps = this.buildImprovementSteps(
      snapshot,
      similarEquipment,
      payload.notes,
    );
    const insightPayload = await this.generateAiInsight(
      snapshot,
      payload.notes,
      similarEquipment,
      improvementSteps,
    );

    const insight = await this.digitalTwinInsightRepo.save(
      this.digitalTwinInsightRepo.create({
        digital_twin_id: twin.id,
        period_year: period.year,
        period_month: period.month,
        source: insightPayload.source,
        insight_type: 'AI_RECOMMENDATION',
        title: insightPayload.title,
        summary: insightPayload.summary,
        recommendation: insightPayload.recommendation,
        priority: insightPayload.priority,
        payload_json: insightPayload.payload_json,
        created_by: payload.created_by ?? null,
      }),
    );

    twin.ai_last_status = insightPayload.source;
    twin.ai_summary = insightPayload.summary;
    twin.last_ai_analysis_at = new Date();
    twin.updated_at = new Date();
    await this.digitalTwinRepo.save(twin);

    return {
      insight,
      twin,
      period,
    };
  }

  private async getTwinCollection(search?: string) {
    const qb = this.digitalTwinRepo
      .createQueryBuilder('dt')
      .where('dt.is_deleted = false');

    if (search) {
      qb.andWhere(
        `(dt.code ILIKE :search OR dt.name ILIKE :search OR dt.equipment_code ILIKE :search OR dt.equipment_name ILIKE :search OR dt.equipment_model ILIKE :search)`,
        { search: `%${search}%` },
      );
    }

    return qb.orderBy('dt.code', 'ASC').getMany();
  }

  private async buildTwinSnapshot(
    twin: DigitalTwin,
    period: DashboardPeriod,
    persist = false,
  ): Promise<TwinComputedSnapshot> {
    const equipmentId = twin.equipment_id ?? null;
    const equipmentContext = equipmentId
      ? await this.resolveEquipmentReference(equipmentId)
      : null;
    const equipmentCode =
      this.firstText(twin.equipment_code, equipmentContext?.codigo) ?? null;
    const currentHours = await this.queryCurrentEquipmentHours(equipmentId);
    const equipment = {
      code: equipmentCode,
      operational_name: this.firstText(
        equipmentContext?.nombre,
        twin.equipment_name,
      ),
      real_name: this.firstText(equipmentContext?.nombre_real),
      display_name:
        this.firstText(
          equipmentContext?.nombre_real,
          twin.equipment_name,
          equipmentContext?.nombre,
        ) ?? null,
      model:
        this.firstText(
          twin.equipment_model,
          equipmentContext?.modelo,
        ) ?? null,
      brand_name: this.firstText(equipmentContext?.marca_nombre),
      criticidad: this.firstText(equipmentContext?.criticidad),
      estado_operativo: this.firstText(equipmentContext?.estado_operativo),
      codigo_lubricante: this.firstText(equipmentContext?.codigo_lubricante),
    };

    const [
      alertsRow,
      workOrdersRow,
      monthlyProgramRow,
      weeklyScheduleRow,
      lubricantRow,
      dailyRow,
      overdueRow,
      recommendedMaterials,
    ] = await Promise.all([
      this.queryAlertMetrics(equipmentId, equipmentCode, period),
      this.queryWorkOrderMetrics(equipmentId, period),
      this.queryMonthlyProgramMetrics(equipmentId, equipmentCode, period),
      this.queryWeeklyScheduleMetrics(equipmentCode, period),
      this.queryLubricantMetrics(equipmentId, equipmentCode, period),
      this.queryDailyReportMetrics(equipmentId, equipmentCode, period),
      this.queryOverdueProgramaciones(equipmentId, period, currentHours),
      this.queryMaterialRecommendations(
        equipmentId,
        equipment.codigo_lubricante,
      ),
    ]);

    const metrics = {
      critical_alerts: this.toNumber(alertsRow?.critical_alerts),
      open_alerts: this.toNumber(alertsRow?.open_alerts),
      open_work_orders: this.toNumber(workOrdersRow?.open_orders),
      closed_work_orders: this.toNumber(workOrdersRow?.closed_orders),
      planned_hours_month: this.toNumber(monthlyProgramRow?.planned_hours),
      weekly_activity_count: this.toNumber(weeklyScheduleRow?.activity_count),
      weekly_hours: this.toNumber(weeklyScheduleRow?.total_hours),
      daily_report_count: this.toNumber(dailyRow?.report_count),
      operation_hours: this.toNumber(dailyRow?.operation_hours),
      overdue_programaciones: this.toNumber(overdueRow?.overdue_count),
      lubricant_samples: this.toNumber(lubricantRow?.sample_count),
    };

    const lubricantState = String(
      lubricantRow?.latest_state || 'SIN_ANALISIS',
    ).toUpperCase();
    const lubricantMatchStatus = this.resolveLubricantMatchStatus(
      equipment.codigo_lubricante,
      lubricantRow?.latest_lubricant,
    );
    const lubricantPenalty =
      lubricantState === 'ALERTA' || lubricantState === 'ANORMAL'
        ? 20
        : lubricantState === 'OBSERVACION' || lubricantState === 'PRECAUCION'
          ? 10
          : 0;
    const equipmentStatePenalty =
      equipment.estado_operativo === 'CORRECTIVO' ||
      equipment.estado_operativo === 'BLOQUEADA'
        ? 15
        : equipment.estado_operativo === 'MPG' ||
            equipment.estado_operativo === 'RESERVA'
          ? 6
          : 0;
    const lubricantMatchPenalty =
      lubricantMatchStatus === 'NO_COINCIDE'
        ? 10
        : lubricantMatchStatus === 'SIN_REFERENCIA'
          ? 3
          : 0;
    const lowStockMaterials = recommendedMaterials.filter(
      (item) => item.stock_status !== 'DISPONIBLE',
    ).length;
    const inventoryPenalty =
      recommendedMaterials.some(
        (item) =>
          item.es_lubricante_esperado && item.stock_status !== 'DISPONIBLE',
      )
        ? 12
        : lowStockMaterials > 0
          ? Math.min(8, lowStockMaterials * 2)
          : 0;

    let healthScore =
      100 -
      metrics.critical_alerts * 12 -
      metrics.open_alerts * 4 -
      metrics.open_work_orders * 5 -
      metrics.overdue_programaciones * 10 -
      lubricantPenalty -
      equipmentStatePenalty -
      lubricantMatchPenalty -
      inventoryPenalty;

    if (
      metrics.daily_report_count === 0 &&
      (metrics.planned_hours_month > 0 || metrics.weekly_activity_count > 0)
    ) {
      healthScore -= 5;
    }

    healthScore = Math.max(0, Math.min(100, Number(healthScore.toFixed(2))));

    const riskLevel =
      metrics.critical_alerts > 0 ||
      metrics.overdue_programaciones > 0 ||
      equipmentStatePenalty >= 15 ||
      healthScore < 50
        ? 'ALTO'
        : metrics.open_alerts > 0 ||
            metrics.open_work_orders > 0 ||
            lubricantPenalty > 0 ||
            lubricantMatchPenalty > 0 ||
            inventoryPenalty > 0 ||
            healthScore < 75
          ? 'MEDIO'
          : 'BAJO';

    const operationalStatus =
      metrics.critical_alerts > 0 ||
      metrics.overdue_programaciones > 0 ||
      equipmentStatePenalty >= 15
        ? 'CRITICO'
        : lubricantPenalty > 0 ||
            metrics.open_work_orders > 0 ||
            inventoryPenalty > 0 ||
            lubricantMatchPenalty > 0 ||
            equipmentStatePenalty > 0
          ? 'EN_OBSERVACION'
          : 'ESTABLE';

    const signals = [
      { key: 'SALUD', label: 'Salud del gemelo', category: 'SALUD', value: healthScore, unit: '%', reference_value: 85, severity: healthScore < 50 ? 'CRITICAL' : healthScore < 75 ? 'WARNING' : 'INFO', helper: 'Puntaje integral del periodo' },
      { key: 'ESTADO_EQUIPO', label: 'Estado operativo del equipo', category: 'EQUIPO', value: equipmentStatePenalty >= 15 ? 100 : equipmentStatePenalty > 0 ? 55 : 15, reference_value: 15, severity: equipmentStatePenalty >= 15 ? 'CRITICAL' : equipmentStatePenalty > 0 ? 'WARNING' : 'INFO', helper: `Estado actual: ${equipment.estado_operativo || 'NO DEFINIDO'} · Criticidad ${equipment.criticidad || 'NO DEFINIDA'}` },
      { key: 'ALERTAS_CRITICAS', label: 'Alertas críticas', category: 'ALERTAS', value: metrics.critical_alerts, severity: metrics.critical_alerts > 0 ? 'CRITICAL' : 'INFO', helper: 'Alertas críticas o abiertas del equipo' },
      { key: 'OT_ABIERTAS', label: 'Órdenes abiertas', category: 'MANTENIMIENTO', value: metrics.open_work_orders, severity: metrics.open_work_orders > 0 ? 'WARNING' : 'INFO', helper: 'OT pendientes o en proceso' },
      { key: 'HORAS_PROGRAMADAS', label: 'Horas programadas mensuales', category: 'PLANIFICACION', value: metrics.planned_hours_month, unit: 'h', severity: metrics.planned_hours_month > 0 ? 'INFO' : 'WARNING', helper: 'Carga total programada en mensual' },
      { key: 'ACTIVIDADES_SEMANALES', label: 'Actividades semanales', category: 'PLANIFICACION', value: metrics.weekly_activity_count, reference_value: metrics.weekly_hours, severity: metrics.weekly_activity_count > 0 ? 'INFO' : 'WARNING', helper: 'Bloques y detalle de cronograma semanal' },
      { key: 'LUBRICANTE', label: 'Condición de lubricante', category: 'PREDICTIVO', value: lubricantState === 'ALERTA' || lubricantState === 'ANORMAL' ? 100 : lubricantState === 'OBSERVACION' || lubricantState === 'PRECAUCION' ? 65 : lubricantState === 'NORMAL' ? 20 : 0, reference_value: 20, severity: lubricantState === 'ALERTA' || lubricantState === 'ANORMAL' ? 'CRITICAL' : lubricantState === 'OBSERVACION' || lubricantState === 'PRECAUCION' ? 'WARNING' : 'INFO', helper: `Último estado: ${lubricantState}` },
      { key: 'MATCH_LUBRICANTE', label: 'Coincidencia de lubricante', category: 'PREDICTIVO', value: lubricantMatchStatus === 'NO_COINCIDE' ? 100 : lubricantMatchStatus === 'SIN_REFERENCIA' ? 45 : 10, reference_value: 10, severity: lubricantMatchStatus === 'NO_COINCIDE' ? 'CRITICAL' : lubricantMatchStatus === 'SIN_REFERENCIA' ? 'WARNING' : 'INFO', helper: `Esperado: ${equipment.codigo_lubricante || 'No definido'} · Analizado: ${this.firstText(lubricantRow?.latest_lubricant) || 'Sin análisis'}` },
      { key: 'INVENTARIO_MATERIALES', label: 'Disponibilidad de materiales', category: 'INVENTARIO', value: lowStockMaterials, reference_value: recommendedMaterials.length, severity: recommendedMaterials.some((item) => item.es_lubricante_esperado && item.stock_status !== 'DISPONIBLE') ? 'CRITICAL' : lowStockMaterials > 0 ? 'WARNING' : 'INFO', helper: `${lowStockMaterials} materiales sugeridos con stock comprometido en bodega` },
      { key: 'REPORTES_DIARIOS', label: 'Reportes diarios', category: 'OPERACION', value: metrics.daily_report_count, reference_value: metrics.operation_hours, severity: metrics.daily_report_count === 0 ? 'WARNING' : 'INFO', helper: 'Reportes operativos diarios asociados al equipo' },
      { key: 'PROGRAMACIONES_VENCIDAS', label: 'Programaciones vencidas', category: 'PLANIFICACION', value: metrics.overdue_programaciones, severity: metrics.overdue_programaciones > 0 ? 'CRITICAL' : 'INFO', helper: 'Programaciones que ya debieron ejecutarse' },
    ];

    const kpis = [
      { key: 'health_score', label: 'Salud', value: `${healthScore}%`, helper: 'Estado consolidado del gemelo digital', color: healthScore < 50 ? 'error' : healthScore < 75 ? 'warning' : 'success' },
      { key: 'risk_level', label: 'Riesgo', value: riskLevel, helper: 'Clasificación operativa del riesgo', color: riskLevel === 'ALTO' ? 'error' : riskLevel === 'MEDIO' ? 'warning' : 'success' },
      { key: 'planned_hours', label: 'Horas programadas', value: metrics.planned_hours_month, helper: 'Mensual', color: 'info' },
      { key: 'weekly_activity_count', label: 'Actividades', value: metrics.weekly_activity_count, helper: 'Cronograma semanal', color: 'secondary' },
      { key: 'recommended_materials', label: 'Materiales sugeridos', value: recommendedMaterials.length, helper: `${lowStockMaterials} con stock comprometido`, color: lowStockMaterials > 0 ? 'warning' : 'success' },
    ];

    const snapshot: TwinComputedSnapshot = {
      twin,
      period,
      equipment,
      metrics,
      lubricant: {
        latest_state: lubricantState,
        latest_report_date: lubricantRow?.latest_report_date || null,
        latest_report_code: lubricantRow?.latest_report_code || null,
        latest_lubricant: this.firstText(lubricantRow?.latest_lubricant),
        latest_lubricant_brand: this.firstText(
          lubricantRow?.latest_lubricant_brand,
        ),
        expected_lubricant_code: equipment.codigo_lubricante,
        match_status: lubricantMatchStatus,
      },
      inventory: {
        total_materials: recommendedMaterials.length,
        low_stock_materials: lowStockMaterials,
        recommended_materials: recommendedMaterials,
      },
      health_score: healthScore,
      risk_level: riskLevel,
      operational_status: operationalStatus,
      kpis,
      signals,
    };

    if (persist) {
      await this.persistSnapshot(snapshot);
    }

    return snapshot;
  }

  private async persistSnapshot(snapshot: TwinComputedSnapshot) {
    const twin = snapshot.twin;
    twin.equipment_code = snapshot.equipment.code ?? twin.equipment_code ?? null;
    twin.equipment_name =
      snapshot.equipment.display_name ?? twin.equipment_name ?? null;
    twin.equipment_model =
      snapshot.equipment.model ?? twin.equipment_model ?? null;
    twin.health_score = snapshot.health_score;
    twin.risk_level = snapshot.risk_level;
    twin.operational_status = snapshot.operational_status;
    twin.last_snapshot_at = new Date();
    twin.snapshot_json = {
      period: snapshot.period,
      equipment: snapshot.equipment,
      metrics: snapshot.metrics,
      lubricant: snapshot.lubricant,
      inventory: snapshot.inventory,
      kpis: snapshot.kpis,
    };
    twin.updated_at = new Date();
    await this.digitalTwinRepo.save(twin);

    await this.digitalTwinSignalRepo.delete({
      digital_twin_id: twin.id,
      period_year: snapshot.period.year,
      period_month: snapshot.period.month,
    });

    const signalEntities = snapshot.signals.map((signal) =>
      this.digitalTwinSignalRepo.create({
        digital_twin_id: twin.id,
        period_year: snapshot.period.year,
        period_month: snapshot.period.month,
        signal_key: signal.key,
        signal_label: signal.label,
        signal_category: signal.category,
        signal_value: signal.value,
        signal_unit: signal.unit ?? null,
        reference_value: signal.reference_value ?? null,
        severity: signal.severity,
        measured_at: new Date(),
        payload_json: { helper: signal.helper },
      }),
    );

    if (signalEntities.length) {
      await this.digitalTwinSignalRepo.save(signalEntities);
    }
  }

  private async generateAiInsight(
    snapshot: TwinComputedSnapshot,
    notes?: string,
    similarEquipment?: SimilarEquipmentSuggestion | null,
    improvementSteps: string[] = [],
  ): Promise<AiInsightPayload> {
    const apiKey = String(
      this.configService.get('DIGITAL_TWIN_AI_API_KEY') || '',
    ).trim();

    if (!snapshot.twin.ai_enabled || !apiKey) {
      return this.buildFallbackInsight(
        snapshot,
        notes,
        'SYSTEM_RULES',
        similarEquipment,
        improvementSteps,
      );
    }

    const baseUrl = String(
      this.configService.get('DIGITAL_TWIN_AI_BASE_URL') ||
        'https://api.openai.com/v1',
    ).replace(/\/$/, '');
    const model = String(
      this.configService.get('DIGITAL_TWIN_AI_MODEL') || 'gpt-4o-mini',
    ).trim();
    const timeoutMs = Number(
      this.configService.get('DIGITAL_TWIN_AI_TIMEOUT_MS') || 30000,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'Eres un analista experto en mantenimiento industrial y gemelos digitales. Responde con JSON válido con las llaves title, summary, recommendation, priority.',
            },
            {
              role: 'user',
              content: JSON.stringify(
                {
                  twin: {
                    code: snapshot.twin.code,
                    name: snapshot.twin.name,
                    equipment_code: snapshot.twin.equipment_code,
                    equipment_name: snapshot.twin.equipment_name,
                    equipment_model: snapshot.twin.equipment_model,
                  },
                  period: snapshot.period,
                  equipment: snapshot.equipment,
                  health_score: snapshot.health_score,
                  risk_level: snapshot.risk_level,
                  operational_status: snapshot.operational_status,
                  lubricant: snapshot.lubricant,
                  inventory: snapshot.inventory,
                  metrics: snapshot.metrics,
                  signals: snapshot.signals,
                  similar_equipment: similarEquipment,
                  suggested_steps: improvementSteps,
                  notes: notes ?? null,
                },
                null,
                2,
              ),
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`AI request failed with status ${response.status}`);
      }

      const json = (await response.json()) as any;
      const rawContent = String(
        json?.choices?.[0]?.message?.content || '',
      ).trim();
      const parsed = this.tryParseJsonObject(rawContent);

      if (!parsed) {
        throw new Error('AI response was not valid JSON');
      }

      const resolvedSimilarEquipment = this.resolveSimilarEquipmentPayload(
        (parsed as Record<string, unknown>).similar_equipment,
        similarEquipment,
      );
      const resolvedImprovementSteps = this.resolveImprovementStepsPayload(
        (parsed as Record<string, unknown>).improvement_steps,
        improvementSteps,
      );

      return {
        source: 'AI',
        title:
          this.firstText(parsed.title, `Gemelo ${snapshot.twin.code}`) ??
          `Gemelo ${snapshot.twin.code}`,
        summary:
          this.firstText(parsed.summary) ??
          'No se pudo construir un resumen con IA.',
        recommendation:
          this.firstText(parsed.recommendation) ??
          'Validar manualmente las señales operativas del equipo.',
        priority:
          this.firstText(parsed.priority, snapshot.risk_level) ??
          snapshot.risk_level,
        payload_json: {
          provider: 'openai-compatible',
          model,
          notes: notes ?? null,
          equipment: snapshot.equipment,
          inventory: snapshot.inventory,
          recommended_materials: snapshot.inventory.recommended_materials,
          similar_equipment: resolvedSimilarEquipment,
          improvement_steps: resolvedImprovementSteps,
          raw: rawContent,
        },
      };
    } catch {
      return this.buildFallbackInsight(
        snapshot,
        notes,
        'SYSTEM_FALLBACK',
        similarEquipment,
        improvementSteps,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private buildFallbackInsight(
    snapshot: TwinComputedSnapshot,
    notes: string | undefined,
    source: string,
    similarEquipment?: SimilarEquipmentSuggestion | null,
    improvementSteps: string[] = [],
  ): AiInsightPayload {
    const hasCriticalCondition =
      snapshot.metrics.critical_alerts > 0 ||
      snapshot.metrics.overdue_programaciones > 0 ||
      snapshot.lubricant.latest_state === 'ALERTA' ||
      snapshot.lubricant.latest_state === 'ANORMAL' ||
      snapshot.lubricant.match_status === 'NO_COINCIDE' ||
      snapshot.inventory.recommended_materials.some(
        (item) =>
          item.es_lubricante_esperado && item.stock_status !== 'DISPONIBLE',
      );

    const title = hasCriticalCondition
      ? `Intervención prioritaria para ${snapshot.twin.equipment_code || snapshot.twin.code}`
      : `Seguimiento operativo para ${snapshot.twin.equipment_code || snapshot.twin.code}`;

    const summary = hasCriticalCondition
      ? `El gemelo digital detecta ${snapshot.metrics.critical_alerts} alertas críticas, ${snapshot.metrics.overdue_programaciones} programaciones vencidas y estado de salud ${snapshot.health_score}%.`
      : `El gemelo digital mantiene un comportamiento ${snapshot.operational_status.toLowerCase()} con salud ${snapshot.health_score}% y riesgo ${snapshot.risk_level.toLowerCase()}.`;

    const recommendation = hasCriticalCondition
      ? `Prioriza atención sobre el equipo, revisa lubricación (${snapshot.lubricant.latest_state}), cierra OT abiertas (${snapshot.metrics.open_work_orders}) y reprograma ${snapshot.metrics.overdue_programaciones} mantenimientos vencidos.`
      : `Mantén el monitoreo del equipo, confirma la ejecución de ${snapshot.metrics.weekly_activity_count} actividades semanales y consolida ${snapshot.metrics.planned_hours_month} horas planificadas del mes.`;

    const resolvedSteps = improvementSteps.length
      ? improvementSteps
      : this.buildImprovementSteps(snapshot, similarEquipment, notes);

    return {
      source,
      title,
      summary,
      recommendation: notes
        ? `${recommendation} Nota del usuario: ${notes}`
        : recommendation,
      priority: hasCriticalCondition ? 'ALTA' : 'MEDIA',
      payload_json: {
        generated_with: source,
        notes: notes ?? null,
        equipment: snapshot.equipment,
        inventory: snapshot.inventory,
        recommended_materials: snapshot.inventory.recommended_materials,
        similar_equipment: similarEquipment ?? null,
        improvement_steps: resolvedSteps,
      },
    };
  }

  private async findSimilarEquipment(
    snapshot: TwinComputedSnapshot,
  ): Promise<SimilarEquipmentSuggestion | null> {
    const equipmentId = snapshot.twin.equipment_id ?? null;
    const equipmentCode = this.firstText(snapshot.equipment.code);
    const equipmentModel = this.firstText(snapshot.equipment.model);
    const realName = this.firstText(snapshot.equipment.real_name);
    const lubricantCode = this.firstText(snapshot.equipment.codigo_lubricante);

    const candidateFromEquipment = this.firstRow(
      await this.dataSource.query(
        `
          with current_equipment as (
            select e.id, e.codigo, e.nombre, e.nombre_real, e.equipo_tipo_id, e.marca_id, e.modelo, e.codigo_lubricante, e.estado_operativo
            from kpi_maintenance.tb_equipo e
            where e.is_deleted = false
              and (
                ($1::uuid is not null and e.id = $1::uuid)
                or ($2::text is not null and upper(e.codigo) = upper($2::text))
              )
            limit 1
          )
          select
            dt.id as twin_id,
            dt.code as twin_code,
            e.id as equipment_id,
            e.codigo as equipment_code,
            coalesce(e.nombre_real, e.nombre) as equipment_name,
            coalesce(e.modelo, dt.equipment_model, $3::text, '') as equipment_model,
            dt.health_score,
            dt.risk_level,
            dt.operational_status,
            case
              when $3::text is not null and trim($3::text) <> '' and upper(coalesce(e.modelo, dt.equipment_model, '')) = upper($3::text)
                and $5::text is not null and trim($5::text) <> '' and upper(coalesce(e.codigo_lubricante, '')) = upper($5::text) then 'Mismo modelo y código de lubricante'
              when $3::text is not null and trim($3::text) <> '' and upper(coalesce(e.modelo, dt.equipment_model, '')) = upper($3::text) then 'Mismo modelo operativo'
              when $4::text is not null and trim($4::text) <> '' and upper(coalesce(e.nombre_real, e.nombre, '')) = upper($4::text) then 'Mismo nombre real de referencia'
              when e.equipo_tipo_id = ce.equipo_tipo_id and e.marca_id = ce.marca_id then 'Mismo tipo y marca'
              when e.equipo_tipo_id = ce.equipo_tipo_id then 'Mismo tipo de equipo'
              else 'Equipo comparable por operación'
            end as similarity_reason
          from current_equipment ce
          inner join kpi_maintenance.tb_equipo e
            on e.is_deleted = false
           and e.id <> ce.id
          left join kpi_process.tb_digital_twin dt
            on dt.equipment_id = e.id
           and dt.is_deleted = false
           and upper(coalesce(dt.status, 'ACTIVE')) = 'ACTIVE'
          where
            (
              ($3::text is not null and trim($3::text) <> '' and upper(coalesce(e.modelo, dt.equipment_model, '')) = upper($3::text))
              or ($5::text is not null and trim($5::text) <> '' and upper(coalesce(e.codigo_lubricante, '')) = upper($5::text))
              or e.equipo_tipo_id = ce.equipo_tipo_id
            )
          order by
            case when $3::text is not null and trim($3::text) <> '' and upper(coalesce(e.modelo, dt.equipment_model, '')) = upper($3::text) then 0 else 1 end,
            case when $5::text is not null and trim($5::text) <> '' and upper(coalesce(e.codigo_lubricante, '')) = upper($5::text) then 0 else 1 end,
            case when e.marca_id = ce.marca_id then 0 else 1 end,
            case when dt.id is not null then 0 else 1 end,
            coalesce(dt.health_score, 0) desc,
            e.codigo asc
          limit 1
        `,
        [equipmentId, equipmentCode, equipmentModel, realName, lubricantCode],
      ),
    );

    if (candidateFromEquipment) {
      return {
        twin_id: candidateFromEquipment.twin_id ?? null,
        twin_code: candidateFromEquipment.twin_code ?? null,
        equipment_id: candidateFromEquipment.equipment_id ?? null,
        equipment_code: candidateFromEquipment.equipment_code ?? null,
        equipment_name: candidateFromEquipment.equipment_name ?? null,
        equipment_model: candidateFromEquipment.equipment_model ?? null,
        health_score:
          candidateFromEquipment.health_score != null
            ? this.toNumber(candidateFromEquipment.health_score)
            : null,
        risk_level: candidateFromEquipment.risk_level ?? null,
        operational_status: candidateFromEquipment.operational_status ?? null,
        similarity_reason:
          this.firstText(candidateFromEquipment.similarity_reason) ??
          'Equipo comparable por operación',
      };
    }

    if (!equipmentModel) {
      return null;
    }

    const candidateFromTwins = this.firstRow(
      await this.dataSource.query(
        `
          select
            dt.id as twin_id,
            dt.code as twin_code,
            dt.equipment_id,
            dt.equipment_code,
            dt.equipment_name,
            dt.equipment_model,
            dt.health_score,
            dt.risk_level,
            dt.operational_status
          from kpi_process.tb_digital_twin dt
          where dt.is_deleted = false
            and dt.id <> $1::uuid
            and upper(coalesce(dt.equipment_model, '')) = upper($2::text)
          order by dt.health_score desc, dt.updated_at desc
          limit 1
        `,
        [snapshot.twin.id, equipmentModel],
      ),
    );

    if (!candidateFromTwins) {
      return null;
    }

    return {
      twin_id: candidateFromTwins.twin_id ?? null,
      twin_code: candidateFromTwins.twin_code ?? null,
      equipment_id: candidateFromTwins.equipment_id ?? null,
      equipment_code: candidateFromTwins.equipment_code ?? null,
      equipment_name: candidateFromTwins.equipment_name ?? null,
      equipment_model: candidateFromTwins.equipment_model ?? null,
      health_score:
        candidateFromTwins.health_score != null
          ? this.toNumber(candidateFromTwins.health_score)
          : null,
      risk_level: candidateFromTwins.risk_level ?? null,
      operational_status: candidateFromTwins.operational_status ?? null,
      similarity_reason: 'Mismo modelo operativo',
    };
  }

  private buildImprovementSteps(
    snapshot: TwinComputedSnapshot,
    similarEquipment?: SimilarEquipmentSuggestion | null,
    notes?: string,
  ) {
    const steps: string[] = [];

    if (snapshot.metrics.critical_alerts > 0) {
      steps.push(
        `Atender ${snapshot.metrics.critical_alerts} alertas críticas activas y priorizar su cierre operativo.`,
      );
    }

    if (snapshot.metrics.overdue_programaciones > 0) {
      steps.push(
        `Regularizar ${snapshot.metrics.overdue_programaciones} programaciones vencidas y replanificar su ejecución inmediata.`,
      );
    }

    if (snapshot.metrics.open_work_orders > 0) {
      steps.push(
        `Revisar y cerrar ${snapshot.metrics.open_work_orders} órdenes de trabajo abiertas para estabilizar el equipo.`,
      );
    }

    if (
      snapshot.lubricant.latest_state === 'ALERTA' ||
      snapshot.lubricant.latest_state === 'ANORMAL' ||
      snapshot.lubricant.latest_state === 'PRECAUCION' ||
      snapshot.lubricant.latest_state === 'OBSERVACION'
    ) {
      steps.push(
        `Ejecutar revisión predictiva del sistema de lubricación; último estado reportado: ${snapshot.lubricant.latest_state}.`,
      );
    }

    if (snapshot.lubricant.match_status === 'NO_COINCIDE') {
      steps.push(
        `Verificar el lubricante aplicado. El equipo espera ${snapshot.lubricant.expected_lubricant_code || 'un código definido'} y el último análisis reporta ${snapshot.lubricant.latest_lubricant || 'otro lubricante'}.`,
      );
    }

    if (snapshot.inventory.low_stock_materials > 0) {
      const suggested = snapshot.inventory.recommended_materials
        .filter((item) => item.stock_status !== 'DISPONIBLE')
        .slice(0, 2)
        .map((item) =>
          [item.codigo, item.nombre, item.bodega_sugerida?.codigo || item.bodega_sugerida?.nombre]
            .filter(Boolean)
            .join(' · '),
        );
      steps.push(
        `Asegurar abastecimiento de materiales críticos${suggested.length ? `: ${suggested.join('; ')}` : ''}.`,
      );
    }

    if (
      snapshot.metrics.daily_report_count === 0 &&
      (snapshot.metrics.planned_hours_month > 0 ||
        snapshot.metrics.weekly_activity_count > 0)
    ) {
      steps.push(
        'Validar la captura de reportes diarios de operación para asegurar trazabilidad del período.',
      );
    }

    if (snapshot.metrics.planned_hours_month > snapshot.metrics.operation_hours) {
      steps.push(
        `Alinear la ejecución real con las ${snapshot.metrics.planned_hours_month} horas programadas del mes y verificar desviaciones.`,
      );
    }

    if (similarEquipment?.equipment_code || similarEquipment?.equipment_name) {
      const target = [
        similarEquipment.equipment_code,
        similarEquipment.equipment_name,
      ]
        .filter(Boolean)
        .join(' · ');
      steps.push(
        `Comparar estrategia operativa y mantenimiento con ${target} para replicar prácticas que mejoren salud y disponibilidad.`,
      );
    }

    if (notes) {
      steps.push(`Considerar la observación del usuario al ejecutar mejoras: ${notes}.`);
    }

    return Array.from(new Set(steps)).filter(Boolean).slice(0, 6);
  }

  private resolveSimilarEquipmentPayload(
    value: unknown,
    fallback?: SimilarEquipmentSuggestion | null,
  ): SimilarEquipmentSuggestion | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return fallback ?? null;
    }

    const payload = value as Record<string, unknown>;
    const equipmentCode = this.firstText(payload.equipment_code);
    const equipmentName = this.firstText(payload.equipment_name);

    if (!equipmentCode && !equipmentName) {
      return fallback ?? null;
    }

    return {
      twin_id: this.firstText(payload.twin_id, fallback?.twin_id),
      twin_code: this.firstText(payload.twin_code, fallback?.twin_code),
      equipment_id: this.firstText(payload.equipment_id, fallback?.equipment_id),
      equipment_code: this.firstText(equipmentCode, fallback?.equipment_code),
      equipment_name: this.firstText(equipmentName, fallback?.equipment_name),
      equipment_model: this.firstText(
        payload.equipment_model,
        fallback?.equipment_model,
      ),
      health_score:
        payload.health_score != null
          ? this.toNumber(payload.health_score)
          : fallback?.health_score ?? null,
      risk_level: this.firstText(payload.risk_level, fallback?.risk_level),
      operational_status: this.firstText(
        payload.operational_status,
        fallback?.operational_status,
      ),
      similarity_reason:
        this.firstText(payload.similarity_reason, fallback?.similarity_reason) ??
        'Equipo comparable por operación',
    };
  }

  private resolveImprovementStepsPayload(
    value: unknown,
    fallback: string[] = [],
  ) {
    if (!Array.isArray(value)) {
      return fallback;
    }

    const normalized = value
      .map((item) => this.firstText(item))
      .filter((item): item is string => Boolean(item));

    return normalized.length ? normalized : fallback;
  }

  private resolvePeriod(year?: number, month?: number): DashboardPeriod {
    const now = new Date();
    const resolvedYear = Number.isFinite(Number(year))
      ? Number(year)
      : now.getFullYear();
    const resolvedMonth =
      Number.isFinite(Number(month)) && Number(month) >= 1 && Number(month) <= 12
        ? Number(month)
        : now.getMonth() + 1;

    const start = new Date(Date.UTC(resolvedYear, resolvedMonth - 1, 1));
    const end = new Date(Date.UTC(resolvedYear, resolvedMonth, 0));

    return {
      year: resolvedYear,
      month: resolvedMonth,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      label: `${MONTH_LABELS[resolvedMonth - 1]} ${resolvedYear}`,
    };
  }

  private async resolveDigitalTwinCode(requested?: string) {
    const desired = String(requested || '').trim();
    if (desired) {
      const existing = await this.digitalTwinRepo.findOne({
        where: { code: desired, is_deleted: false },
      });
      if (!existing) return desired;
    }

    const rows = await this.dataSource.query(
      `
        select code
        from kpi_process.tb_digital_twin
        where code like 'DT-A%'
        order by code desc
        limit 1
      `,
    );
    const lastCode = String(rows?.[0]?.code || 'DT-A00000');
    const nextNumber = Number(lastCode.replace(/^DT-A/, '')) + 1;
    return `DT-A${String(nextNumber).padStart(5, '0')}`;
  }

  private async findDigitalTwinOrFail(id: string) {
    const item = await this.digitalTwinRepo.findOne({
      where: { id, is_deleted: false },
    });
    if (!item) {
      throw new NotFoundException(`Gemelo digital ${id} no encontrado`);
    }
    return item;
  }

  private async resolveEquipmentReference(equipmentId?: string) {
    const normalized = String(equipmentId || '').trim();
    if (!normalized) return null;
    const rows = await this.dataSource.query(
      `
        select
          e.id,
          e.codigo,
          e.nombre,
          e.nombre_real,
          e.modelo,
          e.codigo_lubricante,
          e.criticidad,
          e.estado_operativo,
          coalesce(m.nombre, '') as marca_nombre
        from kpi_maintenance.tb_equipo e
        left join kpi_inventory.tb_marca m on m.id = e.marca_id
        where e.id = $1 and e.is_deleted = false
        limit 1
      `,
      [normalized],
    );
    return rows?.[0] ?? null;
  }

  private async queryCurrentEquipmentHours(equipmentId?: string | null) {
    const normalized = String(equipmentId || '').trim();
    if (!normalized) return 0;
    const rows = await this.dataSource.query(
      `
        select coalesce(horometro_actual, 0) as horometro_actual
        from kpi_maintenance.tb_equipo
        where id = $1 and is_deleted = false
        limit 1
      `,
      [normalized],
    );
    return this.toNumber(rows?.[0]?.horometro_actual);
  }

  private async queryAlertMetrics(
    equipmentId: string | null,
    equipmentCode: string | null,
    period: DashboardPeriod,
  ) {
    return this.firstRow(
      await this.dataSource.query(
        `
          select
            count(*) filter (
              where upper(coalesce(a.nivel, '')) = 'CRITICAL'
                and upper(coalesce(a.estado, 'ABIERTA')) in ('ABIERTA', 'EN_PROCESO')
            ) as critical_alerts,
            count(*) filter (
              where upper(coalesce(a.estado, 'ABIERTA')) in ('ABIERTA', 'EN_PROCESO')
            ) as open_alerts
          from kpi_maintenance.tb_alerta_mantenimiento a
          where a.is_deleted = false
            and a.fecha_generada::date between $3 and $4
            and (
              ($1::uuid is not null and a.equipo_id = $1::uuid)
              or ($2::text is not null and upper(coalesce(a.payload_json->>'equipo_codigo', '')) = upper($2::text))
            )
        `,
        [equipmentId, equipmentCode, period.startDate, period.endDate],
      ),
    );
  }

  private async queryWorkOrderMetrics(
    equipmentId: string | null,
    period: DashboardPeriod,
  ) {
    if (!equipmentId) return null;
    return this.firstRow(
      await this.dataSource.query(
        `
          select
            count(*) filter (
              where upper(coalesce(status_workflow, '')) not in ('CLOSED', 'CERRADA', 'CERRADO', 'DONE', 'COMPLETED')
            ) as open_orders,
            count(*) filter (
              where upper(coalesce(status_workflow, '')) in ('CLOSED', 'CERRADA', 'CERRADO', 'DONE', 'COMPLETED')
            ) as closed_orders
          from kpi_process.tb_work_order
          where is_deleted = false
            and equipment_id = $1::uuid
            and coalesce(scheduled_start::date, started_at::date, closed_at::date) between $2 and $3
        `,
        [equipmentId, period.startDate, period.endDate],
      ),
    );
  }

  private async queryMonthlyProgramMetrics(
    equipmentId: string | null,
    equipmentCode: string | null,
    period: DashboardPeriod,
  ) {
    return this.firstRow(
      await this.dataSource.query(
        `
          select
            coalesce(
              sum(
                case
                  when trim(coalesce(valor_normalizado, '')) ~ '^-?[0-9]+(\.[0-9]+)?$'
                    then trim(valor_normalizado)::numeric
                  when trim(coalesce(valor_crudo, '')) ~ '^-?[0-9]+(\.[0-9]+)?$'
                    then trim(valor_crudo)::numeric
                  else 0
                end
              ),
              0
            ) as planned_hours
          from kpi_maintenance.tb_programacion_mensual_det d
          where d.is_deleted = false
            and d.fecha_programada between $3 and $4
            and (
              ($1::uuid is not null and d.equipo_id = $1::uuid)
              or ($2::text is not null and upper(d.equipo_codigo) = upper($2::text))
            )
        `,
        [equipmentId, equipmentCode, period.startDate, period.endDate],
      ),
    );
  }

  private async queryWeeklyScheduleMetrics(
    equipmentCode: string | null,
    period: DashboardPeriod,
  ) {
    if (!equipmentCode) return null;
    return this.firstRow(
      await this.dataSource.query(
        `
          select
            count(*) as activity_count,
            coalesce(
              sum(
                case
                  when d.hora_inicio is not null and d.hora_fin is not null
                    then extract(epoch from (d.hora_fin::time - d.hora_inicio::time)) / 3600
                  else 0
                end
              ),
              0
            ) as total_hours
          from kpi_maintenance.tb_cronograma_semanal_det d
          where d.is_deleted = false
            and coalesce(d.fecha_actividad, current_date) between $2 and $3
            and upper(coalesce(d.equipo_codigo, '')) = upper($1::text)
        `,
        [equipmentCode, period.startDate, period.endDate],
      ),
    );
  }

  private async queryLubricantMetrics(
    equipmentId: string | null,
    equipmentCode: string | null,
    period: DashboardPeriod,
  ) {
    return this.firstRow(
      await this.dataSource.query(
        `
          with filtered as (
            select *
            from kpi_maintenance.tb_analisis_lubricante a
            where a.is_deleted = false
              and coalesce(a.fecha_reporte, a.fecha_muestra) <= $3
              and (
                ($1::uuid is not null and a.equipo_id = $1::uuid)
                or ($2::text is not null and upper(coalesce(a.equipo_codigo, '')) = upper($2::text))
              )
          ),
          latest as (
            select *
            from filtered
            order by coalesce(fecha_reporte, fecha_muestra) desc, created_at desc
            limit 1
          )
          select
            (select count(*) from filtered where coalesce(fecha_reporte, fecha_muestra) between $4 and $3) as sample_count,
            coalesce((select estado_diagnostico from latest), 'SIN_ANALISIS') as latest_state,
            (select coalesce(fecha_reporte, fecha_muestra)::text from latest) as latest_report_date,
            (select codigo from latest) as latest_report_code,
            (select lubricante from latest) as latest_lubricant,
            (select marca_lubricante from latest) as latest_lubricant_brand
        `,
        [equipmentId, equipmentCode, period.endDate, period.startDate],
      ),
    );
  }

  private async queryDailyReportMetrics(
    equipmentId: string | null,
    equipmentCode: string | null,
    period: DashboardPeriod,
  ) {
    return this.firstRow(
      await this.dataSource.query(
        `
          select
            count(*) as report_count,
            coalesce(sum(coalesce(u.horas_operacion, 0)), 0) as operation_hours
          from kpi_maintenance.tb_reporte_operacion_diaria_unidad u
          inner join kpi_maintenance.tb_reporte_operacion_diaria r on r.id = u.reporte_id
          where u.is_deleted = false
            and r.is_deleted = false
            and r.fecha_reporte between $3 and $4
            and (
              ($1::uuid is not null and u.equipo_id = $1::uuid)
              or ($2::text is not null and upper(u.equipo_codigo) = upper($2::text))
            )
        `,
        [equipmentId, equipmentCode, period.startDate, period.endDate],
      ),
    );
  }

  private async queryOverdueProgramaciones(
    equipmentId: string | null,
    period: DashboardPeriod,
    currentHours: number,
  ) {
    if (!equipmentId) return null;
    return this.firstRow(
      await this.dataSource.query(
        `
          select
            count(*) filter (
              where (
                (p.proxima_fecha is not null and p.proxima_fecha <= $2)
                or (p.proxima_horas is not null and p.proxima_horas <= $3)
              )
            ) as overdue_count
          from kpi_maintenance.tb_programacion_plan p
          where p.is_deleted = false
            and p.activo = true
            and p.equipo_id = $1::uuid
        `,
        [equipmentId, period.endDate, currentHours],
      ),
    );
  }

  private resolveLubricantMatchStatus(
    expectedLubricantCode?: unknown,
    actualLubricant?: unknown,
  ) {
    const expected = this.normalizeToken(expectedLubricantCode);
    const actual = this.normalizeToken(actualLubricant);
    if (!expected) return 'SIN_REFERENCIA';
    if (!actual) return 'SIN_ANALISIS';
    if (expected === actual || expected.includes(actual) || actual.includes(expected)) {
      return 'COINCIDE';
    }
    return 'NO_COINCIDE';
  }

  private async queryMaterialRecommendations(
    equipmentId: string | null,
    expectedLubricantCode?: string | null,
  ): Promise<TwinMaterialRecommendation[]> {
    const materialMap = new Map<
      string,
      {
        producto_id: string | null;
        codigo: string | null;
        nombre: string | null;
        consumo_total: number;
        movimientos: number;
        costo_referencia: number;
        es_lubricante_esperado: boolean;
      }
    >();

    if (equipmentId) {
      const usageRows = await this.dataSource.query(
        `
          select
            p.id as producto_id,
            p.codigo,
            p.nombre,
            coalesce(sum(cr.cantidad), 0) as consumo_total,
            count(*) as movimientos,
            coalesce(max(cr.costo_unitario), 0) as costo_referencia
          from kpi_maintenance.tb_consumo_repuesto cr
          inner join kpi_process.tb_work_order wo
            on wo.id = cr.work_order_id
           and wo.is_deleted = false
          inner join kpi_inventory.tb_producto p
            on p.id = cr.producto_id
           and p.is_deleted = false
          where cr.is_deleted = false
            and wo.equipment_id = $1::uuid
          group by p.id, p.codigo, p.nombre
          order by coalesce(sum(cr.cantidad), 0) desc, count(*) desc, p.nombre asc
          limit 8
        `,
        [equipmentId],
      );

      for (const row of usageRows) {
        materialMap.set(String(row.producto_id), {
          producto_id: row.producto_id ?? null,
          codigo: this.firstText(row.codigo),
          nombre: this.firstText(row.nombre),
          consumo_total: this.toNumber(row.consumo_total),
          movimientos: this.toNumber(row.movimientos),
          costo_referencia: this.toNumber(row.costo_referencia),
          es_lubricante_esperado: false,
        });
      }
    }

    const expectedLubricant = this.firstText(expectedLubricantCode);
    if (expectedLubricant) {
      const lubricantRows = await this.dataSource.query(
        `
          select
            p.id as producto_id,
            p.codigo,
            p.nombre,
            coalesce(p.costo_promedio, 0) as costo_referencia
          from kpi_inventory.tb_producto p
          where p.is_deleted = false
            and (
              upper(coalesce(p.codigo, '')) = upper($1::text)
              or upper(coalesce(p.nombre, '')) like ('%' || upper($1::text) || '%')
            )
          order by
            case when upper(coalesce(p.codigo, '')) = upper($1::text) then 0 else 1 end,
            p.nombre asc
          limit 5
        `,
        [expectedLubricant],
      );

      for (const row of lubricantRows) {
        const key = String(row.producto_id);
        const current = materialMap.get(key);
        materialMap.set(key, {
          producto_id: row.producto_id ?? null,
          codigo: this.firstText(row.codigo),
          nombre: this.firstText(row.nombre),
          consumo_total: current?.consumo_total ?? 0,
          movimientos: current?.movimientos ?? 0,
          costo_referencia: current?.costo_referencia ?? this.toNumber(row.costo_referencia),
          es_lubricante_esperado: true,
        });
      }
    }

    const materials = Array.from(materialMap.values());
    if (!materials.length) {
      return [];
    }

    const productIds = materials
      .map((item) => item.producto_id)
      .filter((item): item is string => Boolean(item));

    const stockRows = await this.dataSource.query(
      `
        select
          sb.producto_id,
          sb.bodega_id,
          b.codigo as bodega_codigo,
          b.nombre as bodega_nombre,
          coalesce(sb.stock_actual, 0) as stock_actual,
          coalesce(sb.stock_min_bodega, 0) as stock_min_bodega,
          coalesce(sb.stock_max_bodega, 0) as stock_max_bodega,
          coalesce(sb.costo_promedio_bodega, 0) as costo_promedio_bodega
        from kpi_inventory.tb_stock_bodega sb
        inner join kpi_inventory.tb_bodega b
          on b.id = sb.bodega_id
         and b.is_deleted = false
        where sb.is_deleted = false
          and sb.producto_id = any($1::uuid[])
      `,
      [productIds],
    );

    const stockByProduct = new Map<string, TwinInventoryWarehouse[]>();

    for (const row of stockRows) {
      const productId = String(row.producto_id);
      const warehouse: TwinInventoryWarehouse = {
        bodega_id: row.bodega_id ?? null,
        codigo: this.firstText(row.bodega_codigo),
        nombre: this.firstText(row.bodega_nombre),
        stock_actual: this.toNumber(row.stock_actual),
        stock_min_bodega: this.toNumber(row.stock_min_bodega),
        stock_max_bodega: this.toNumber(row.stock_max_bodega),
        costo_promedio_bodega: this.toNumber(row.costo_promedio_bodega),
        estado_stock:
          this.toNumber(row.stock_actual) <= 0
            ? 'SIN_STOCK'
            : this.toNumber(row.stock_min_bodega) > 0 &&
                this.toNumber(row.stock_actual) <= this.toNumber(row.stock_min_bodega)
              ? 'BAJO_MINIMO'
              : 'DISPONIBLE',
      };
      const current = stockByProduct.get(productId) ?? [];
      current.push(warehouse);
      stockByProduct.set(productId, current);
    }

    return materials
      .map((material) => {
        const warehouses = (stockByProduct.get(String(material.producto_id)) ?? [])
          .slice()
          .sort((a, b) => b.stock_actual - a.stock_actual);
        const stockTotal = Number(
          warehouses
            .reduce((sum, warehouse) => sum + warehouse.stock_actual, 0)
            .toFixed(2),
        );
        const lowStockBodegas = warehouses.filter(
          (warehouse) => warehouse.estado_stock !== 'DISPONIBLE',
        ).length;
        const stockStatus =
          stockTotal <= 0
            ? 'SIN_STOCK'
            : lowStockBodegas > 0
              ? 'BAJO_MINIMO'
              : 'DISPONIBLE';
        return {
          ...material,
          stock_total: stockTotal,
          low_stock_bodegas: lowStockBodegas,
          stock_status: stockStatus,
          bodega_sugerida: warehouses[0] ?? null,
          bodegas: warehouses.slice(0, 5),
        };
      })
      .sort((left, right) => {
        if (left.es_lubricante_esperado !== right.es_lubricante_esperado) {
          return left.es_lubricante_esperado ? -1 : 1;
        }
        if (left.stock_status !== right.stock_status) {
          const order = ['DISPONIBLE', 'BAJO_MINIMO', 'SIN_STOCK'];
          return order.indexOf(left.stock_status) - order.indexOf(right.stock_status);
        }
        if (left.consumo_total !== right.consumo_total) {
          return right.consumo_total - left.consumo_total;
        }
        return String(left.nombre || '').localeCompare(String(right.nombre || ''));
      })
      .slice(0, 8);
  }

  private normalizeToken(value: unknown) {
    return String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');
  }

  private firstText(...values: Array<unknown>) {
    for (const value of values) {
      const normalized = String(value ?? '').trim();
      if (normalized) return normalized;
    }
    return null;
  }

  private firstRow(rows: any[]) {
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  private toNumber(value: unknown) {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  private tryParseJsonObject(value: string) {
    const normalized = String(value || '')
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    try {
      return JSON.parse(normalized) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
