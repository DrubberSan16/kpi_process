import { ConfigService } from '@nestjs/config';
import {
  DigitalTwinAnalysisService,
  validateAnalysis,
  evidenceFingerprint,
} from './digital-twin-analysis.service';
const technical = {
  components: [
    {
      ref: 'COMP-1',
      evidence_refs: ['COMP-1', 'OT-1'],
      last_intervention: { code: 'OT-A' },
      oil: null,
    },
    {
      ref: 'COMP-2',
      evidence_refs: ['COMP-2'],
      last_intervention: null,
      oil: null,
    },
  ],
  missing: ['Falta ficha del fabricante'],
  facts: [
    { ref: 'FICHA', data: { modelo: '3512B' } },
    { ref: 'MPG', data: { hours_since: 30 } },
    { ref: 'RELOJ', data: { horometro_actual: 1230.1, calculado_en: 'ahora' } },
    { ref: 'COMP-1', data: {} },
    { ref: 'COMP-2', data: {} },
    { ref: 'OT-1', data: { hours_since: 25 } },
  ],
};
const result = () => ({
  summary: 'La evidencia permite una revisión parcial.',
  components: ['ACTIVO', 'COMP-1', 'COMP-2'].map((ref) => ({
    component_ref: ref,
    assessment: ref === 'COMP-2' ? 'SIN_EVIDENCIA' : 'EVIDENCIA_PARCIAL',
    observation: 'Se identifican registros y datos pendientes.',
    recommendation: 'Verificar la ficha y realizar inspección.',
    evidence_refs:
      ref === 'ACTIVO'
        ? ['FICHA']
        : ref === 'COMP-1'
          ? ['COMP-1', 'OT-1']
          : ['COMP-2'],
  })),
});
describe('Revisión GPT con evidencia verificable', () => {
  afterEach(() => jest.restoreAllMocks());
  it('exige cobertura de todas las comparticiones y no acepta duplicados', () => {
    expect(validateAnalysis(result(), technical)).toBeTruthy();
    const a = result();
    a.components.pop();
    expect(() => validateAnalysis(a, technical)).toThrow(/Cobertura/);
    const b = result();
    b.components[2] = b.components[1];
    expect(() => validateAnalysis(b, technical)).toThrow();
  });
  it('rechaza referencias inexistentes y fuentes de otra compartición', () => {
    const a = result();
    a.components[1].evidence_refs.push('LAB-INVENTADO');
    expect(() => validateAnalysis(a, technical)).toThrow(/referencia/);
    const b = result();
    b.components[2].evidence_refs.push('OT-1');
    expect(() => validateAnalysis(b, technical)).toThrow(/otra compartición/);
  });
  it('no acepta cifras, límites ni porcentajes inventados en la narrativa', () => {
    const a = result();
    a.summary = 'El motor tiene un 97% de salud.';
    expect(() => validateAnalysis(a, technical)).toThrow(/cifras/);
    const b = result();
    b.components[1].recommendation = 'Cambiar cada 200 horas';
    expect(() => validateAnalysis(b, technical)).toThrow(/cifras/);
  });
  it('una compartición sin registros no se presenta como evaluada y no acepta campos extra', () => {
    const a = result();
    a.components[2].assessment = 'EVIDENCIA_PARCIAL';
    expect(() => validateAnalysis(a, technical)).toThrow(/sin evidencia/);
    expect(() =>
      validateAnalysis({ ...result(), health_score: 100 }, technical),
    ).toThrow();
  });
  it('cachea el avance fraccional, pero invalida un cambio de servicio, modelo o banda horaria', () => {
    const a = structuredClone(technical),
      b = structuredClone(technical);
    b.facts[2].data = { horometro_actual: 1230.9, calculado_en: 'después' };
    b.facts[1].data.hours_since = 30.9;
    b.facts[5].data.hours_since = 25.9;
    expect(evidenceFingerprint(a, 'gpt-5.4')).toBe(
      evidenceFingerprint(b, 'gpt-5.4'),
    );
    b.facts[2].data.horometro_actual = 1231;
    expect(evidenceFingerprint(a, 'gpt-5.4')).not.toBe(
      evidenceFingerprint(b, 'gpt-5.4'),
    );
    expect(evidenceFingerprint(a, 'gpt-5.4')).not.toBe(
      evidenceFingerprint(a, 'gpt-4.1'),
    );
  });
  function setup() {
    const db = { query: jest.fn().mockResolvedValue([]) },
      state = {
        state: jest
          .fn()
          .mockResolvedValue({
            as_of: '2026-10-19T17:00:00Z',
            horometer: { estimated: 1230.1 },
            technical,
            quality: [],
          }),
      };
    const config = {
      get: (key: string) =>
        key === 'DIGITAL_TWIN_AI_API_KEY' ? 'test-key' : undefined,
    };
    return {
      db,
      state,
      service: new DigitalTwinAnalysisService(
        db as any,
        state as any,
        config as ConfigService,
      ),
    };
  }
  it('ejecuta Responses sin herramientas ni almacenamiento externo y guarda solo respuestas validadas', async () => {
    const { db, service } = setup();
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'completed',
          output: [
            {
              content: [
                { type: 'output_text', text: JSON.stringify(result()) },
              ],
            },
          ],
        }),
      } as any);
    const response = await service.analyze({ id: 'asset' }, 'actor');
    expect(response.report.model).toBe('gpt-5.4');
    const request = JSON.parse(fetch.mock.calls[0][1]?.body as string);
    expect(request.store).toBe(false);
    expect(request.tools).toBeUndefined();
    expect(request.text.format.strict).toBe(true);
    expect(db.query.mock.calls.some((c) => c[0].includes('insert into'))).toBe(
      true,
    );
  });
  it('no guarda respuestas incompletas, referencias fabricadas ni fallos del proveedor', async () => {
    const { db, service } = setup();
    const mock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'incomplete' }),
      } as any);
    await expect(service.analyze({ id: 'asset' }, 'actor')).rejects.toThrow(
      /completar/,
    );
    mock.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'completed',
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  ...result(),
                  summary: 'Falla en 20 horas',
                }),
              },
            ],
          },
        ],
      }),
    } as any);
    await expect(service.analyze({ id: 'asset' }, 'actor')).rejects.toThrow(
      /validación/,
    );
    expect(db.query.mock.calls.some((c) => c[0].includes('insert into'))).toBe(
      false,
    );
  });
  it('consolida solicitudes simultáneas y una consulta no dispara GPT', async () => {
    const { service } = setup();
    const mock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'completed',
          output: [
            {
              content: [
                { type: 'output_text', text: JSON.stringify(result()) },
              ],
            },
          ],
        }),
      } as any);
    await service.read({ id: 'asset' });
    expect(mock).not.toHaveBeenCalled();
    await Promise.all([
      service.analyze({ id: 'asset' }, 'actor'),
      service.analyze({ id: 'asset' }, 'actor'),
    ]);
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
