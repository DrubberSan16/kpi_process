import {
  evaluateCondition,
  horometer,
  maintenanceTarget,
  simulateTwin,
  timestamp,
} from './digital-twin-model';
describe('Modelo operativo del activo', () => {
  const now = new Date('2026-10-19T17:00:00Z');
  it('distingue la lectura registrada del avance calculado y detiene el reloj en equipos parados', () => {
    const equipment = {
      horometro_actual: '1200',
      horometro_operativo_desde: '2026-10-19 10:00:00',
      estado_funcionamiento: 'FUNCIONAMIENTO',
    };
    expect(horometer(equipment, now)).toMatchObject({
      measured: 1200,
      estimated: 1202,
      calculated: true,
    });
    expect(
      horometer({ ...equipment, estado_funcionamiento: 'PARADO' }, now),
    ).toMatchObject({ estimated: 1200, calculated: false });
    expect(
      horometer({ ...equipment, horometro_actual: null }, now).estimated,
    ).toBeNull();
    expect(
      horometer({ ...equipment, horometro_operativo_desde: '2027-01-01' }, now)
        .clock_issue,
    ).toBeTruthy();
    expect(timestamp('2026-10-19 12:00:00')).toBe(now.toISOString());
    expect(timestamp('2026-10-19')).toBe('2026-10-19T05:00:00.000Z');
  });
  it('conserva horas negativas de un MPG vencido y marca las referencias supuestas', () => {
    const e = {
      intervalo_mantenimiento_valor: 500,
      intervalo_mantenimiento_unidad: 'HORAS',
      servicios_mpg: [{ horometro: 1000, work_order_code: 'OT-MPG' }],
    };
    expect(maintenanceTarget(e, 1560)).toMatchObject({
      target: 1500,
      remaining: -60,
      reliable: true,
    });
    expect(
      maintenanceTarget(
        { ...e, servicios_mpg: [{ horometro: 0 }, ...e.servicios_mpg] },
        1560,
      ),
    ).toMatchObject({ target: 1500, remaining: -60, reliable: false });
    expect(maintenanceTarget({ ...e, servicios_mpg: [] }, 1560)).toMatchObject({
      target: 2000,
      reliable: false,
    });
    expect(
      maintenanceTarget({ ...e, intervalo_mantenimiento_unidad: 'DIAS' }, 1560),
    ).toBeNull();
  });
  it('no convierte ausencia o falla de fuentes en salud normal', () => {
    expect(evaluateCondition({}, [], [], null, false).status).toBe('SIN_DATOS');
    expect(evaluateCondition({}, [], [], null, true).status).toBe(
      'SIN_HALLAZGOS',
    );
    expect(
      evaluateCondition({}, [{ nivel: 'CRITICAL' }], [], null, false).status,
    ).toBe('CRITICO');
    expect(
      evaluateCondition({}, [], [], { reliable: false, remaining: -60 }, false)
        .status,
    ).toBe('SIN_DATOS');
  });
  it('simula sin modificar estado ni permitir supuestos imposibles', () => {
    const state = {
      as_of: now.toISOString(),
      horometer: { estimated: 1400 },
      maintenance: { target: 1500, reliable: true },
    };
    const before = JSON.stringify(state);
    expect(
      simulateTwin(state, { days: 10, hours_per_day: 12, downtime_hours: 10 }),
    ).toMatchObject({
      projected_horometer: 1510,
      remaining: -10,
      exceeds_target: true,
    });
    expect(JSON.stringify(state)).toBe(before);
    for (const input of [
      { days: 0, hours_per_day: 12, downtime_hours: 0 },
      { days: 10, hours_per_day: 25, downtime_hours: 0 },
      { days: 1, hours_per_day: 2, downtime_hours: 3 },
      { days: 1, hours_per_day: NaN, downtime_hours: 0 },
    ])
      expect(() => simulateTwin(state, input)).toThrow();
  });
});
