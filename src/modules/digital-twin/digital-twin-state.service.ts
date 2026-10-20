import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DigitalTwinStateRepository } from './digital-twin-state.repository';
import {
  evaluateCondition,
  horometer,
  maintenanceTarget,
  simulateTwin,
  timestamp,
} from './digital-twin-model';
import { observedRate } from './digital-twin-duration';
import { technicalEvidence, technicalQuality } from './digital-twin-technical';
import {
  applyManufacturerResearch,
  configurationHash,
} from './digital-twin-research';

@Injectable()
export class DigitalTwinStateService {
  private readonly logger = new Logger(DigitalTwinStateService.name);
  constructor(private readonly source: DigitalTwinStateRepository) {}

  async state(twin: any, now = new Date()) {
    if (!twin.equipment_id)
      throw new BadRequestException(
        'Asocia un equipo real para consultar su estado',
      );
    const [equipment] = await this.source.equipment(twin.equipment_id);
    if (!equipment) throw new NotFoundException('Equipo no disponible');
    const quality: any[] = [];
    const read = async (
      key: string,
      label: string,
      load: () => Promise<any[]>,
      dateKey?: string,
    ) => {
      try {
        const rows = await load();
        const date = dateKey ? timestamp(rows[0]?.[dateKey]) : null;
        quality.push({
          key,
          label,
          status: rows.length ? 'DISPONIBLE' : 'SIN_REGISTROS',
          count: rows.length,
          latest_at: date,
          stale:
            !!date &&
            (now.getTime() < Date.parse(date) ||
              now.getTime() - Date.parse(date) > 30 * 86400000),
          checked_at: now.toISOString(),
        });
        return rows;
      } catch (error) {
        this.logger.warn(
          `Fuente ${key} no disponible: ${(error as Error).message}`,
        );
        quality.push({
          key,
          label,
          status: 'NO_DISPONIBLE',
          count: null,
          checked_at: now.toISOString(),
        });
        return [];
      }
    };
    // Small batches respect the shared PostgreSQL pool (five connections).
    const [components, alerts, orders] = await Promise.all([
      read('components', 'Comparticiones del equipo', () =>
        this.source.components(equipment.id),
      ),
      read(
        'alerts',
        'Alertas abiertas (máximo 200)',
        () => this.source.alerts(equipment.id),
        'fecha_generada',
      ),
      read(
        'orders',
        'OT recientes (máximo 100)',
        () => this.source.orders(equipment.id),
        'created_at',
      ),
    ]);
    const [oil, readings, operations] = await Promise.all([
      read(
        'oil',
        'Análisis de lubricante (últimos 200)',
        () => this.source.oil(equipment.id),
        'fecha_reporte',
      ),
      read(
        'readings',
        'Lecturas de horómetro (180 días, máximo 1000)',
        () => this.source.readings(equipment.id),
        'changed_at',
      ),
      read(
        'operations',
        'Cambios de funcionamiento (últimos 100)',
        () => this.source.operations(equipment.id),
        'changed_at',
      ),
    ]);
    const locations = await read(
      'locations',
      'Ubicaciones y sucursales (últimas 100)',
      () => this.source.locations(equipment.id),
      'valid_from',
    );
    const orderEvents = await read(
      'order_events',
      'Transiciones de OT (últimas 100)',
      () => this.source.orderEvents(equipment.id),
      'changed_at',
    );
    const clock = horometer(equipment, now);
    const maintenance = maintenanceTarget(equipment, clock.estimated);
    const technicalOrders = await read(
      'technical_orders',
      'Historial completo de OT',
      () => this.source.simulationOrders(equipment.id, now.toISOString(), true),
      'closed_at',
    );
    const baseTechnical = technicalEvidence(
      equipment,
      components,
      technicalOrders,
      oil,
      clock,
      now,
    );
    let researchReport: any = null;
    try {
      const [row] = await this.source.manufacturerResearch(
        twin.id,
        configurationHash(baseTechnical.configuration),
      );
      researchReport = row?.payload_json;
    } catch {
      this.logger.warn('Consulta documental del fabricante no disponible');
    }
    const technical = applyManufacturerResearch(
      baseTechnical,
      researchReport,
      now,
    );
    const componentOil = technical.components
      .filter((c) => c.oil?.valid_date)
      .map((c) => c.oil!);
    const worstOil = [...componentOil].sort((a, b) => {
      const severity = (s: string) =>
        /ANORMAL|ALERTA|CRITIC/.test(s)
          ? 2
          : /PRECAUCI|OBSERVA/.test(s)
            ? 1
            : 0;
      return severity(b.condition || '') - severity(a.condition || '');
    });
    const condition = evaluateCondition(
      equipment,
      [],
      worstOil.map((o) => ({ estado_diagnostico: o.condition })),
      maintenance,
      false,
    );
    if (
      worstOil[0] &&
      condition.reasons.some((r) => r.startsWith('Lubricante:'))
    )
      condition.reasons.push(
        `Hallazgo de muestra ${worstOil[0].code}; no acredita el estado físico actual`,
      );
    condition.basis =
      'Ficha del equipo, horómetro automático, MPG y evidencia por compartición; sin diagnóstico físico certificado';
    const sourceQuality = technicalQuality(equipment, technical, quality, now);
    const events = [
      ...locations.map((r) => ({
        id: `location-${r.id}`,
        at: timestamp(r.valid_from),
        type: 'UBICACION',
        title:
          [r.location_codigo, r.location_nombre, r.sucursal_nombre]
            .filter(Boolean)
            .join(' · ') || 'Sin ubicación',
        detail:
          r.source === 'BASELINE_OBSERVED'
            ? 'Referencia inicial observada; llegada anterior no acreditada'
            : 'Cambio de ubicación o sucursal registrado',
      })),
      ...readings.map((r) => ({
        id: `reading-${r.id}`,
        at: timestamp(r.changed_at),
        type: 'HOROMETRO',
        actor: r.actor,
        title: `${r.horometro_anterior ?? '—'} → ${r.horometro_nuevo} h`,
        detail: r.observacion || r.fuente,
      })),
      ...operations.map((r) => ({
        id: `operation-${r.id}`,
        at: timestamp(r.changed_at),
        type: 'FUNCIONAMIENTO',
        actor: r.actor,
        title: `${r.estado_anterior ?? '—'} → ${r.estado_nuevo}`,
        detail: 'Cambio registrado de funcionamiento',
      })),
      ...orders
        .filter((r) => !orderEvents.some((h) => h.code === r.code))
        .map((r) => ({
          id: `order-${r.id}`,
          at: timestamp(r.closed_at || r.started_at || r.created_at),
          type: 'OT',
          title: `${r.code} · ${r.status_workflow}`,
          detail: r.title,
        })),
      ...orderEvents.map((r) => ({
        id: `order-event-${r.id}`,
        at: timestamp(r.changed_at),
        type: 'OT',
        title: `${r.code} · ${r.title}`,
        detail: r.note,
        actor: r.actor,
        from_status: r.from_status,
        to_status: r.to_status,
      })),
      ...alerts.map((r) => ({
        id: `alert-${r.id}`,
        at: timestamp(r.fecha_generada),
        type: 'ALERTA',
        title: `${r.tipo_alerta} · ${r.nivel}`,
        detail: r.detalle,
      })),
      ...oil.map((r) => ({
        id: `oil-${r.id}`,
        at: timestamp(r.fecha_reporte),
        type: 'LUBRICANTE',
        title: `${r.codigo} · ${r.estado_diagnostico}`,
        detail: r.diagnostico,
      })),
    ]
      .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
      .slice(0, 100);
    return {
      version: 2,
      as_of: now.toISOString(),
      twin: { id: twin.id, code: twin.code, name: twin.name },
      identity: {
        id: equipment.id,
        code: equipment.codigo,
        name: equipment.nombre_real || equipment.nombre,
        operational_name: equipment.nombre,
        model: equipment.modelo,
        serie: equipment.numero_serie,
        brand: equipment.marca,
        location: equipment.ubicacion,
        central: equipment.central,
      },
      operation: {
        status: equipment.estado_operativo,
        running: equipment.estado_funcionamiento,
        since: timestamp(equipment.estado_funcionamiento_actualizado_en),
        criticality: equipment.criticidad,
      },
      horometer: clock,
      maintenance,
      simulation_basis: observedRate(readings, now.getTime()),
      condition,
      components,
      alerts,
      orders,
      oil,
      quality: sourceQuality,
      technical,
      events,
      connection: {
        mode: 'REGISTROS_OPERATIVOS',
        label: 'Registros del sistema',
        sensor_connected: false,
      },
      limits: [
        'Sin telemetría de sensores conectada',
        'Condición basada en registros; sin certificación de salud física',
        'Fuentes con límites visibles; los eventos no sustituyen el historial completo de cada módulo',
      ],
    };
  }
  async capture(twin: any, actor: string) {
    const state = await this.state(twin);
    const record = await this.source.capture(twin.id, state, actor);
    return { ...record, state };
  }
  async simulate(twin: any, input: any) {
    const state = await this.state(twin);
    // Simulation sources must succeed; incomplete data is never silently projected.
    let orders: any[], schedules: any[], readings: any[];
    try {
      [orders, schedules, readings] = await Promise.all([
        this.source.simulationOrders(twin.equipment_id, state.as_of),
        this.source.simulationSchedules(twin.equipment_id),
        this.source.readings(twin.equipment_id),
      ]);
    } catch (error) {
      this.logger.warn(
        `Fuentes de simulación no disponibles: ${(error as Error).message}`,
      );
      throw new BadRequestException(
        'No se pudo validar el historial y la programación. Actualiza e intenta nuevamente.',
      );
    }
    try {
      return simulateTwin(state, input, { orders, schedules, readings });
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }
}
