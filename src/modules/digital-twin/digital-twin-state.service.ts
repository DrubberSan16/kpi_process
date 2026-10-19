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
        'Análisis de lubricante (últimos 20)',
        () => this.source.oil(equipment.id),
        'fecha_reporte',
      ),
      read(
        'readings',
        'Lecturas de horómetro (últimas 100)',
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
    const clock = horometer(equipment, now);
    const maintenance = maintenanceTarget(equipment, clock.estimated);
    const measurementTime = clock.measured_at;
    const staleReading =
      !measurementTime ||
      now.getTime() - Date.parse(measurementTime) > 7 * 86400000 ||
      Date.parse(measurementTime) > now.getTime();
    quality.unshift({
      key: 'equipment',
      label: 'Lectura registrada del equipo',
      status: clock.measured === null ? 'SIN_REGISTROS' : 'DISPONIBLE',
      latest_at: measurementTime,
      stale: staleReading,
      checked_at: now.toISOString(),
    });
    const oilQuality = quality.find((q) => q.key === 'oil');
    const complete =
      !staleReading &&
      !clock.clock_issue &&
      quality.every((q) => q.status !== 'NO_DISPONIBLE') &&
      oil.length > 0 &&
      !!oilQuality?.latest_at &&
      !oilQuality.stale;
    const condition = evaluateCondition(
      equipment,
      alerts,
      oil,
      maintenance,
      complete,
    );
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
        title: `${r.horometro_anterior ?? '—'} → ${r.horometro_nuevo} h`,
        detail: r.observacion || r.fuente,
      })),
      ...operations.map((r) => ({
        id: `operation-${r.id}`,
        at: timestamp(r.changed_at),
        type: 'FUNCIONAMIENTO',
        title: `${r.estado_anterior ?? '—'} → ${r.estado_nuevo}`,
        detail: 'Cambio registrado de funcionamiento',
      })),
      ...orders.map((r) => ({
        id: `order-${r.id}`,
        at: timestamp(r.closed_at || r.started_at || r.created_at),
        type: 'OT',
        title: `${r.code} · ${r.status_workflow}`,
        detail: r.title,
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
      condition,
      components,
      alerts,
      orders,
      oil,
      quality,
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
    try {
      return simulateTwin(state, input);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }
}
