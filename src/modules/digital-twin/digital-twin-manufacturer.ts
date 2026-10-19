/** Reviewed official references. Never infer an installed option or transfer a manual across subsystems. */
const key = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
export type ManufacturerReference = {
  ref: string;
  title: string;
  publisher: string;
  publication: string;
  url: string;
  kind: 'MANUAL' | 'FICHA' | 'CONSULTA_POR_SERIE';
  status: 'MODELO_COINCIDE' | 'POR_CONFIRMAR';
  scope_refs: string[];
  pages: string;
  applicability: string;
  gaps: string[];
  criteria: string[];
  reviewed_at: string;
};
export function manufacturerReferences(
  equipment: any,
  components: any[],
): ManufacturerReference[] {
  const refs: ManufacturerReference[] = [];
  const motors = components
    .map((c, i) => ({ c, ref: `COMP-${i + 1}` }))
    .filter(({ c }) => key(c.categoria) === 'MOTOR');
  const motorScope = motors.length === 1 ? [motors[0].ref] : [];
  const brand = key(equipment.marca),
    model = key(equipment.modelo);
  const add = (data: Omit<ManufacturerReference, 'ref' | 'reviewed_at'>) =>
    refs.push({
      ...data,
      ref: `OEM-${refs.length + 1}`,
      reviewed_at: '2026-10-19',
    });
  if (brand === 'MTU' && /^12V4000(?:G\d.*)?$/.test(model)) {
    // A001064/16E p6 explicitly excludes series other than 2000Gx5/Gx6 and 4000Gx3/Gx4.
    const covered = /^12V4000G\d[34][A-Z]*$/.test(model);
    add({
      title: 'Fluids and Lubricants Specifications · Diesel generator sets',
      publisher: 'Rolls-Royce Solutions / mtu',
      publication: 'A001064/16E · 2026-01',
      url: 'https://www.mtu-solutions.com/content/dam/mtu/download/technical-info/betriebsstoffvorschrift_en/A001064_16E.pdf/_jcr_content/renditions/original./A001064_16E.pdf',
      kind: 'MANUAL',
      status: covered ? 'MODELO_COINCIDE' : 'POR_CONFIRMAR',
      scope_refs: motorScope,
      pages: '6, 9–11',
      applicability:
        'Fluidos del motor: esta edición cubre 4000Gx3 y 4000Gx4. No cubre el alternador, controlador ni transformador.',
      gaps: [
        ...(!covered
          ? [
              'Completar variante del motor: 12V4000 no confirma que sea 4000Gx3 o 4000Gx4',
            ]
          : []),
        'Confirmar configuración, categoría del aceite, combustible y condiciones de carga antes de aplicar intervalos',
      ],
      criteria: covered
        ? [
            'La frecuencia del aceite depende de su categoría, filtración, combustible y carga; el análisis debe confirmar su servicio.',
            'Los metales en una muestra aislada no permiten certificar desgaste de una pieza ni establecer límites universales de metales.',
            'Un resultado anormal requiere verificar la causa junto con el estado operativo; no equivale a vida remanente.',
          ]
        : [],
    });
  }
  if (brand === 'CUMMINS' && model === 'KTA50G9') {
    add({
      title: 'KTA50-G9 · Technical Data',
      publisher: 'Cummins',
      publication: 'PD00000072 · 07/21',
      url: 'https://mart.cummins.com/imagelibrary/data/assetfiles/0070368.pdf',
      kind: 'FICHA',
      status: 'MODELO_COINCIDE',
      scope_refs: motorScope,
      pages: '1–2',
      applicability:
        'Ficha del motor KTA50-G9; no es su manual de operación ni certifica opciones instaladas.',
      gaps: [
        'Confirmar ESN, aplicación y opciones antes de usar capacidades o frecuencias',
      ],
      criteria: [
        'El motor dispone de circuitos de refrigeración separados para camisa y posenfriamiento.',
        'La ficha distingue filtración de combustible con separador de agua y filtración de lubricante.',
      ],
    });
    add({
      title: 'Manuales Cummins por número de serie (ESN)',
      publisher: 'Cummins',
      publication: 'Engine Manual Lookup / QuickServe',
      url: 'https://www.cummins.com/en-in/parts/manuals-and-technical-documents',
      kind: 'CONSULTA_POR_SERIE',
      status: 'POR_CONFIRMAR',
      scope_refs: motorScope,
      pages: 'Consulta por ESN',
      applicability:
        'Seleccionar el manual correspondiente al ESN y configuración reales del motor.',
      gaps: [
        'Manual de operación y mantenimiento exacto pendiente de identificación por ESN',
      ],
      criteria: [],
    });
  }
  if (['CAT', 'CATERPILLAR'].includes(brand) && model === '3512B') {
    add({
      title: '3512B · Diesel generator sets',
      publisher: 'Caterpillar',
      publication: 'Cat · 3512B 60 Hz',
      url: 'https://www.cat.com/en_US/products/new/power-systems/electric-power/diesel-generator-sets/1000028914.html',
      kind: 'FICHA',
      status: 'MODELO_COINCIDE',
      scope_refs: motorScope,
      pages: 'Engine specifications',
      applicability:
        'Descripción de familia del grupo diésel; validar placa y aplicación del equipo instalado.',
      gaps: [
        'No usar intervalos de versiones marinas, petroleras o Dynamic Gas Blending para un grupo diésel sin confirmación',
      ],
      criteria: [
        'La familia descrita utiliza motor diésel V de cuatro tiempos refrigerado por agua e inyección unitaria electrónica.',
      ],
    });
    add({
      title: '3512B · Manuals and resources',
      publisher: 'Caterpillar',
      publication: 'Cat Parts · selección por serie',
      url: 'https://parts.cat.com/en/catcorp/equipment/engine/3512B-99/manuals-and-resources',
      kind: 'CONSULTA_POR_SERIE',
      status: 'POR_CONFIRMAR',
      scope_refs: motorScope,
      pages: 'Consulta por serie/prefijo',
      applicability:
        'El prefijo y número de serie determinan el manual de operación y mantenimiento.',
      gaps: ['Manual exacto pendiente de identificación por prefijo y serie'],
      criteria: [],
    });
  }
  components.forEach((c, i) => {
    const identity = key([c.nombre, c.nombre_oficial, c.descripcion].join(' '));
    if (identity.includes('WOODWARD') && identity.includes('EASYGEN3500XT')) {
      add({
        title:
          'easYgen-3400XT-P1 / 3500XT-P1 / 3500XT-P1-LT · Technical Manual',
        publisher: 'Woodward',
        publication: '37668 · revisión congelada de 37580A · Release 1.12',
        url: 'https://www.woodward.com/products/wp-content/uploads/sites/3/2024/08/37668_NEW.pdf',
        kind: 'MANUAL',
        status: 'POR_CONFIRMAR',
        scope_refs: [`COMP-${i + 1}`],
        pages: 'Portada / aplicabilidad',
        applicability:
          'Referencia para variante P1 y Release 1.12; no extender a P2 ni a otro firmware.',
        gaps: [
          'Confirmar variante P1/P2, referencia de hardware y firmware para seleccionar la revisión aplicable',
        ],
        criteria: [],
      });
    }
    if (identity.includes('LEROYSOMER') && /LSA502(?!\d)/.test(identity)) {
      add({
        title: 'LSA 50.2 · Manual de instrucciones',
        publisher: 'Nidec Power / Leroy-Somer',
        publication: '4099 es · 2026.06 / y',
        url: 'https://www.leroy-somer.com/documentation_pdf/4099_es.pdf',
        kind: 'MANUAL',
        status: 'MODELO_COINCIDE',
        scope_refs: [`COMP-${i + 1}`],
        pages: '4, 12–14',
        applicability:
          'Solo el alternador LSA 50.2 identificado; confirmar placa, excitación y versión de cojinetes.',
        gaps: [
          'Sin mediciones de aislamiento, temperatura, vibración o placa completa no se acredita condición eléctrica ni vida de cojinetes',
        ],
        criteria: [
          'El mantenimiento comprueba conexiones, fijaciones, ventilación y aislamiento; las intervenciones requieren personal cualificado y evitar arranque automático.',
          'Después de limpiar el alternador se comprueba el aislamiento de los bobinados.',
          'Las opciones y la placa determinan las condiciones nominales; no se usan horas del motor como vida de cojinetes.',
        ],
      });
    }
  });
  return refs;
}
