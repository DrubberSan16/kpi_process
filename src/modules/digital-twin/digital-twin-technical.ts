import { numeric, timestamp } from './digital-twin-model';
import { closedOrder, mpgOrder } from './digital-twin-duration';
import { manufacturerReferences } from './digital-twin-manufacturer';

const normalized = (v: unknown) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
const time = (v: unknown) => {
  const s = timestamp(v);
  return s ? Date.parse(s) : null;
};
const rounded = (v: number) => Number(v.toFixed(2));
const validOrder = (o: any) =>
  !o.is_deleted &&
  !/ANULA|CANCEL|VOID/.test(
    (
      String(o.status || '') +
      ' ' +
      String(o.status_workflow || '') +
      ' ' +
      String(o.valor_json?.approval_action || '')
    ).toUpperCase(),
  ) &&
  !(o.valor_json?.annulment && typeof o.valor_json.annulment === 'object');

/** Facts are calculated here, never by the language model. No generic OEM limits. */
export function technicalEvidence(
  equipment: any,
  components: any[],
  orders: any[],
  oil: any[],
  clock: any,
  now: Date,
) {
  const at = now.getTime(),
    current = numeric(clock.estimated);
  const correctionAt = time(equipment.last_counter_correction_at);
  const facts: Array<{
    ref: string;
    label: string;
    data: Record<string, unknown>;
  }> = [];
  const missing: string[] = [];
  const add = (ref: string, label: string, data: Record<string, unknown>) => {
    facts.push({ ref, label, data });
    return ref;
  };
  add('FICHA', 'Ficha registrada en Equipos', {
    codigo: equipment.codigo,
    nombre: equipment.nombre,
    tipo: equipment.nombre_real,
    marca: equipment.marca || null,
    modelo: equipment.modelo || null,
    serie: equipment.numero_serie || null,
    criticidad: equipment.criticidad,
    estado: equipment.estado_operativo,
    actualizada_en: timestamp(equipment.updated_at),
    fabricante_verificado: false,
  });
  for (const [key, label] of [
    ['marca', 'marca'],
    ['modelo', 'modelo'],
    ['numero_serie', 'serie'],
  ])
    if (!String(equipment[key] || '').trim())
      missing.push(`Ficha de equipo sin ${label}`);
  if (!components.length) missing.push('Equipo sin comparticiones vinculadas');
  const manufacturer = manufacturerReferences(equipment, components);
  if (!manufacturer.length)
    missing.push(
      'Sin documentación oficial identificada para el modelo registrado',
    );
  for (const document of manufacturer) {
    add(document.ref, `${document.publisher} · ${document.publication}`, {
      ...document,
    });
    missing.push(...document.gaps);
  }
  missing.push(
    'La identificación por modelo no acredita configuración por serie ni permite certificar vida remanente',
  );
  add('RELOJ', 'Horómetro automático', {
    horometro_actual: current,
    funcionamiento: equipment.estado_funcionamiento,
    base_persistida: numeric(equipment.horometro_actual),
    avance_desde: clock.clock_since,
    modo: 'AUTOMATICO',
    incidencia: clock.clock_issue || null,
    calculado_en: now.toISOString(),
    ultima_correccion_descendente: timestamp(
      equipment.last_counter_correction_at,
    ),
  });
  if (current === null || clock.clock_issue)
    missing.push(clock.clock_issue || 'Horómetro automático sin base válida');
  const rows = orders.filter(validOrder);
  const complete = rows
    .filter(
      (o) =>
        closedOrder(o) &&
        time(o.hora_fin || o.closed_at)! <= at &&
        time(o.hora_fin || o.closed_at)! > 0,
    )
    .sort(
      (a, b) =>
        time(b.hora_fin || b.closed_at)! - time(a.hora_fin || a.closed_at)!,
    );
  const services = equipment.servicios_mpg || [];
  const last = services[0];
  const lastHour = numeric(last?.horometro),
    lastTime = time(last?.cerrada_en);
  const reliable =
    !!last &&
    lastHour !== null &&
    lastHour > 0 &&
    current !== null &&
    lastHour <= current &&
    lastTime !== null &&
    lastTime <= at &&
    (correctionAt === null || lastTime >= correctionAt);
  const mpg = {
    code: last?.work_order_code || null,
    plan: last?.plan_nombre || null,
    at: timestamp(last?.cerrada_en),
    horometer: lastHour,
    reliable,
    hours_since: reliable ? rounded(current! - lastHour!) : null,
    interval: /^HORAS?$/.test(
      String(equipment.intervalo_mantenimiento_unidad).toUpperCase(),
    )
      ? numeric(equipment.intervalo_mantenimiento_valor)
      : null,
  };
  add('MPG', 'Último MPG realizado', mpg);
  if (!reliable)
    missing.push(
      'Último MPG sin fecha u horómetro coherentes: no se acredita el recorrido desde el servicio',
    );
  if (!mpg.interval) missing.push('Frecuencia MPG por horas sin configurar');
  const issues: string[] = [];
  const ids = new Set(components.map((c) => c.id));
  const match = (row: any, kind: 'order' | 'oil') => {
    if (kind === 'order' && row.equipo_componente_id)
      return components.find((c) => c.id === row.equipo_componente_id) || null;
    const names =
      kind === 'order'
        ? [row.equipo_componente_nombre_oficial, row.equipo_componente_codigo]
        : [row.compartimento_principal];
    const candidates = components.filter((c) =>
      names.some(
        (name) =>
          normalized(name) &&
          [
            c.nombre,
            c.nombre_oficial,
            c.codigo,
            ...(kind === 'oil' ? [c.categoria] : []),
          ].some((n) => normalized(n) === normalized(name)),
      ),
    );
    return candidates.length === 1 ? candidates[0] : null;
  };
  const latestOil = new Map<string, any>();
  const unmatchedOil: string[] = [];
  for (const sample of [...oil].sort(
    (a, b) => (time(b.fecha_muestra) || 0) - (time(a.fecha_muestra) || 0),
  )) {
    const component = match(sample, 'oil');
    if (!component) {
      unmatchedOil.push(sample.codigo);
      continue;
    }
    if (!latestOil.has(component.id)) latestOil.set(component.id, sample);
  }
  const componentRows = components.map((c, index) => {
    const ref = `COMP-${index + 1}`;
    if (c.parent_id && !ids.has(c.parent_id))
      issues.push(
        `${c.nombre_oficial || c.nombre}: componente padre no disponible`,
      );
    let cursor = c;
    const visited = new Set<string>();
    while (cursor?.parent_id && !visited.has(cursor.id)) {
      visited.add(cursor.id);
      cursor = components.find((p) => p.id === cursor.parent_id);
    }
    if (cursor && visited.has(cursor.id))
      issues.push(
        `${c.nombre_oficial || c.nombre}: relación circular en la estructura`,
      );
    const related = rows.filter((o) => match(o, 'order')?.id === c.id);
    const lastIntervention = complete.find(
      (o) =>
        !['CEBADO', 'PROYECTO'].includes(o.maintenance_kind) &&
        match(o, 'order')?.id === c.id,
    );
    const orderHour =
      numeric(lastIntervention?.valor_json?.horometro_inicio_ejecucion) ??
      numeric(lastIntervention?.valor_json?.horometro_actual);
    const delta =
      current !== null &&
      orderHour !== null &&
      orderHour >= 0 &&
      orderHour <= current &&
      (correctionAt === null ||
        time(lastIntervention?.hora_fin || lastIntervention?.closed_at)! >=
          correctionAt)
        ? rounded(current - orderHour)
        : null;
    const documents = manufacturer.filter((document) =>
      document.scope_refs.includes(ref),
    );
    const references = [ref, ...documents.map((document) => document.ref)];
    const intervention = lastIntervention
      ? {
          code: lastIntervention.code,
          title: lastIntervention.title,
          at: timestamp(
            lastIntervention.hora_fin || lastIntervention.closed_at,
          ),
          horometer: orderHour,
          hours_since: delta,
        }
      : null;
    if (intervention)
      references.push(
        add(
          `OT-COMP-${index + 1}`,
          `Última intervención · ${lastIntervention.code}`,
          intervention,
        ),
      );
    const sample = latestOil.get(c.id);
    let lab: any = null;
    if (sample) {
      const sampleAt = time(sample.fecha_muestra),
        age = sampleAt === null ? null : Math.floor((at - sampleAt) / 86400000);
      lab = {
        code: sample.codigo,
        compartment: sample.compartimento_principal,
        sampled_at: timestamp(sample.fecha_muestra),
        reported_at: timestamp(sample.fecha_reporte),
        age_days: age,
        valid_date: age !== null && age >= 0,
        condition: sample.estado_diagnostico,
        diagnosis: sample.diagnostico,
        equipment_hours: numeric(
          sample.payload_json?.sample_info?.horas_equipo,
        ),
        lubricant_hours: numeric(
          sample.payload_json?.sample_info?.horas_lubricante,
        ),
        lubricant: sample.lubricante,
        measurements: (sample.measurements || []).filter(
          (m: any) =>
            !m.compartimento ||
            normalized(m.compartimento) ===
              normalized(sample.compartimento_principal),
        ),
        thresholds: sample.payload_json?.rangos_generales || {},
        laboratory: {
          grade:
            sample.payload_json?.informe_laboratorio?.grado_declarado || null,
          standard:
            sample.payload_json?.informe_laboratorio?.norma_grado || null,
        },
      };
      references.push(
        add(`LAB-COMP-${index + 1}`, `Análisis · ${sample.codigo}`, lab),
      );
    }
    const gaps: string[] = [];
    if (
      !documents.some(
        (d) => d.kind === 'MANUAL' && d.status === 'MODELO_COINCIDE',
      )
    )
      gaps.push(
        'Manual de esta compartición pendiente de identificación o de confirmar su variante',
      );
    if (!c.serie) gaps.push('Serie de compartición sin registrar');
    if (!intervention)
      gaps.push('Sin intervención cerrada vinculada a esta compartición');
    else if (delta === null)
      gaps.push('No se puede calcular el recorrido desde la intervención');
    const oilApplicability = sample
      ? 'CONFIRMADA'
      : /MOTOR|TRANSMISION|REDUCTOR|HIDRAULIC|COMPRESOR/.test(
            normalized(c.categoria) +
              ' ' +
              normalized(c.nombre_oficial || c.nombre),
          )
        ? 'ESPERADA'
        : 'NO_DETERMINADA';
    if (!sample && oilApplicability === 'ESPERADA')
      gaps.push('Sin análisis de lubricante vinculado de forma inequívoca');
    if (lab && !lab.valid_date) gaps.push('Fecha de muestra ausente o futura');
    const data = {
      name: c.nombre_oficial || c.nombre,
      code: c.codigo,
      category: c.categoria,
      serie: c.serie || null,
      parent:
        components.find((p) => p.id === c.parent_id)?.nombre_oficial || null,
      description: c.descripcion || null,
      closed_orders: related.filter(closedOrder).length,
      open_orders: related
        .filter((o) => !closedOrder(o))
        .map((o) => ({
          code: o.code,
          title: o.title,
          status: o.status_workflow,
        })),
      last_intervention: intervention,
      oil: lab,
      oil_applicability: oilApplicability,
      manufacturer_refs: documents.map((document) => document.ref),
      gaps,
    };
    add(ref, `Compartición · ${data.name}`, {
      name: data.name,
      code: data.code,
      serie: data.serie,
      category: data.category,
      parent: data.parent,
      description: data.description,
      closed_orders: data.closed_orders,
      open_orders: data.open_orders,
      gaps,
    });
    return { ref, ...data, evidence_refs: references };
  });
  if (unmatchedOil.length)
    missing.push(
      `${unmatchedOil.length} análisis de lubricante sin vinculación inequívoca a una compartición`,
    );
  if (issues.length) missing.push(...issues);
  const unmapped = rows.filter(
    (o) => o.equipo_componente_id && !ids.has(o.equipo_componente_id),
  ).length;
  if (unmapped)
    missing.push(`${unmapped} OT apuntan a una compartición no disponible`);
  add('HISTORIAL', 'Historial de mantenimiento', {
    total: rows.length,
    closed: complete.length,
    pending: rows.filter((o) => !closedOrder(o)).length,
    mpg_closed: complete.filter(mpgOrder).length,
    unmapped_orders: unmapped,
    unmatched_oil: unmatchedOil,
  });
  return {
    as_of: now.toISOString(),
    mpg,
    manufacturer,
    components: componentRows,
    component_count: components.length,
    component_serial_count: components.filter((c) => !!c.serie).length,
    issues,
    missing,
    facts,
    scope:
      'Cruce de Equipos, manuales y fichas oficiales por modelo y compartición, horómetro automático, OT y laboratorio. La aplicabilidad se indica por documento. El recorrido es del equipo y no acredita vida útil de una pieza.',
  };
}

export function technicalQuality(
  equipment: any,
  technical: ReturnType<typeof technicalEvidence>,
  statuses: any[],
  now: Date,
) {
  const source = (key: string) => statuses.find((s) => s.key === key);
  return [
    {
      key: 'technical_sheet',
      label: 'Ficha registrada del equipo',
      status:
        equipment.marca && equipment.modelo && equipment.numero_serie
          ? 'DISPONIBLE'
          : 'INCOMPLETA',
      latest_at: timestamp(equipment.updated_at),
      detail: `${equipment.marca || 'Marca pendiente'} · ${equipment.modelo || 'Modelo pendiente'} · Serie ${equipment.numero_serie || 'sin registrar'}`,
    },
    {
      key: 'manufacturer',
      label: 'Manuales y fichas del fabricante',
      status: technical.manufacturer.length ? 'INCOMPLETA' : 'SIN_REGISTROS',
      count: technical.manufacturer.length,
      detail: `${technical.manufacturer.length} referencias oficiales · ${technical.components.filter((c) => technical.manufacturer.some((d) => d.kind === 'MANUAL' && d.status === 'MODELO_COINCIDE' && d.scope_refs.includes(c.ref))).length} comparticiones con manual por modelo · Configuración por confirmar`,
    },
    {
      key: 'components',
      label: 'Comparticiones del equipo',
      status: source('components')?.status || 'NO_DISPONIBLE',
      count:
        source('components')?.status === 'NO_DISPONIBLE'
          ? null
          : technical.component_count,
      detail:
        source('components')?.status === 'NO_DISPONIBLE'
          ? 'Consulta de comparticiones no disponible'
          : `${technical.component_count} comparticiones · ${technical.component_serial_count} con serie${technical.issues.length ? ' · Revisar estructura' : ''}`,
    },
    {
      key: 'last_mpg',
      label: 'Horómetro del último MPG realizado',
      status: technical.mpg.reliable
        ? 'DISPONIBLE'
        : technical.mpg.code
          ? 'INCOMPLETA'
          : 'SIN_REGISTROS',
      latest_at: technical.mpg.at,
      detail: technical.mpg.code
        ? `${technical.mpg.code} · ${technical.mpg.horometer ?? 'Lectura no disponible'} h`
        : 'Sin MPG cerrado verificable',
    },
    {
      key: 'orders',
      label: 'Historial de OT ejecutadas y pendientes',
      status: source('technical_orders')?.status || 'NO_DISPONIBLE',
      count: source('technical_orders')?.count,
      detail:
        source('technical_orders')?.status === 'NO_DISPONIBLE'
          ? 'Consulta no disponible'
          : `${source('technical_orders')?.count ?? 0} OT consultadas`,
      latest_at: source('technical_orders')?.latest_at,
    },
    {
      key: 'oil',
      label: 'Análisis por compartición',
      status: source('oil')?.status || 'NO_DISPONIBLE',
      count: source('oil')?.count,
      detail:
        source('oil')?.status === 'NO_DISPONIBLE'
          ? 'Consulta de laboratorio no disponible'
          : `${source('oil')?.count ?? 0} análisis consultados · ${technical.components.filter((c) => !!c.oil).length} comparticiones vinculadas`,
      latest_at: source('oil')?.latest_at,
    },
  ].map((row) => ({ ...row, checked_at: now.toISOString() }));
}
