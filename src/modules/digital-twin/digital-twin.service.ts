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

type TwinComputedSnapshot = {
  twin: DigitalTwin;
  period: DashboardPeriod;
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
      name: String(dto.name || equipment?.nombre || equipment?.codigo || '').trim(),
      equipment_id: dto.equipment_id ?? null,
      equipment_code: this.firstText(dto.equipment_code, equipment?.codigo),
      equipment_name: this.firstText(dto.equipment_name, equipment?.nombre),
      equipment_model: this.firstText(dto.equipment_model),
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
      equipment?.nombre,
      current.equipment_name,
    );
    current.equipment_model = this.firstText(dto.equipment_model, current.equipment_model);
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
      where += ` and (e.codigo ilike $1 or e.nombre ilike $1)`;
    }

    const rows = await this.dataSource.query(
      `
        select
          e.id,
          e.codigo,
          e.nombre,
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
    const insightPayload = await this.generateAiInsight(snapshot, payload.notes);

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
    const equipmentCode = String(twin.equipment_code || '').trim() || null;
    const currentHours = await this.queryCurrentEquipmentHours(equipmentId);

    const [
      alertsRow,
      workOrdersRow,
      monthlyProgramRow,
      weeklyScheduleRow,
      lubricantRow,
      dailyRow,
      overdueRow,
    ] = await Promise.all([
      this.queryAlertMetrics(equipmentId, equipmentCode, period),
      this.queryWorkOrderMetrics(equipmentId, period),
      this.queryMonthlyProgramMetrics(equipmentId, equipmentCode, period),
      this.queryWeeklyScheduleMetrics(equipmentCode, period),
      this.queryLubricantMetrics(equipmentId, equipmentCode, period),
      this.queryDailyReportMetrics(equipmentId, equipmentCode, period),
      this.queryOverdueProgramaciones(equipmentId, period, currentHours),
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
    const lubricantPenalty =
      lubricantState === 'ALERTA' || lubricantState === 'ANORMAL'
        ? 20
        : lubricantState === 'OBSERVACION' || lubricantState === 'PRECAUCION'
          ? 10
          : 0;

    let healthScore =
      100 -
      metrics.critical_alerts * 12 -
      metrics.open_alerts * 4 -
      metrics.open_work_orders * 5 -
      metrics.overdue_programaciones * 10 -
      lubricantPenalty;

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
      healthScore < 50
        ? 'ALTO'
        : metrics.open_alerts > 0 ||
            metrics.open_work_orders > 0 ||
            lubricantPenalty > 0 ||
            healthScore < 75
          ? 'MEDIO'
          : 'BAJO';

    const operationalStatus =
      metrics.critical_alerts > 0 || metrics.overdue_programaciones > 0
        ? 'CRITICO'
        : lubricantPenalty > 0 || metrics.open_work_orders > 0
          ? 'EN_OBSERVACION'
          : 'ESTABLE';

    const signals = [
      { key: 'SALUD', label: 'Salud del gemelo', category: 'SALUD', value: healthScore, unit: '%', reference_value: 85, severity: healthScore < 50 ? 'CRITICAL' : healthScore < 75 ? 'WARNING' : 'INFO', helper: 'Puntaje integral del periodo' },
      { key: 'ALERTAS_CRITICAS', label: 'Alertas críticas', category: 'ALERTAS', value: metrics.critical_alerts, severity: metrics.critical_alerts > 0 ? 'CRITICAL' : 'INFO', helper: 'Alertas críticas o abiertas del equipo' },
      { key: 'OT_ABIERTAS', label: 'Órdenes abiertas', category: 'MANTENIMIENTO', value: metrics.open_work_orders, severity: metrics.open_work_orders > 0 ? 'WARNING' : 'INFO', helper: 'OT pendientes o en proceso' },
      { key: 'HORAS_PROGRAMADAS', label: 'Horas programadas mensuales', category: 'PLANIFICACION', value: metrics.planned_hours_month, unit: 'h', severity: metrics.planned_hours_month > 0 ? 'INFO' : 'WARNING', helper: 'Carga total programada en mensual' },
      { key: 'ACTIVIDADES_SEMANALES', label: 'Actividades semanales', category: 'PLANIFICACION', value: metrics.weekly_activity_count, reference_value: metrics.weekly_hours, severity: metrics.weekly_activity_count > 0 ? 'INFO' : 'WARNING', helper: 'Bloques y detalle de cronograma semanal' },
      { key: 'LUBRICANTE', label: 'Condición de lubricante', category: 'PREDICTIVO', value: lubricantState === 'ALERTA' || lubricantState === 'ANORMAL' ? 100 : lubricantState === 'OBSERVACION' || lubricantState === 'PRECAUCION' ? 65 : lubricantState === 'NORMAL' ? 20 : 0, reference_value: 20, severity: lubricantState === 'ALERTA' || lubricantState === 'ANORMAL' ? 'CRITICAL' : lubricantState === 'OBSERVACION' || lubricantState === 'PRECAUCION' ? 'WARNING' : 'INFO', helper: `Último estado: ${lubricantState}` },
      { key: 'REPORTES_DIARIOS', label: 'Reportes diarios', category: 'OPERACION', value: metrics.daily_report_count, reference_value: metrics.operation_hours, severity: metrics.daily_report_count === 0 ? 'WARNING' : 'INFO', helper: 'Reportes operativos diarios asociados al equipo' },
      { key: 'PROGRAMACIONES_VENCIDAS', label: 'Programaciones vencidas', category: 'PLANIFICACION', value: metrics.overdue_programaciones, severity: metrics.overdue_programaciones > 0 ? 'CRITICAL' : 'INFO', helper: 'Programaciones que ya debieron ejecutarse' },
    ];

    const kpis = [
      { key: 'health_score', label: 'Salud', value: `${healthScore}%`, helper: 'Estado consolidado del gemelo digital', color: healthScore < 50 ? 'error' : healthScore < 75 ? 'warning' : 'success' },
      { key: 'risk_level', label: 'Riesgo', value: riskLevel, helper: 'Clasificación operativa del riesgo', color: riskLevel === 'ALTO' ? 'error' : riskLevel === 'MEDIO' ? 'warning' : 'success' },
      { key: 'planned_hours', label: 'Horas programadas', value: metrics.planned_hours_month, helper: 'Mensual', color: 'info' },
      { key: 'weekly_activity_count', label: 'Actividades', value: metrics.weekly_activity_count, helper: 'Cronograma semanal', color: 'secondary' },
    ];

    const snapshot: TwinComputedSnapshot = {
      twin,
      period,
      metrics,
      lubricant: {
        latest_state: lubricantState,
        latest_report_date: lubricantRow?.latest_report_date || null,
        latest_report_code: lubricantRow?.latest_report_code || null,
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
    twin.health_score = snapshot.health_score;
    twin.risk_level = snapshot.risk_level;
    twin.operational_status = snapshot.operational_status;
    twin.last_snapshot_at = new Date();
    twin.snapshot_json = {
      period: snapshot.period,
      metrics: snapshot.metrics,
      lubricant: snapshot.lubricant,
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
  ): Promise<AiInsightPayload> {
    const apiKey = String(
      this.configService.get('DIGITAL_TWIN_AI_API_KEY') || '',
    ).trim();

    if (!snapshot.twin.ai_enabled || !apiKey) {
      return this.buildFallbackInsight(snapshot, notes, 'SYSTEM_RULES');
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
                  health_score: snapshot.health_score,
                  risk_level: snapshot.risk_level,
                  operational_status: snapshot.operational_status,
                  lubricant: snapshot.lubricant,
                  metrics: snapshot.metrics,
                  signals: snapshot.signals,
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
          raw: rawContent,
        },
      };
    } catch {
      return this.buildFallbackInsight(snapshot, notes, 'SYSTEM_FALLBACK');
    } finally {
      clearTimeout(timer);
    }
  }

  private buildFallbackInsight(
    snapshot: TwinComputedSnapshot,
    notes: string | undefined,
    source: string,
  ): AiInsightPayload {
    const hasCriticalCondition =
      snapshot.metrics.critical_alerts > 0 ||
      snapshot.metrics.overdue_programaciones > 0 ||
      snapshot.lubricant.latest_state === 'ALERTA' ||
      snapshot.lubricant.latest_state === 'ANORMAL';

    const title = hasCriticalCondition
      ? `Intervención prioritaria para ${snapshot.twin.equipment_code || snapshot.twin.code}`
      : `Seguimiento operativo para ${snapshot.twin.equipment_code || snapshot.twin.code}`;

    const summary = hasCriticalCondition
      ? `El gemelo digital detecta ${snapshot.metrics.critical_alerts} alertas críticas, ${snapshot.metrics.overdue_programaciones} programaciones vencidas y estado de salud ${snapshot.health_score}%.`
      : `El gemelo digital mantiene un comportamiento ${snapshot.operational_status.toLowerCase()} con salud ${snapshot.health_score}% y riesgo ${snapshot.risk_level.toLowerCase()}.`;

    const recommendation = hasCriticalCondition
      ? `Prioriza atención sobre el equipo, revisa lubricación (${snapshot.lubricant.latest_state}), cierra OT abiertas (${snapshot.metrics.open_work_orders}) y reprograma ${snapshot.metrics.overdue_programaciones} mantenimientos vencidos.`
      : `Mantén el monitoreo del equipo, confirma la ejecución de ${snapshot.metrics.weekly_activity_count} actividades semanales y consolida ${snapshot.metrics.planned_hours_month} horas planificadas del mes.`;

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
      },
    };
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
        select e.id, e.codigo, e.nombre
        from kpi_maintenance.tb_equipo e
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
            (select codigo from latest) as latest_report_code
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
    try {
      return JSON.parse(value) as Record<string, string>;
    } catch {
      return null;
    }
  }
}
