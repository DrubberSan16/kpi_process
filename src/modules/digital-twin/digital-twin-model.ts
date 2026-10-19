/** Deterministic operational model. No sensor values or health percentages are invented. */
export const numeric = (value: unknown): number | null => {
  if (value === null || value === undefined || String(value).trim() === '')
    return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
export function timestamp(value: unknown): string | null {
  if (!value) return null;
  // PostgreSQL timestamps without a zone are Guayaquil local time.
  let raw = value instanceof Date ? value.toISOString() : String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) raw += 'T00:00:00';
  const date = new Date(
    /(?:Z|[+-]\d\d:?\d\d)$/.test(raw) ? raw : `${raw.replace(' ', 'T')}-05:00`,
  );
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function horometer(equipment: any, now: Date) {
  const measured = numeric(equipment.horometro_actual);
  const since = timestamp(equipment.horometro_operativo_desde);
  const elapsed = since ? (now.getTime() - Date.parse(since)) / 3600000 : 0;
  const running = equipment.estado_funcionamiento === 'FUNCIONAMIENTO';
  const validClock = running && !!since && elapsed >= 0;
  return {
    measured,
    measured_at: timestamp(equipment.fecha_ultima_lectura),
    estimated:
      measured === null
        ? null
        : Number((measured + (validClock ? elapsed : 0)).toFixed(2)),
    calculated: validClock,
    clock_since: since,
    source: 'Registro de equipo y reloj operativo',
    clock_issue:
      running && !validClock
        ? 'Reloj operativo ausente o con fecha futura'
        : null,
  };
}
export function maintenanceTarget(equipment: any, current: number | null) {
  const interval = numeric(equipment.intervalo_mantenimiento_valor);
  if (
    current === null ||
    !interval ||
    interval <= 0 ||
    !/^HORAS?$/.test(
      String(equipment.intervalo_mantenimiento_unidad || '').toUpperCase(),
    )
  )
    return null;
  const services: any[] = Array.isArray(equipment.servicios_mpg)
    ? equipment.servicios_mpg
    : [];
  const usable = services.find((s) => {
    const n = numeric(s.horometro);
    return n !== null && n > 0 && n <= current;
  });
  const reliable = !!usable && usable === services[0];
  const base = usable
    ? numeric(usable.horometro)!
    : Math.floor(current / interval) * interval;
  const target = base + interval;
  return {
    interval,
    base,
    target,
    remaining: Number((target - current).toFixed(2)),
    reliable,
    service_code: usable?.work_order_code ?? null,
    explanation: reliable
      ? 'Último servicio MPG cerrado por horas'
      : usable
        ? 'El último MPG no tiene lectura válida; referencia de un servicio anterior'
        : 'Sin lectura MPG válida; ciclo supuesto en múltiplos de la frecuencia',
  };
}
export function evaluateCondition(
  equipment: any,
  alerts: any[],
  oil: any[],
  target: any,
  complete: boolean,
) {
  const reasons: string[] = [];
  let critical = false;
  if (['CORRECTIVO', 'BLOQUEADA'].includes(equipment.estado_operativo)) {
    critical = true;
    reasons.push(`Estado operativo: ${equipment.estado_operativo}`);
  }
  if (alerts.length) reasons.push(`${alerts.length} alertas abiertas`);
  if (
    alerts.some((a) =>
      ['CRITICAL', 'CRITICA', 'CRÍTICA', 'ALTO'].includes(
        String(a.nivel).toUpperCase(),
      ),
    )
  )
    critical = true;
  const oilState = String(oil[0]?.estado_diagnostico ?? '').toUpperCase();
  if (['ALERTA', 'ANORMAL', 'CRITICO', 'CRÍTICO'].includes(oilState)) {
    critical = true;
    reasons.push(`Lubricante: ${oilState}`);
  }
  if (
    ['PRECAUCION', 'PRECAUCIÓN', 'OBSERVACION', 'OBSERVACIÓN'].includes(
      oilState,
    )
  )
    reasons.push(`Lubricante: ${oilState}`);
  if (target?.reliable && target.remaining < 0) {
    critical = true;
    reasons.push(`MPG vencido por ${Math.abs(target.remaining)} h`);
  } else if (
    target?.reliable &&
    target.remaining <=
      (target.interval * Number(equipment.margen_anticipacion_pct ?? 10)) / 100
  )
    reasons.push('MPG próximo');
  return {
    status: critical
      ? 'CRITICO'
      : reasons.length
        ? 'ATENCION'
        : complete
          ? 'SIN_HALLAZGOS'
          : 'SIN_DATOS',
    reasons,
    basis: 'Reglas sobre registros operativos; requiere verificación física',
  };
}
export { simulateTwin } from './digital-twin-simulation';
