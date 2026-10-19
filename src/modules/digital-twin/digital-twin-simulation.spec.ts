import {
  executionDuration,
  observedRate,
  stopsEquipment,
} from './digital-twin-duration';
import { simulateTwin, SimulationContext } from './digital-twin-simulation';

const now = new Date('2026-10-19T05:00:00Z');
const state = {
  as_of: now.toISOString(),
  horometer: { estimated: 1400 },
  maintenance: { target: 1500, interval: 500, reliable: true },
};
const input = { days: 10, hours_per_day: 12, downtime_hours: 0 };
const closed = (hours: number, extra: any = {}) => ({
  id: `closed-${hours}`,
  code: `OT-${hours}`,
  title: 'Servicio MPG',
  plan_id: 'mpg',
  plan_name: 'MPG 500 HORAS',
  maintenance_kind: 'PREVENTIVO',
  status_workflow: 'CLOSED',
  requires_stop: true,
  hora_inicio: '2026-10-10T05:00:00Z',
  hora_fin: new Date(
    Date.parse('2026-10-10T05:00:00Z') + hours * 3600000,
  ).toISOString(),
  ...extra,
});
const context = (
  extra: Partial<SimulationContext> = {},
): SimulationContext => ({ orders: [], schedules: [], readings: [], ...extra });
describe('Simulación de mantenimiento basada en registros', () => {
  it('sigue la parada real del flujo de OT aunque el plan antiguo no la marque', () => {
    expect(
      stopsEquipment({ maintenance_kind: 'PREVENTIVO', requires_stop: false }),
    ).toBe(true);
    expect(
      stopsEquipment({ maintenance_kind: 'CEBADO', requires_stop: true }),
    ).toBe(false);
    expect(
      stopsEquipment({ maintenance_kind: 'PROYECTO', requires_stop: true }),
    ).toBe(false);
  });
  it('no usa preventivos menores para inventar la duración de un MPG', () => {
    const result = simulateTwin(
      { ...state, horometer: { estimated: 1501 } },
      input,
      context({
        orders: [
          closed(2, { plan_name: 'CAMBIO DE FILTRO RACOR', plan_id: 'racor' }),
        ],
      }),
    );
    expect(result.possible_count).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/Sin MPG cerrados/);
  });
  it('desplaza la programación por horómetro cuando una parada retrasa el umbral', () => {
    const result = simulateTwin(
      state,
      { ...input, days: 4, include_possible: false },
      context({
        orders: [
          {
            id: 'stop',
            code: 'OT-STOP',
            status_workflow: 'PLANNED',
            scheduled_start: now.toISOString(),
            scheduled_end: '2026-10-20T05:00:00Z',
            requires_stop: true,
          },
        ],
        schedules: [
          {
            id: 'threshold',
            code: 'PG-H',
            proxima_horas: 1412,
            planned_duration: 2,
            requires_stop: true,
          },
        ],
      }),
    );
    expect(result.interventions.find((i) => i.code === 'PG-H')?.at).toBe(
      '2026-10-21T05:00:00.000Z',
    );
  });
  it('toma la fecha de programación vinculada cuando la cabecera no tiene scheduled_start', () => {
    const result = simulateTwin(
      state,
      { ...input, days: 1 },
      context({
        orders: [
          {
            id: 'dated',
            code: 'OT-D',
            status_workflow: 'PLANNED',
            schedule_reference: '2026-10-19',
            scheduled_end: '2026-10-19T09:00:00Z',
            requires_stop: true,
          },
        ],
      }),
    );
    expect(result.interventions[0]).toMatchObject({
      at: now.toISOString(),
      duration_hours: 4,
      included: true,
    });
  });
  it('reconstruye cebados descontando REVIEW y evita tiempos administrativos reescritos', () => {
    const row = {
      status_workflow: 'CLOSED',
      maintenance_kind: 'CEBADO',
      started_at: '2026-10-10T16:00:00Z',
      closed_at: '2026-10-10T16:00:00Z',
      history: [
        {
          changed_at: '2026-10-10T10:00:00Z',
          from_status: 'PLANNED',
          to_status: 'IN_PROGRESS',
        },
        {
          changed_at: '2026-10-10T11:00:00Z',
          from_status: 'IN_PROGRESS',
          to_status: 'REVIEW',
        },
        {
          changed_at: '2026-10-10T14:00:00Z',
          from_status: 'REVIEW',
          to_status: 'IN_PROGRESS',
        },
        {
          changed_at: '2026-10-10T15:00:00Z',
          from_status: 'IN_PROGRESS',
          to_status: 'CLOSED',
        },
        {
          changed_at: '2026-10-10T16:00:00Z',
          from_status: 'CLOSED',
          to_status: 'CLOSED',
        },
      ],
    };
    expect(executionDuration(row, now.getTime())?.hours).toBe(2);
    expect(
      executionDuration(
        { ...row, maintenance_kind: 'PREVENTIVO' },
        now.getTime(),
      )?.hours,
    ).toBe(5);
    expect(executionDuration({ ...closed(0) }, now.getTime())).toBeNull();
    expect(
      executionDuration(
        { ...closed(3), hora_fin: '2026-11-01' },
        now.getTime(),
      ),
    ).toBeNull();
  });
  it('calibra ritmo con lecturas recientes y rechaza saltos imposibles y lecturas futuras', () => {
    const readings = [
      { changed_at: '2026-10-15', horometro_nuevo: 100 },
      { changed_at: '2026-10-16', horometro_nuevo: 112 },
      { changed_at: '2026-10-17', horometro_nuevo: 124 },
      { changed_at: '2026-10-18', horometro_nuevo: 1000 },
      { changed_at: '2027-01-01', horometro_nuevo: 5000 },
    ];
    expect(observedRate(readings, now.getTime())).toMatchObject({
      hours_per_day: 12,
      samples: 2,
      rejected: 1,
    });
    expect(
      simulateTwin(
        state,
        { ...input, hours_per_day: 24, rate_mode: 'HISTORICAL' },
        context({ readings }),
      ).assumptions.hours_per_day,
    ).toBe(12);
    expect(() =>
      simulateTwin(state, { ...input, rate_mode: 'HISTORICAL' }, context()),
    ).toThrow(/lecturas/);
    expect(
      observedRate(readings, Date.parse('2026-12-10')).hours_per_day,
    ).toBeNull();
  });
  it('usa mediana comparable y fusiona ventanas superpuestas sin duplicar paradas', () => {
    const rows = [
      closed(4),
      closed(6),
      closed(100),
      {
        id: 'pending',
        code: 'OT-P',
        title: 'Servicio',
        plan_id: 'mpg',
        plan_name: 'MPG 500 HORAS',
        maintenance_kind: 'PREVENTIVO',
        requires_stop: true,
        status_workflow: 'PLANNED',
        scheduled_start: '2026-10-20T05:00:00Z',
      },
      {
        id: 'second',
        code: 'OT-B',
        title: 'Otra OT',
        requires_stop: true,
        status_workflow: 'PLANNED',
        scheduled_start: '2026-10-20T05:00:00Z',
        scheduled_end: '2026-10-20T09:00:00Z',
      },
    ];
    const result = simulateTwin(
      state,
      { ...input, days: 2, include_possible: false },
      context({ orders: rows }),
    );
    expect(result.interventions.find((i) => i.code === 'OT-P')).toMatchObject({
      duration_hours: 6,
      samples: 3,
    });
    expect(result.operation_lost_hours).toBe(3); // 6 wall-clock hours at a 12h/day average.
    expect(result.added_hours).toBe(21);
  });
  it('distingue tiempo desconocido, planes sin parada y cebados que continúan operando', () => {
    const rows = [
      {
        id: 'a',
        code: 'OT-A',
        status_workflow: 'PLANNED',
        scheduled_start: now.toISOString(),
        requires_stop: true,
      },
      {
        id: 'b',
        code: 'OT-B',
        status_workflow: 'PLANNED',
        scheduled_start: now.toISOString(),
        scheduled_end: '2026-10-19T15:00:00Z',
        requires_stop: false,
      },
      {
        id: 'c',
        code: 'OT-C',
        status_workflow: 'PLANNED',
        maintenance_kind: 'CEBADO',
        scheduled_start: now.toISOString(),
        scheduled_end: '2026-10-19T15:00:00Z',
        requires_stop: true,
      },
    ];
    const result = simulateTwin(
      state,
      { ...input, days: 1 },
      context({ orders: rows }),
    );
    expect(result.added_hours).toBe(12);
    expect(result.interventions[0].duration_hours).toBeNull();
    expect(
      result.interventions.find((i) => i.code === 'OT-C')?.requires_stop,
    ).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/sin duración válida/);
  });
  it('descuenta solo el tiempo restante de una OT ya iniciada', () => {
    const result = simulateTwin(
      state,
      { ...input, days: 1 },
      context({
        orders: [
          closed(6),
          {
            id: 'open',
            code: 'OT-A',
            status_workflow: 'IN_PROGRESS',
            plan_id: 'mpg',
            plan_name: 'MPG 500 HORAS',
            maintenance_kind: 'PREVENTIVO',
            requires_stop: true,
            hora_inicio: '2026-10-19T03:00:00Z',
          },
        ],
      }),
    );
    expect(result.interventions[0].duration_hours).toBe(4);
    expect(result.operation_lost_hours).toBe(2);
  });
  it('respeta programación, evita duplicados de la OT vinculada y no repite órdenes ya cerradas', () => {
    const orders = [
      closed(6),
      {
        id: 'open',
        code: 'OT-P',
        status_workflow: 'PLANNED',
        scheduled_start: '2026-10-20',
        plan_id: 'mpg',
        requires_stop: true,
      },
    ];
    const schedules = [
      { id: 'duplicate', work_order_id: 'open', proxima_fecha: '2026-10-20' },
      { id: 'old', work_order_id: 'closed-6', proxima_fecha: '2026-10-12' },
      {
        id: 'future',
        code: 'PG-1',
        proxima_fecha: '2026-10-21',
        plan_id: 'mpg',
        planned_duration: 8,
        requires_stop: true,
      },
    ];
    const result = simulateTwin(
      state,
      { ...input, days: 5, include_possible: false },
      context({ orders, schedules }),
    );
    expect(result.interventions.map((i) => i.code)).toEqual(['OT-P', 'PG-1']);
    expect(result.interventions[1]).toMatchObject({
      category: 'PROGRAMADA',
      duration_hours: 8,
    });
  });
  it('proyecta sucesivos MPG sin modificar lecturas y solo con referencia confiable', () => {
    const base = {
      ...state,
      horometer: { estimated: 1495 },
      maintenance: { target: 1500, interval: 50, reliable: true },
    };
    const data = context({ orders: [closed(4), closed(6)] });
    const before = JSON.stringify([base, data]);
    const result = simulateTwin(base, input, data);
    expect(result.possible_count).toBeGreaterThan(1);
    expect(result.interventions[0]).toMatchObject({
      category: 'MPG_PROYECTADO',
      duration_hours: 5,
      samples: 2,
      target: 1500,
    });
    expect(result.next_target).toBeGreaterThan(1500);
    expect(JSON.stringify([base, data])).toBe(before);
    expect(
      simulateTwin(
        { ...base, maintenance: { ...base.maintenance, reliable: false } },
        input,
        data,
      ).possible_count,
    ).toBe(0);
    expect(
      simulateTwin(base, { ...input, include_possible: false }, data)
        .possible_count,
    ).toBe(0);
  });
  it('excluye anuladas, respeta horizontes y preserva pendientes sin fecha como datos incompletos', () => {
    const result = simulateTwin(
      state,
      { ...input, days: 1 },
      context({
        orders: [
          closed(6, { valor_json: { annulment: { reason: 'Error' } } }),
          {
            id: 'beyond',
            code: 'OT-F',
            status_workflow: 'PLANNED',
            scheduled_start: '2026-12-01',
          },
          { id: 'undated', code: 'OT-U', status_workflow: 'PLANNED' },
          { id: 'void', code: 'OT-V', status_workflow: 'ANULADA' },
        ],
      }),
    );
    expect(result.history.valid_durations).toBe(0);
    expect(result.interventions).toHaveLength(1);
    expect(result.interventions[0]).toMatchObject({
      code: 'OT-U',
      at: null,
      included: false,
    });
  });
  it('no supone nuevas fallas, ni considera el cebado un reinicio de MPG', () => {
    const base = { ...state, horometer: { estimated: 1501 } };
    const result = simulateTwin(
      base,
      input,
      context({
        orders: [
          closed(2, {
            maintenance_kind: 'CEBADO',
            plan_name: 'MPG - CEBADA DE ACEITE',
          }),
        ],
      }),
    );
    expect(result.possible_count).toBe(0);
    expect(result.next_target).toBe(1500);
    expect(result.remaining).toBeLessThan(0);
  });
});
