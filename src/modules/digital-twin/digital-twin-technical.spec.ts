import { technicalEvidence, technicalQuality } from './digital-twin-technical';
const now = new Date('2026-10-19T17:00:00Z');
const equipment = {
  codigo: 'EQ-UG01',
  nombre: 'UG01',
  nombre_real: 'Unidad generación',
  modelo: '3512B',
  numero_serie: 'SERIE-01',
  marca: 'CAT',
  estado_funcionamiento: 'FUNCIONAMIENTO',
  intervalo_mantenimiento_unidad: 'HORAS',
  intervalo_mantenimiento_valor: 500,
  servicios_mpg: [
    {
      work_order_code: 'OT-MPG',
      plan_nombre: 'MPG 500 HORAS',
      horometro: 1000,
      cerrada_en: '2026-10-01T17:00:00Z',
    },
  ],
};
const components = [
  {
    id: 'motor',
    nombre: 'Motor',
    nombre_oficial: 'Motor principal',
    categoria: 'MOTOR',
    serie: 'MOTOR-01',
  },
  {
    id: 'panel',
    nombre: 'Tablero',
    categoria: 'ELECTRICO',
    parent_id: 'motor',
  },
];
const order = {
  id: 'ot',
  code: 'OT-MOTOR',
  title: 'Cambio de filtro',
  equipo_componente_id: 'motor',
  status_workflow: 'CLOSED',
  maintenance_kind: 'PREVENTIVO',
  hora_fin: '2026-10-10T17:00:00Z',
  valor_json: { horometro_inicio_ejecucion: 1100 },
};
const clock = { estimated: 1250, clock_since: '2026-10-19T10:00:00Z' };
const packet = (
  c: any[] = components,
  o: any[] = [order],
  oil: any[] = [],
  e: any = equipment,
) => technicalEvidence(e, c, o, oil, clock, now);
describe('Evidencia técnica por compartición', () => {
  it('no interpreta como horas recorridas un contador corregido después de la OT', () => {
    const p = packet(components, [order], [], {
      ...equipment,
      last_counter_correction_at: '2026-10-12T17:00:00Z',
    });
    expect(p.mpg.reliable).toBe(false);
    expect(p.mpg.hours_since).toBeNull();
    expect(p.components[0].last_intervention?.hours_since).toBeNull();
  });
  it('distingue horómetro automático, último MPG y recorrido posterior de cada OT', () => {
    const p = packet();
    expect(p.mpg).toMatchObject({
      horometer: 1000,
      hours_since: 250,
      reliable: true,
    });
    expect(p.components[0].last_intervention).toMatchObject({
      horometer: 1100,
      hours_since: 150,
      code: 'OT-MOTOR',
    });
    expect(p.components[1].last_intervention).toBeNull();
    expect(p.facts.find((f) => f.ref === 'RELOJ')?.data.modo).toBe(
      'AUTOMATICO',
    );
  });
  it('no sustituye un último MPG inválido por la lectura de un servicio anterior', () => {
    const p = packet(components, [], [], {
      ...equipment,
      servicios_mpg: [
        {
          work_order_code: 'OT-MAL',
          horometro: 2000,
          cerrada_en: now.toISOString(),
        },
        ...equipment.servicios_mpg,
      ],
    });
    expect(p.mpg).toMatchObject({
      code: 'OT-MAL',
      reliable: false,
      hours_since: null,
    });
  });
  it('rechaza una referencia MPG de fecha futura y conserva datos incompletos', () => {
    expect(
      packet(components, [], [], {
        ...equipment,
        servicios_mpg: [{ horometro: 1000, cerrada_en: '2027-01-01' }],
      }).mpg.reliable,
    ).toBe(false);
    expect(
      packet([], [], [], {
        ...equipment,
        modelo: null,
        numero_serie: null,
      }).missing.join(' '),
    ).toMatch(/sin modelo/);
  });
  it('no reinicia la referencia de compartición con cebados, proyectos ni OT anuladas', () => {
    const p = packet(components, [
      order,
      {
        ...order,
        code: 'CEBADO',
        hora_fin: '2026-10-18',
        maintenance_kind: 'CEBADO',
      },
      {
        ...order,
        code: 'PROYECTO',
        hora_fin: '2026-10-18',
        maintenance_kind: 'PROYECTO',
      },
      {
        ...order,
        code: 'ANULADA',
        hora_fin: '2026-10-18',
        valor_json: { annulment: {} },
      },
    ]);
    expect(p.components[0].last_intervention?.code).toBe('OT-MOTOR');
  });
  it('no atribuye una muestra ambigua a dos motores', () => {
    const p = packet(
      [
        ...components,
        { id: 'motor2', nombre: 'Motor auxiliar', categoria: 'MOTOR' },
      ],
      [],
      [
        {
          codigo: 'LAB',
          compartimento_principal: 'MOTOR',
          fecha_muestra: '2026-10-10',
        },
      ],
    );
    expect(p.components.every((c) => c.oil === null)).toBe(true);
    expect(p.missing.join(' ')).toMatch(/sin vinculación inequívoca/);
  });
  it('vincula muestras por nombre único y separa parámetros de otra compartición', () => {
    const p = packet(
      components,
      [],
      [
        {
          codigo: 'LAB',
          compartimento_principal: 'MOTOR',
          fecha_muestra: '2026-10-10',
          estado_diagnostico: 'ANORMAL',
          measurements: [
            { compartimento: 'MOTOR', parametro: 'Fe', resultado_numerico: 30 },
            {
              compartimento: 'GENERADOR',
              parametro: 'Fe',
              resultado_numerico: 200,
            },
          ],
        },
      ],
    );
    expect(p.components[0].oil).toMatchObject({
      code: 'LAB',
      age_days: 9,
      valid_date: true,
    });
    expect(p.components[0].oil.measurements).toHaveLength(1);
    expect(p.components[1].oil).toBeNull();
  });
  it('no exige análisis de aceite a tableros eléctricos de aplicabilidad desconocida', () => {
    expect(packet().components[1].gaps.join(' ')).not.toMatch(/lubricante/);
    expect(packet().components[1].oil_applicability).toBe('NO_DETERMINADA');
  });
  it('marca fechas de muestra futuras sin tratarlas como evidencia actual', () => {
    const p = packet(
      components,
      [],
      [
        {
          codigo: 'LAB',
          compartimento_principal: 'MOTOR',
          fecha_muestra: '2027-01-01',
        },
      ],
    );
    expect(p.components[0].oil.valid_date).toBe(false);
    expect(p.components[0].gaps.join(' ')).toMatch(/futura/);
  });
  it('detecta ciclos, padres inexistentes y OT con compartición eliminada', () => {
    const p = packet(
      [
        { id: 'a', parent_id: 'b', nombre: 'A' },
        { id: 'b', parent_id: 'a', nombre: 'B' },
        { id: 'c', parent_id: 'missing', nombre: 'C' },
      ],
      [order],
    );
    expect(p.issues.join(' ')).toMatch(/circular/);
    expect(p.issues.join(' ')).toMatch(/padre/);
    expect(p.missing.join(' ')).toMatch(/OT apuntan/);
  });
  it('no confunde fuentes caídas con cero registros ni exige lectura manual reciente', () => {
    const quality = technicalQuality(
      equipment,
      packet(),
      [
        { key: 'components', status: 'NO_DISPONIBLE' },
        { key: 'oil', status: 'NO_DISPONIBLE' },
      ],
      now,
    );
    expect(quality.map((q) => q.key)).toEqual([
      'technical_sheet',
      'manufacturer',
      'components',
      'last_mpg',
      'orders',
      'oil',
    ]);
    expect(quality[2]).toMatchObject({ count: null, status: 'NO_DISPONIBLE' });
    expect(quality[2].detail).not.toMatch(/^0/);
    expect(JSON.stringify(quality)).not.toMatch(
      /lectura registrada|Alertas abiertas|stale/,
    );
  });
});
