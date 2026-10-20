import { createHash } from 'node:crypto';

const text = (v: unknown, max = 300) =>
  String(v || '')
    .trim()
    .slice(0, max);
const normalized = (v: unknown) =>
  text(v, 1500)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
export function equipmentConfiguration(e: any, components: any[]) {
  return {
    equipment: {
      brand: text(e.marca),
      model: text(e.modelo),
      serial: text(e.numero_serie),
      type: text(e.nombre_real),
    },
    components: components.map((c, i) => ({
      ref: `COMP-${i + 1}`,
      name: text(c.nombre_oficial || c.nombre),
      code: text(c.codigo),
      serial: text(c.serie),
      category: text(c.categoria),
      description: text(c.descripcion, 500),
      parent: text(
        components.find((p) => p.id === c.parent_id)?.nombre_oficial,
      ),
    })),
  };
}
export const configurationHash = (configuration: any) =>
  createHash('sha256')
    .update(JSON.stringify({ version: 1, configuration }))
    .digest('hex');
export type ResearchConfiguration = ReturnType<typeof equipmentConfiguration>;
export type ResearchMeta = {
  status: string;
  configuration_hash: string;
  generated_at: string | null;
  expires_at: string | null;
  summary: string;
  web_calls: number;
};
const officialGroups: Array<{ names: string[]; domains: string[] }> = [
  {
    names: ['MTU', 'ROLLSROYCE'],
    domains: ['mtu-solutions.com', 'rolls-royce.com'],
  },
  {
    names: ['CATERPILLAR', 'CAT'],
    domains: ['cat.com', 'caterpillar.com', 'catpublications.com'],
  },
  { names: ['CUMMINS'], domains: ['cummins.com'] },
  {
    names: ['LEROYSOMER', 'NIDEC'],
    domains: ['leroy-somer.com', 'nidecpower.com', 'nidec.com'],
  },
  { names: ['WOODWARD', 'EASYGEN'], domains: ['woodward.com', 'easygen.org'] },
  { names: ['STAMFORD', 'AVK'], domains: ['stamford-avk.com', 'cummins.com'] },
  { names: ['PERKINS'], domains: ['perkins.com'] },
  { names: ['VOLVOPENTA'], domains: ['volvopenta.com'] },
  { names: ['JOHNDEERE'], domains: ['deere.com'] },
  { names: ['SCANIA'], domains: ['scania.com'] },
  { names: ['ABB'], domains: ['abb.com'] },
  { names: ['SIEMENS'], domains: ['siemens.com'] },
];
function publicUrl(raw: unknown) {
  try {
    const u = new URL(text(raw, 1800));
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.port ||
      !u.hostname.includes('.') ||
      /^(?:localhost|\d|\[)/.test(u.hostname) ||
      /\.(local|internal|localhost)$/.test(u.hostname)
    )
      return null;
    u.hash = '';
    for (const name of [...u.searchParams.keys()])
      if (/^utm_|^(?:gclid|fbclid|msclkid)$/i.test(name))
        u.searchParams.delete(name);
    return u.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}
export const RESEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'gaps', 'documents'],
  properties: {
    summary: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' } },
    documents: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'scope_ref',
          'title',
          'publisher',
          'publication',
          'url',
          'kind',
          'covered_models',
          'match',
          'pages',
          'applicability',
          'gaps',
          'criteria',
          'parameters',
        ],
        properties: {
          scope_ref: { type: 'string' },
          title: { type: 'string' },
          publisher: { type: 'string' },
          publication: { type: 'string' },
          url: { type: 'string' },
          kind: { type: 'string', enum: ['MANUAL', 'FICHA'] },
          covered_models: { type: 'array', items: { type: 'string' } },
          match: { type: 'string', enum: ['MODELO', 'FAMILIA', 'INCIERTA'] },
          pages: { type: 'string' },
          applicability: { type: 'string' },
          gaps: { type: 'array', items: { type: 'string' } },
          criteria: { type: 'array', items: { type: 'string' } },
          parameters: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'value', 'unit', 'section'],
              properties: {
                name: { type: 'string' },
                value: { type: 'string' },
                unit: { type: 'string' },
                section: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};
/** Accept only URLs actually returned by the web tool; the model cannot manufacture citations. */
export function validateResearch(
  body: any,
  configuration: ResearchConfiguration,
  now = new Date(),
) {
  const calls = (body.output || []).filter(
    (x: any) => x.type === 'web_search_call' && x.status === 'completed',
  );
  if (body.status !== 'completed' || !calls.length)
    throw new Error('No se ejecutó una búsqueda web completa');
  const sources = new Map<string, string>();
  for (const call of calls) {
    for (const source of call.action?.sources || []) {
      const url = publicUrl(source.url);
      if (url) sources.set(url, text(source.title || source.url, 500));
    }
    if (call.action?.type === 'open_page') {
      const url = publicUrl(call.action.url);
      if (url) sources.set(url, url);
    }
  }
  const content = (body.output || []).flatMap((x: any) => x.content || []);
  for (const c of content)
    for (const a of c.annotations || []) {
      const url = publicUrl(a.url);
      if (a.type === 'url_citation' && url)
        sources.set(url, text(a.title || a.url, 500));
    }
  const value = JSON.parse(
    content
      .filter((c: any) => c.type === 'output_text')
      .map((c: any) => c.text)
      .join(''),
  );
  if (
    typeof value.summary !== 'string' ||
    !value.summary.trim() ||
    value.summary.length > 2000 ||
    !Array.isArray(value.documents) ||
    value.documents.length > 12 ||
    !Array.isArray(value.gaps)
  )
    throw new Error('Ficha documental incompleta');
  const list = (v: any, max = 12) => {
    if (
      !Array.isArray(v) ||
      v.length > max ||
      v.some((x) => typeof x !== 'string' || x.length > 1200)
    )
      throw new Error('Datos documentales inválidos');
    return v;
  };
  const verifiedDocuments = value.documents.filter((d: any) => {
    const url = publicUrl(d.url);
    return url && sources.has(url);
  });
  if (value.documents.length && !verifiedDocuments.length)
    throw new Error('Documento sin fuente consultada');
  const documents = verifiedDocuments.map((d: any, i: number) => {
    const scope =
      d.scope_ref === 'ACTIVO'
        ? null
        : configuration.components.find((c) => c.ref === d.scope_ref);
    if (d.scope_ref !== 'ACTIVO' && !scope)
      throw new Error('Compartición desconocida');
    const url = publicUrl(d.url);
    if (!url || !sources.has(url))
      throw new Error('Documento sin fuente consultada');
    for (const k of [
      'title',
      'publisher',
      'publication',
      'pages',
      'applicability',
    ])
      if (typeof d[k] !== 'string' || !d[k].trim() || d[k].length > 1500)
        throw new Error('Documento incompleto');
    if (
      !['MANUAL', 'FICHA'].includes(d.kind) ||
      !['MODELO', 'FAMILIA', 'INCIERTA'].includes(d.match)
    )
      throw new Error('Tipo de referencia inválido');
    const models = list(d.covered_models),
      gaps = list(d.gaps),
      criteria = list(d.criteria);
    const engine =
      scope?.category === 'MOTOR' &&
      configuration.components.filter((c) => c.category === 'MOTOR').length ===
        1;
    const identity =
      !scope || engine
        ? configuration.equipment.brand
        : [scope.name, scope.description, scope.serial].join(' ');
    const groups = officialGroups.filter((g) =>
      g.names.some((n) => normalized(identity).includes(n)),
    );
    const domain = new URL(url).hostname;
    const official = (groups.length ? groups : officialGroups).some((g) =>
      g.domains.some((h) => domain === h || domain.endsWith('.' + h)),
    );
    const exact =
      !scope || engine
        ? !!configuration.equipment.model &&
          models.some(
            (m) => normalized(m) === normalized(configuration.equipment.model),
          )
        : models.some(
            (m) =>
              normalized(m).length >= 4 &&
              [scope.name, scope.serial].some((v) =>
                normalized(v).endsWith(normalized(m)),
              ),
          );
    const applicable = official && exact && d.match === 'MODELO';
    if (!Array.isArray(d.parameters) || d.parameters.length > 10)
      throw new Error('Demasiados parámetros documentales');
    const parameters = d.parameters.map((p: any) => {
      for (const k of ['name', 'value', 'unit', 'section'])
        if (typeof p[k] !== 'string' || p[k].length > 500)
          throw new Error('Parámetro inválido');
      if (!p.name.trim() || !p.value.trim() || !p.section.trim())
        throw new Error('Parámetro sin respaldo documental');
      return p;
    });
    return {
      ref: `WEB-${i + 1}`,
      title: d.title,
      publisher: d.publisher,
      publication: d.publication,
      url,
      kind: d.kind,
      status: applicable ? 'MODELO_COINCIDE' : 'POR_CONFIRMAR',
      scope_refs: [d.scope_ref],
      pages: d.pages,
      applicability: d.applicability,
      gaps: [
        ...gaps,
        ...(!official
          ? [
              'Fuente externa: confirmar con el fabricante antes de aplicar especificaciones',
            ]
          : []),
        ...(!exact
          ? [
              'La documentación localizada no confirma la variante completa registrada',
            ]
          : []),
      ],
      criteria: applicable ? criteria : [],
      parameters,
      covered_models: models,
      match_level: applicable
        ? 'MODELO'
        : d.match === 'MODELO'
          ? 'FAMILIA'
          : d.match,
      source_type: official ? 'OFICIAL' : 'EXTERNA',
      origin: 'OPENAI_WEB',
      reviewed_at: now.toISOString(),
    };
  });
  return {
    summary: value.summary,
    gaps: [
      ...list(value.gaps, 30),
      ...(verifiedDocuments.length < value.documents.length
        ? [
            'Se omitieron documentos cuyos enlaces no pudieron respaldarse con las fuentes consultadas',
          ]
        : []),
    ],
    documents,
    sources: [...sources].map(([url, title]) => ({ url, title })),
    web_calls: calls.length,
  };
}
export function applyManufacturerResearch<
  T extends {
    configuration: any;
    manufacturer: any[];
    facts: any[];
    components: any[];
    missing: string[];
  },
>(technical: T, report: any, now: Date): T & { research: ResearchMeta } {
  const hash = configurationHash(technical.configuration);
  const valid = report?.configuration_hash === hash;
  const research: ResearchMeta = {
    configuration_hash: hash,
    status: valid
      ? Date.parse(report.expires_at) > now.getTime()
        ? 'COMPLETE'
        : 'STALE'
      : 'PENDING',
    generated_at: valid ? report.generated_at : null,
    expires_at: valid ? report.expires_at : null,
    summary: valid
      ? report.summary
      : 'Búsqueda OpenAI pendiente para esta configuración',
    web_calls: valid ? report.web_calls : 0,
  };
  if (valid) {
    const oldGaps = new Set(technical.manufacturer.flatMap((d) => d.gaps));
    technical.missing = technical.missing.filter(
      (s) =>
        !oldGaps.has(s) &&
        !s.startsWith('Sin documentación oficial identificada'),
    );
    technical.facts = technical.facts.filter((f) => !/^OEM-|^WEB-/.test(f.ref));
    technical.manufacturer = report.documents;
    for (const d of report.documents) {
      technical.facts.push({
        ref: d.ref,
        label: `${d.publisher} · ${d.title}`,
        data: d,
      });
      technical.missing.push(...d.gaps);
    }
    technical.missing.push(...report.gaps);
    for (const c of technical.components) {
      const docs = report.documents.filter((d: any) =>
        d.scope_refs.includes(c.ref),
      );
      c.manufacturer_refs = docs.map((d: any) => d.ref);
      c.evidence_refs = [
        ...c.evidence_refs.filter((r: string) => !/^OEM-|^WEB-/.test(r)),
        ...c.manufacturer_refs,
      ];
      c.gaps = c.gaps.filter(
        (s: string) => !s.startsWith('Manual de esta compartición pendiente'),
      );
      if (
        !docs.some(
          (d: any) => d.kind === 'MANUAL' && d.status === 'MODELO_COINCIDE',
        )
      )
        c.gaps.push(
          'Manual exacto no confirmado por la búsqueda de esta compartición',
        );
    }
  }
  technical.missing = [...new Set(technical.missing)];
  return Object.assign(technical, { research });
}
