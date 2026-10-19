import { numeric, timestamp } from './digital-twin-model';
import {
  closedOrder,
  executionDuration,
  mpgOrder,
  observedRate,
  stopsEquipment,
} from './digital-twin-duration';

export type SimulationInput = {
  days: number;
  hours_per_day: number;
  downtime_hours: number;
  rate_mode?: 'MANUAL' | 'HISTORICAL';
  include_possible?: boolean;
};
export type SimulationContext = {
  orders: any[];
  schedules: any[];
  readings: any[];
};
const HOUR = 3600000,
  DAY = 24 * HOUR;
const round = (n: number) => Number(n.toFixed(2));
const date = (v: unknown) => {
  const t = timestamp(v);
  return t ? Date.parse(t) : null;
};
const median = (values: number[]) => {
  const v = [...values].sort((a, b) => a - b),
    i = Math.floor(v.length / 2);
  return v.length ? (v.length % 2 ? v[i] : (v[i - 1] + v[i]) / 2) : null;
};
const cancelled = (o: any) =>
  o.is_deleted ||
  [
    'ANULADA',
    'ANULADO',
    'CANCELLED',
    'CANCELED',
    'CANCELADA',
    'CANCELADO',
    'VOID',
    'VOIDED',
  ].includes(String(o.status_workflow || '').toUpperCase()) ||
  [
    'ANULADA',
    'ANULADO',
    'CANCELLED',
    'CANCELED',
    'CANCELADA',
    'CANCELADO',
    'VOID',
    'VOIDED',
  ].includes(String(o.status || '').toUpperCase()) ||
  /ANULA|CANCEL|VOID/.test(
    String(o.valor_json?.approval_action || '').toUpperCase(),
  ) ||
  (o.valor_json?.annulment && typeof o.valor_json.annulment === 'object');

/** Read-only calendar scenario. Scheduled stops are merged, unknown durations remain unknown.
 * Only confirmed MPG work orders and explicitly hypothetical MPG cycles advance the cycle. */
export function simulateTwin(
  state: any,
  input: SimulationInput,
  context: SimulationContext = { orders: [], schedules: [], readings: [] },
) {
  const { days, hours_per_day, downtime_hours } = input;
  if (
    ![days, hours_per_day, downtime_hours].every(Number.isFinite) ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 365 ||
    hours_per_day < 0 ||
    hours_per_day > 24 ||
    downtime_hours < 0 ||
    downtime_hours > days * hours_per_day ||
    (input.rate_mode && !['MANUAL', 'HISTORICAL'].includes(input.rate_mode))
  )
    throw new Error('Supuestos fuera del rango permitido');
  const start = numeric(state.horometer?.estimated),
    now = date(state.as_of);
  if (start === null || now === null)
    throw new Error(
      'Se necesita un horómetro y una fecha válidos para simular',
    );
  const end = now + days * DAY;
  const calibration = observedRate(context.readings, now);
  const historical = input.rate_mode === 'HISTORICAL';
  if (historical && calibration.hours_per_day === null)
    throw new Error(
      'No hay lecturas recientes suficientes para calcular el ritmo. Selecciona operación manual.',
    );
  const rate = historical ? calibration.hours_per_day! : hours_per_day;
  if (downtime_hours > days * rate)
    throw new Error(
      'La parada adicional supera las horas de operación del escenario',
    );
  const orders = context.orders.filter((o) => !cancelled(o));
  const completed = orders.filter(
    (o) =>
      closedOrder(o) &&
      (date(o.hora_fin || o.closed_at) ?? 0) >= now - 365 * DAY,
  );
  const samples = completed
    .map((o) => ({ order: o, duration: executionDuration(o, now) }))
    .filter(
      (
        s,
      ): s is {
        order: any;
        duration: NonNullable<ReturnType<typeof executionDuration>>;
      } => !!s.duration,
    );
  const warnings: string[] = [];
  const profile = (row: any) => {
    let matching = samples.filter(
      (s) =>
        row.plan_id &&
        s.order.plan_id === row.plan_id &&
        (s.order.equipo_componente_id ?? null) ===
          (row.equipo_componente_id ?? null),
    );
    let basis = 'OT del mismo plan y compartición';
    if (!matching.length) {
      matching = samples.filter(
        (s) => row.plan_id && s.order.plan_id === row.plan_id,
      );
      basis = 'OT del mismo plan';
    }
    if (!matching.length && mpgOrder(row)) {
      matching = samples.filter((s) => mpgOrder(s.order));
      basis = 'Servicios MPG del equipo';
    }
    if (!matching.length && row.maintenance_kind && !mpgOrder(row)) {
      matching = samples.filter(
        (s) => s.order.maintenance_kind === row.maintenance_kind,
      );
      basis = 'OT del mismo tipo de mantenimiento (referencia general)';
    }
    const values = matching.map((s) => s.duration.hours);
    return {
      hours: median(values),
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      samples: values.length,
      basis: values.length ? basis : 'Sin OT comparables con tiempo válido',
      codes: matching.slice(0, 5).map((s) => s.order.code),
    };
  };
  type Intervention = {
    id: string;
    code: string;
    title: string;
    category: 'OT_REGISTRADA' | 'PROGRAMADA' | 'MPG_PROYECTADO';
    at: string | null;
    end_at: string | null;
    status: string;
    duration_hours: number | null;
    duration_basis: string;
    samples: number;
    range: [number, number] | null;
    reference_codes: string[];
    requires_stop: boolean | null;
    included: boolean;
    overdue: boolean;
    target: number | null;
    mpg: boolean;
    startMs: number | null;
    finishMs: number | null;
    thresholdWaiting?: boolean;
  };
  const interventions: Intervention[] = [];
  function add(row: any, category: Intervention['category']) {
    const estimate = profile(row);
    const scheduledStart = date(
      row.scheduled_start || row.schedule_reference || row.proxima_fecha,
    );
    const running = ['IN_PROGRESS', 'REVIEW', 'BLOCKED'].includes(
      row.status_workflow,
    );
    const threshold = numeric(row.proxima_horas);
    let begins = running ? now : scheduledStart;
    if (
      begins === null &&
      threshold !== null &&
      (rate > 0 || threshold <= start!)
    )
      begins = now! + (Math.max(0, threshold - start!) / (rate || 1)) * DAY;
    if (begins !== null && begins >= end) return;
    const overdue =
      (begins !== null && begins < now!) ||
      (threshold !== null && threshold < start!);
    const referenceStart = begins;
    if (begins !== null) begins = Math.max(now!, begins);
    const scheduledEnd = date(row.scheduled_end);
    const scheduledHours =
      scheduledStart !== null &&
      scheduledEnd !== null &&
      scheduledEnd > scheduledStart
        ? (scheduledEnd - scheduledStart) / HOUR
        : null;
    const planned = numeric(row.planned_duration);
    let duration =
      scheduledHours ??
      (planned !== null && planned > 0 ? planned : estimate.hours);
    let basis =
      scheduledHours !== null
        ? 'Ventana de la OT programada'
        : planned !== null && planned > 0
          ? 'Horas registradas en la programación mensual'
          : estimate.basis;
    if (running) {
      if (scheduledEnd !== null && scheduledEnd > now!) {
        duration = (scheduledEnd - now!) / HOUR;
        basis = 'Tiempo restante de la ventana programada';
      } else if (duration !== null) {
        const elapsed = executionDuration(row, now!)?.hours ?? 0;
        duration = Math.max(0, duration - elapsed);
        basis += ' · menos ejecución transcurrida';
        if (duration === 0)
          warnings.push(
            `${row.code}: superó la duración de referencia; tiempo restante desconocido.`,
          );
        if (duration === 0) duration = null;
      }
    }
    const included = begins !== null && duration !== null;
    interventions.push({
      id: row.id,
      code: row.code || row.codigo || 'Programación',
      title: row.title || row.plan_name || 'Mantenimiento programado',
      category,
      at: begins === null ? null : new Date(begins).toISOString(),
      end_at: included
        ? new Date(begins! + duration! * HOUR).toISOString()
        : null,
      status: row.status_workflow || 'PROGRAMADA',
      duration_hours: duration === null ? null : round(duration),
      duration_basis: basis,
      samples: estimate.samples,
      range:
        estimate.min === null
          ? null
          : [round(estimate.min), round(estimate.max!)],
      reference_codes: estimate.codes,
      requires_stop: stopsEquipment(row),
      included,
      overdue,
      target: threshold,
      mpg: mpgOrder(row),
      startMs: begins,
      finishMs: included ? begins! + duration! * HOUR : null,
      thresholdWaiting:
        !running && scheduledStart === null && threshold !== null,
    });
    if (!included)
      warnings.push(
        `${row.code || row.codigo || 'Programación'}: ${referenceStart === null ? 'sin fecha ni umbral estimable' : 'sin duración válida'}; no descuenta horas.`,
      );
    if (stopsEquipment(row) === null)
      warnings.push(
        `${row.code || row.codigo}: sin requisito de parada; se muestra la intervención sin restar operación.`,
      );
  }
  const open = orders.filter((o) => !closedOrder(o));
  for (const order of open) add(order, 'OT_REGISTRADA');
  for (const schedule of context.schedules) {
    if (
      cancelled(schedule) ||
      (schedule.work_order_id &&
        orders.some((o) => o.id === schedule.work_order_id))
    )
      continue;
    // A schedule already materialized as a closed OT is not another future intervention.
    if (schedule.work_order_id) continue;
    add(schedule, 'PROGRAMADA');
  }
  const target = numeric(state.maintenance?.target),
    interval = numeric(state.maintenance?.interval);
  let nextTarget = target,
    simulated = 0,
    counter = 0,
    unmet = false;
  const possible = input.include_possible !== false;
  const matchingMpg = samples.find(
    (s) =>
      mpgOrder(s.order) &&
      Number(
        (s.order.plan_name || '').match(/^\s*MPG[\s-]*(\d+)\s*H/i)?.[1],
      ) === interval,
  );
  const mpgReference = {
    plan_id: matchingMpg?.order.plan_id,
    plan_name: `MPG ${interval || 0} H`,
    maintenance_kind: 'PREVENTIVO',
  };
  const mpgProfile = profile(mpgReference);
  const mpgStops = samples
    .filter((s) => mpgOrder(s.order))
    .map((s) => stopsEquipment(s.order));
  // A mixed/missing requirement cannot be treated as a confirmed machine stop.
  const mpgRequiresStop =
    mpgStops.length && mpgStops.every((s) => s === true)
      ? true
      : mpgStops.length && mpgStops.every((s) => s === false)
        ? false
        : null;
  const completedMpg = new Set<string>();
  const points = [
    { day: 0, at: new Date(now).toISOString(), horometer: start },
  ];
  // Hourly integration places known stops on their actual dates and merges overlaps.
  let manualDebt = 0;
  for (let cursor = now; cursor < end; cursor += HOUR) {
    const until = Math.min(end, cursor + HOUR);
    for (const item of interventions) {
      if (
        item.thresholdWaiting &&
        item.target !== null &&
        start + simulated >= item.target
      ) {
        item.thresholdWaiting = false;
        item.startMs = cursor;
        item.at = new Date(cursor).toISOString();
        item.finishMs =
          item.duration_hours === null
            ? null
            : cursor + item.duration_hours * HOUR;
        item.end_at =
          item.finishMs === null ? null : new Date(item.finishMs).toISOString();
      }
    }
    for (const item of interventions) {
      if (
        !item.thresholdWaiting &&
        item.mpg &&
        item.finishMs !== null &&
        item.finishMs <= cursor &&
        !completedMpg.has(item.id) &&
        interval
      ) {
        nextTarget = start + simulated + interval;
        completedMpg.add(item.id);
      }
    }
    if (nextTarget !== null && start + simulated >= nextTarget) {
      unmet = true;
      const existing = interventions.some(
        (i) => i.mpg && !completedMpg.has(i.id),
      );
      if (
        possible &&
        state.maintenance?.reliable &&
        interval &&
        mpgProfile.hours !== null &&
        !existing &&
        counter < 100
      ) {
        const hours = mpgProfile.hours;
        const id = `mpg-scenario-${++counter}`;
        const finish = cursor + hours * HOUR;
        interventions.push({
          id,
          code: `MPG previsto ${counter}`,
          title: `Servicio por ciclo de ${interval} h`,
          category: 'MPG_PROYECTADO',
          at: new Date(cursor).toISOString(),
          end_at: new Date(finish).toISOString(),
          status: 'POR_CONFIRMAR',
          duration_hours: round(hours),
          duration_basis: mpgProfile.basis,
          samples: mpgProfile.samples,
          range: [round(mpgProfile.min!), round(mpgProfile.max!)],
          reference_codes: mpgProfile.codes,
          requires_stop: mpgRequiresStop,
          included: true,
          overdue: nextTarget < start,
          target: nextTarget,
          mpg: true,
          startMs: cursor,
          finishMs: finish,
        });
      }
    }
    const stops = interventions
      .filter(
        (i) =>
          !i.thresholdWaiting &&
          i.included &&
          i.requires_stop === true &&
          i.startMs! < until &&
          i.finishMs! > cursor,
      )
      .map((i) => [Math.max(cursor, i.startMs!), Math.min(until, i.finishMs!)])
      .sort((a, b) => a[0] - b[0]);
    let blocked = 0,
      last = cursor;
    for (const [a, b] of stops) {
      blocked += Math.max(0, b - Math.max(last, a));
      last = Math.max(last, b);
    }
    // h/day is an average across the day; additional idle hours use the remaining budget.
    const available = Math.max(0, ((until - cursor - blocked) / DAY) * rate);
    manualDebt += (downtime_hours / (days * 24)) * ((until - cursor) / HOUR);
    const manual = Math.min(available, manualDebt);
    manualDebt -= manual;
    simulated += available - manual;
    if ((until - now) % DAY === 0 || until === end)
      points.push({
        day: (until - now) / DAY,
        at: new Date(until).toISOString(),
        horometer: round(start + simulated),
      });
  }
  // A service finishing exactly at the horizon also advances the hypothetical cycle.
  for (const item of interventions)
    if (
      !item.thresholdWaiting &&
      item.mpg &&
      item.finishMs !== null &&
      item.finishMs <= end &&
      !completedMpg.has(item.id) &&
      interval
    ) {
      nextTarget = start + simulated + interval;
      completedMpg.add(item.id);
    }
  if (!state.maintenance?.reliable)
    warnings.push(
      'Referencia MPG no acreditada: no se generan ciclos hipotéticos.',
    );
  if (state.maintenance?.reliable && possible && mpgProfile.hours === null)
    warnings.push(
      'Sin MPG cerrados con duración válida: se muestra el vencimiento sin inventar una duración.',
    );
  if (
    mpgRequiresStop === null &&
    interventions.some((i) => i.category === 'MPG_PROYECTADO')
  )
    warnings.push(
      'Los MPG históricos no tienen un requisito de parada uniforme; los ciclos previstos no descuentan operación.',
    );
  if (counter >= 100)
    warnings.push(
      'Se alcanzó el límite de 100 ciclos hipotéticos en el escenario.',
    );
  const remaining = target === null ? null : round(target - start - simulated);
  const uniqueWarnings = [...new Set(warnings)];
  return {
    assumptions: {
      ...input,
      rate_mode: historical ? 'HISTORICAL' : 'MANUAL',
      hours_per_day: rate,
      include_possible: possible,
    },
    basis_at: state.as_of,
    start,
    added_hours: round(simulated),
    projected_horometer: round(start + simulated),
    target,
    remaining,
    exceeds_target: remaining === null ? null : remaining < 0,
    target_reliable: state.maintenance?.reliable ?? false,
    next_target: nextTarget,
    remaining_after_services:
      nextTarget === null ? null : round(nextTarget - start - simulated),
    target_reached: unmet || (target !== null && start + simulated >= target),
    points,
    calibration,
    history: {
      window_days: 365,
      closed_orders: completed.length,
      valid_durations: samples.length,
      rejected_durations: completed.length - samples.length,
      recent: samples.slice(0, 20).map((s) => ({
        code: s.order.code,
        title: s.order.title,
        kind: s.order.maintenance_kind,
        hours: round(s.duration.hours),
        basis: s.duration.source,
        closed_at: timestamp(s.order.hora_fin || s.order.closed_at),
      })),
    },
    interventions: interventions
      .filter((i) => !i.thresholdWaiting || i.startMs === null)
      .sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity))
      .map(({ mpg, startMs, finishMs, thresholdWaiting, ...item }) => item),
    scheduled_count: interventions.filter(
      (i) =>
        i.category !== 'MPG_PROYECTADO' &&
        (!i.thresholdWaiting || i.startMs === null),
    ).length,
    possible_count: counter,
    operation_lost_hours: round(
      Math.max(0, days * rate - downtime_hours - simulated),
    ),
    warnings: uniqueWarnings,
    explanation:
      'Ritmo medio distribuido durante el día; ventanas de parada superpuestas se cuentan una sola vez. ' +
      'Las OT y programaciones registradas conservan sus fechas. Los ciclos MPG previstos son escenarios pendientes de confirmar, ' +
      'no crean OT ni predicen fallas. Las horas restantes se recalculan solo al finalizar un MPG en el escenario.',
  };
}
