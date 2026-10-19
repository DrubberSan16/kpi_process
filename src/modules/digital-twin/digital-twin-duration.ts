import { numeric, timestamp } from './digital-twin-model';

const at = (value: unknown): number | null => {
  const date = timestamp(value);
  return date ? Date.parse(date) : null;
};
export const closedOrder = (row: any) =>
  ['CLOSED', 'CERRADA', 'CERRADO'].includes(
    String(row.status_workflow).toUpperCase(),
  );
export const mpgOrder = (row: any) =>
  !['CEBADO', 'PROYECTO'].includes(
    String(row.maintenance_kind).toUpperCase(),
  ) && /^\s*MPG[\s-]*\d+\s*H/i.test(row.plan_name || '');

/** Mirrors Maintenance.workOrderStopsEquipment: execution stops the asset,
 * except CEBADO and PROYECTO, regardless of the template's old stop flag. */
export function stopsEquipment(row: any): boolean | null {
  const kind = String(row.maintenance_kind || '')
    .trim()
    .toUpperCase();
  if (
    ['CEBADO', 'PROYECTO'].includes(kind) ||
    /\bCEBAD[OA]/i.test(row.plan_name || '')
  )
    return false;
  if (kind || mpgOrder(row)) return true;
  return typeof row.requires_stop === 'boolean' ? row.requires_stop : null;
}

/** Uses execution timestamps, never the creation-to-close administrative delay.
 * CEBADO excludes REVIEW, following the reports' worked-hours rule. */
export function executionDuration(row: any, now: number) {
  const history = (Array.isArray(row.history) ? row.history : [])
    .map((event: any, index: number) => ({
      ...event,
      at: at(event.changed_at),
      index,
    }))
    .filter((event: any) => event.at !== null && event.at <= now)
    .sort((a: any, b: any) => a.at - b.at || a.index - b.index);
  const first = history.find(
    (h: any) =>
      h.to_status === 'IN_PROGRESS' && h.from_status !== 'IN_PROGRESS',
  );
  const headerStart = at(row.started_at),
    headerEnd = at(row.closed_at);
  const fallback = [
    first?.at,
    headerStart !== headerEnd ? headerStart : null,
  ].filter((n): n is number => typeof n === 'number');
  const cebado = String(row.maintenance_kind).toUpperCase() === 'CEBADO';
  const start =
    (cebado ? null : at(row.hora_inicio)) ??
    at(row.valor_json?.execution_start?.at) ??
    (fallback.length ? Math.min(...fallback) : null);
  if (start === null || start > now) return null;
  const closings = history.filter(
    (h: any) =>
      h.to_status === 'CLOSED' && h.from_status !== 'CLOSED' && h.at >= start,
  );
  const finish =
    (cebado ? null : at(row.hora_fin)) ?? closings.at(-1)?.at ?? headerEnd;
  if (closedOrder(row) && (finish === null || finish > now || finish <= start))
    return null;
  const end = finish ?? now;
  if (end < start) return null;
  let hours = (end - start) / 3600000;
  if (cebado) {
    let cursor = start,
      state = 'IN_PROGRESS',
      elapsed = 0;
    for (const event of history) {
      if (event.at < start || event.at > end) continue;
      if (state !== 'REVIEW' && state !== 'CLOSED')
        elapsed += event.at - cursor;
      cursor = event.at;
      state = event.to_status || state;
    }
    if (state !== 'REVIEW' && state !== 'CLOSED') elapsed += end - cursor;
    hours = elapsed / 3600000;
  }
  if (hours <= 0 || hours > 8760 || !Number.isFinite(hours)) return null;
  return {
    hours,
    source: cebado
      ? 'Ejecución sin revisión (cebado)'
      : at(row.hora_inicio) !== null && at(row.hora_fin) !== null
        ? 'Inicio y fin de ejecución'
        : 'Historial de ejecución de la OT',
  };
}

export function observedRate(readings: any[], now: number) {
  const rows = readings
    .map((r) => ({ at: at(r.changed_at), value: numeric(r.horometro_nuevo) }))
    .filter(
      (r) =>
        r.at !== null &&
        r.at <= now &&
        r.at >= now - 180 * 86400000 &&
        r.value !== null,
    )
    .sort((a, b) => a.at! - b.at!);
  const rates: number[] = [];
  let elapsed = 0,
    hours = 0,
    rejected = 0;
  for (let i = 1; i < rows.length; i++) {
    const delta = rows[i].value! - rows[i - 1].value!;
    const span = (rows[i].at! - rows[i - 1].at!) / 3600000;
    // Corrections, duplicate timestamps and physically impossible deltas are not usage.
    if (span < 1 || span > 90 * 24 || delta < 0 || delta > span * 1.02) {
      rejected++;
      continue;
    }
    elapsed += span;
    hours += delta;
    rates.push(Math.min(24, (delta / span) * 24));
  }
  const available = rates.length >= 2 && elapsed >= 24;
  const stale = !rows.length || now - rows.at(-1)!.at! > 30 * 86400000;
  return {
    hours_per_day:
      available && !stale
        ? Number(Math.min(24, (hours / elapsed) * 24).toFixed(2))
        : null,
    samples: rates.length,
    rejected,
    observed_days: Number((elapsed / 24).toFixed(1)),
    from: rows[0]?.at ? new Date(rows[0].at).toISOString() : null,
    to: rows.at(-1)?.at ? new Date(rows.at(-1)!.at!).toISOString() : null,
    stale,
    source:
      'Incrementos válidos entre lecturas del horómetro (máximo 180 días)',
  };
}
