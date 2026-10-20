import { ConfigService } from '@nestjs/config';
import {
  applyManufacturerResearch,
  configurationHash,
  equipmentConfiguration,
  validateResearch,
} from './digital-twin-research';
import { DigitalTwinResearchService } from './digital-twin-research.service';
const equipment = {
  marca: 'MTU',
  modelo: '12V4000',
  numero_serie: 'MTU-A',
  nombre_real: 'Unidad de generación',
};
const parts = [
  { id: 'motor', nombre: 'Motor', categoria: 'MOTOR' },
  {
    id: 'alt',
    nombre: 'Alternador LEROY SOMER LSA50.2L18',
    categoria: 'GENERACION',
  },
];
const configuration = equipmentConfiguration(equipment, parts);
const doc = () => ({
  scope_ref: 'COMP-1',
  title: 'Referencia de fluidos',
  publisher: 'mtu',
  publication: 'A001064',
  url: 'https://www.mtu-solutions.com/manual.pdf',
  kind: 'MANUAL',
  covered_models: ['12V4000G23'],
  match: 'FAMILIA',
  pages: '6',
  applicability: 'Confirmar variante antes de aplicar.',
  gaps: ['Variante pendiente'],
  criteria: ['Revisar la calidad del aceite.'],
  parameters: [
    {
      name: 'Variante cubierta',
      value: '4000Gx3',
      unit: '',
      section: 'Aplicabilidad, página 6',
    },
  ],
});
const body = (document = doc()) => ({
  status: 'completed',
  output: [
    {
      type: 'web_search_call',
      status: 'completed',
      action: {
        type: 'search',
        sources: [{ url: document.url, title: document.title }],
      },
    },
    {
      type: 'message',
      content: [
        {
          type: 'output_text',
          text: JSON.stringify({
            summary: 'Referencia localizada con alcance de familia.',
            gaps: [],
            documents: [document],
          }),
        },
      ],
    },
  ],
});
describe('Búsqueda documental OpenAI por configuración', () => {
  afterEach(() => jest.restoreAllMocks());
  it('invalida por modelo, serie o compartición y no envía horómetros, OT ni ubicaciones', () => {
    expect(configurationHash(configuration)).not.toBe(
      configurationHash(
        equipmentConfiguration({ ...equipment, modelo: '16V4000' }, parts),
      ),
    );
    expect(configurationHash(configuration)).not.toBe(
      configurationHash(
        equipmentConfiguration({ ...equipment, numero_serie: 'OTRA' }, parts),
      ),
    );
    expect(configurationHash(configuration)).not.toBe(
      configurationHash(
        equipmentConfiguration(equipment, [
          ...parts,
          { id: 'extra', nombre: 'Controlador' },
        ]),
      ),
    );
    expect(configurationHash(configuration)).toBe(
      configurationHash(
        equipmentConfiguration(
          { ...equipment, horometro_actual: 900, location_id: 'secreto' },
          parts,
        ),
      ),
    );
    expect(JSON.stringify(configuration)).not.toMatch(
      /location_id|horometro|work_order/,
    );
  });
  it('exige búsqueda real y rechaza URLs inventadas, privadas y alcances inexistentes', () => {
    expect(() =>
      validateResearch({ ...body(), output: [] }, configuration),
    ).toThrow();
    const invented = body();
    invented.output[0].action!.sources![0].url =
      'https://www.mtu-solutions.com/otra.pdf';
    expect(() => validateResearch(invented, configuration)).toThrow(/fuente/);
    expect(() =>
      validateResearch(
        body({ ...doc(), url: 'https://127.0.0.1/manual.pdf' }),
        configuration,
      ),
    ).toThrow(/fuente/);
    expect(() =>
      validateResearch(body({ ...doc(), scope_ref: 'COMP-99' }), configuration),
    ).toThrow(/Compartición/);
  });
  it('conserva parámetros de familia pero no aplica sus criterios a una variante desconocida', () => {
    const result = validateResearch(
      body({ ...doc(), match: 'MODELO' }),
      configuration,
    );
    expect(result.documents[0]).toMatchObject({
      status: 'POR_CONFIRMAR',
      criteria: [],
      source_type: 'OFICIAL',
      match_level: 'FAMILIA',
    });
    expect(result.documents[0].parameters).toHaveLength(1);
    const exact = validateResearch(
      body({ ...doc(), match: 'MODELO', covered_models: ['12V4000'] }),
      configuration,
    );
    expect(exact.documents[0]).toMatchObject({
      status: 'MODELO_COINCIDE',
      criteria: ['Revisar la calidad del aceite.'],
    });
  });
  it('normaliza seguimiento de enlaces y omite una cita no respaldada sin atribuirle datos', () => {
    const tracked = body();
    tracked.output[0].action!.sources![0].url += '?utm_source=openai';
    expect(validateResearch(tracked, configuration).documents).toHaveLength(1);
    const mixed = body();
    mixed.output[1].content![0].text = JSON.stringify({
      summary: 'Documentación parcial.',
      gaps: [],
      documents: [
        doc(),
        { ...doc(), url: 'https://www.mtu-solutions.com/no-consultado.pdf' },
      ],
    });
    const result = validateResearch(mixed, configuration);
    expect(result.documents).toHaveLength(1);
    expect(result.gaps.join(' ')).toMatch(/omitieron/);
  });
  it('una fuente externa o de otro fabricante no se acredita como especificación oficial', () => {
    expect(
      validateResearch(
        body({
          ...doc(),
          match: 'MODELO',
          covered_models: ['12V4000'],
          url: 'https://manuales.example/manual.pdf',
        }),
        configuration,
      ).documents[0],
    ).toMatchObject({
      source_type: 'EXTERNA',
      status: 'POR_CONFIRMAR',
      criteria: [],
    });
    expect(
      validateResearch(
        body({
          ...doc(),
          match: 'MODELO',
          covered_models: ['12V4000'],
          url: 'https://www.cat.com/manual.pdf',
        }),
        configuration,
      ).documents[0].source_type,
    ).toBe('EXTERNA');
  });
  it('no confunde el sufijo del alternador ni mezcla referencias entre comparticiones', () => {
    const result = validateResearch(
      body({
        ...doc(),
        scope_ref: 'COMP-2',
        publisher: 'Leroy-Somer',
        url: 'https://www.leroy-somer.com/manual.pdf',
        match: 'MODELO',
        covered_models: ['LSA50.2'],
      }),
      configuration,
    );
    expect(result.documents[0].status).toBe('POR_CONFIRMAR');
    const base = {
      configuration,
      manufacturer: [{ ref: 'OEM-1', gaps: ['Antigua falta'] }],
      facts: [{ ref: 'OEM-1' }, { ref: 'COMP-1' }, { ref: 'COMP-2' }],
      missing: ['Antigua falta', 'Serie faltante'],
      components: [
        { ref: 'COMP-1', evidence_refs: ['COMP-1', 'OEM-1'], gaps: [] },
        { ref: 'COMP-2', evidence_refs: ['COMP-2'], gaps: [] },
      ],
    };
    const packet = applyManufacturerResearch(
      base,
      {
        configuration_hash: configurationHash(configuration),
        expires_at: '2099-01-01',
        generated_at: '2026-10-19',
        ...result,
      },
      new Date(),
    );
    expect(packet.components[0].evidence_refs).toEqual(['COMP-1']);
    expect(packet.components[1].evidence_refs).toEqual(['COMP-2', 'WEB-1']);
    expect(packet.missing).not.toContain('Antigua falta');
    expect(packet.missing).toContain('Serie faltante');
  });
  it('descarta documentos de una configuración anterior y marca los caducados', () => {
    const base = {
      configuration,
      manufacturer: [],
      facts: [],
      missing: [],
      components: [],
    };
    expect(
      applyManufacturerResearch(
        structuredClone(base),
        { configuration_hash: 'otro' },
        new Date(),
      ).research.status,
    ).toBe('PENDING');
    expect(
      applyManufacturerResearch(
        structuredClone(base),
        {
          configuration_hash: configurationHash(configuration),
          documents: [],
          gaps: [],
          expires_at: '2020-01-01',
        },
        new Date(),
      ).research.status,
    ).toBe('STALE');
  });
  function setup(cached = false) {
    const stored: any[] = [];
    const db = {
      query: jest.fn(async (_sql: string, params: any[]) => {
        stored.push(JSON.parse(params[4]));
        return [];
      }),
    };
    const source = {
      equipment: jest.fn(async () => [equipment]),
      components: jest.fn(async () => parts),
      manufacturerResearch: jest.fn(async () =>
        cached
          ? [{ payload_json: { expires_at: '2099-01-01', documents: [doc()] } }]
          : [],
      ),
    };
    const config = {
      get: (key: string) => (key === 'OPENAI_API_KEY' ? 'test-key' : undefined),
    };
    return {
      service: new DigitalTwinResearchService(
        db as any,
        source as any,
        config as ConfigService,
      ),
      source,
      db,
      stored,
    };
  }
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  it('consulta sin bloquear, consolida solicitudes y guarda únicamente respuestas verificadas', async () => {
    const { service, db, stored } = setup();
    let resolve: any;
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockReturnValue(new Promise((r) => (resolve = r)));
    const twin = { id: 'gemelo', equipment_id: 'equipo' };
    const responses = await Promise.all([
      service.start(twin, 'actor'),
      service.start(twin, 'actor'),
    ]);
    expect(responses.every((r) => r.status === 'RUNNING')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(request.tools[0].type).toBe('web_search');
    expect(request.tool_choice).toBe('required');
    expect(request.store).toBe(false);
    expect(request.include).toContain('web_search_call.action.sources');
    resolve({ ok: true, json: async () => body() });
    await flush();
    await flush();
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(stored[0]).toMatchObject({
      configuration_hash: configurationHash(configuration),
      web_calls: 1,
    });
  });
  it('limita las búsquedas activas y conserva el tercer equipo en cola', async () => {
    const { service } = setup();
    const completions: Array<(value: any) => void> = [];
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockImplementation(
        () => new Promise((resolve) => completions.push(resolve)),
      );
    const a = { id: 'uno', equipment_id: 'eq' },
      b = { id: 'dos', equipment_id: 'eq' },
      c = { id: 'tres', equipment_id: 'eq' };
    await service.start(a, 'actor');
    await service.start(b, 'actor');
    expect((await service.start(c, 'actor')).status).toBe('QUEUED');
    expect(fetch).toHaveBeenCalledTimes(2);
    completions[0]({ ok: true, json: async () => body() });
    await flush();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect((await service.status(c)).status).toBe('RUNNING');
    completions[1]({ ok: true, json: async () => body() });
    completions[2]({ ok: true, json: async () => body() });
    await flush();
    await flush();
  });
  it('reutiliza la ficha vigente y permite reintentar un fallo sin guardar datos fabricados', async () => {
    const cached = setup(true),
      fetch = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({ ok: false, status: 503 } as any);
    expect(
      (
        await cached.service.start(
          { id: 'cached', equipment_id: 'equipo' },
          'actor',
        )
      ).status,
    ).toBe('READY');
    expect(fetch).not.toHaveBeenCalled();
    const { service, db } = setup(),
      twin = { id: 'fallo', equipment_id: 'equipo' };
    await service.start(twin, 'actor');
    await flush();
    await flush();
    expect((await service.status(twin)).status).toBe('ERROR');
    expect(db.query).not.toHaveBeenCalled();
    fetch.mockResolvedValue({ ok: true, json: async () => body() } as any);
    await service.start(twin, 'actor', true);
    await flush();
    await flush();
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
