import { manufacturerReferences } from './digital-twin-manufacturer';
import { technicalEvidence } from './digital-twin-technical';
import { validateAnalysis } from './digital-twin-analysis.service';
const components = [
  { id: 'motor', categoria: 'MOTOR', nombre: 'Motor' },
  {
    id: 'alternador',
    categoria: 'GENERACION',
    nombre: 'Alternador LEROY SOMER LSA50.2L18',
  },
  { id: 'control', nombre: 'Controlador WOODWARD EASYGEN 3500XT' },
];
describe('Documentación oficial con alcance por modelo y compartición', () => {
  it('no aplica criterios MTU de variantes Gx3/Gx4 a 12V4000 sin variante ni a otro motor', () => {
    const generic = manufacturerReferences(
      { marca: 'MTU', modelo: '12V4000' },
      components,
    )[0];
    expect(generic.status).toBe('POR_CONFIRMAR');
    expect(generic.criteria).toEqual([]);
    expect(
      manufacturerReferences(
        { marca: 'MTU', modelo: '12V4000G23' },
        components,
      )[0],
    ).toMatchObject({ status: 'MODELO_COINCIDE', scope_refs: ['COMP-1'] });
    expect(
      manufacturerReferences(
        { marca: 'MTU', modelo: '12V4000G61' },
        components,
      )[0].criteria,
    ).toEqual([]);
    expect(
      manufacturerReferences({ marca: 'Cummins', modelo: '12V4000G23' }, []),
    ).toEqual([]);
  });
  it('distingue ficha Cummins de manual exacto por ESN y no extiende criterios a otro KTA', () => {
    const docs = manufacturerReferences(
      { marca: 'Cummins', modelo: 'KTA 50-G9' },
      [],
    );
    expect(docs.map((d) => d.kind)).toEqual(['FICHA', 'CONSULTA_POR_SERIE']);
    expect(docs[1].criteria).toEqual([]);
    expect(
      manufacturerReferences({ marca: 'Cummins', modelo: 'KTA50-G3' }, []),
    ).toEqual([]);
  });
  it('no aplica manual diésel de Cat a un G3512B de gas', () => {
    expect(
      manufacturerReferences({ marca: 'CAT', modelo: 'G3512B' }, []),
    ).toEqual([]);
    expect(
      manufacturerReferences({ marca: 'CAT', modelo: '3512B' }, [])[1],
    ).toMatchObject({
      kind: 'CONSULTA_POR_SERIE',
      status: 'POR_CONFIRMAR',
      criteria: [],
    });
  });
  it('vincula el manual de alternador solo a su compartición y conserva revisión Woodward pendiente', () => {
    const docs = manufacturerReferences({}, components);
    expect(docs[0]).toMatchObject({
      scope_refs: ['COMP-2'],
      kind: 'MANUAL',
      status: 'MODELO_COINCIDE',
    });
    expect(docs[1]).toMatchObject({
      scope_refs: ['COMP-3'],
      status: 'POR_CONFIRMAR',
      criteria: [],
    });
    expect(
      manufacturerReferences({}, [{ nombre: 'LSA 50.20 LEROY SOMER' }]),
    ).toEqual([]);
  });
  it('no decide qué motor recibe un manual si hay más de uno', () => {
    const docs = manufacturerReferences(
      { marca: 'MTU', modelo: '12V4000G23' },
      [components[0], { ...components[0], id: 'auxiliar' }],
    );
    expect(docs[0].scope_refs).toEqual([]);
  });
  it('rechaza una cita OEM de alternador en el análisis del motor', () => {
    const evidence = technicalEvidence(
      { marca: 'MTU', modelo: '12V4000' },
      components,
      [],
      [],
      { estimated: 100 },
      new Date('2026-10-19'),
    );
    const doc = evidence.manufacturer.find((d) =>
      d.publisher.includes('Leroy'),
    )!;
    expect(evidence.components[0].evidence_refs).not.toContain(doc.ref);
    const result = {
      summary: 'Falta evidencia.',
      components: ['ACTIVO', ...evidence.components.map((c) => c.ref)].map(
        (ref) => ({
          component_ref: ref,
          assessment: 'SIN_EVIDENCIA',
          observation: 'Sin registros.',
          recommendation: 'Verificar identificación.',
          evidence_refs: ref === 'ACTIVO' ? ['FICHA'] : [ref],
        }),
      ),
    };
    result.components[1].evidence_refs.push(doc.ref);
    expect(() => validateAnalysis(result, evidence)).toThrow(
      /otra compartición/,
    );
  });
});
