import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

// Same maintenance-cycle selection as Maintenance's SERVICIOS_MPG_SQL.
const annulled = `'ANULADA','ANULADO','CANCELLED','CANCELED','CANCELADA','CANCELADO','VOID','VOIDED'`;
@Injectable()
export class DigitalTwinStateRepository {
  constructor(private readonly db: DataSource) {}

  equipment(id: string) {
    return this.db.query(
      `select e.*, m.nombre as marca, l.nombre as ubicacion, s.nombre as central,
      (select max(h.changed_at) from kpi_maintenance.tb_equipo_horometro_historial h
        where h.equipo_id=e.id and h.horometro_nuevo<h.horometro_anterior and h.changed_at<=now()) as last_counter_correction_at,
      (select coalesce(json_agg(x order by x.cerrada_en desc nulls last), '[]'::json) from (
        select wo.code as work_order_code, p.nombre as plan_nombre, coalesce(wo.hora_fin, wo.closed_at) as cerrada_en,
          coalesce(nullif(wo.valor_json->>'horometro_actual',''),nullif(wo.valor_json->>'horometro_inicio_ejecucion','')) as horometro
        from kpi_process.tb_work_order wo join kpi_maintenance.tb_plan_mantenimiento p on p.id=wo.plan_id
        where wo.equipment_id=e.id and not wo.is_deleted
          and upper(wo.status_workflow) in ('CLOSED','CERRADA','CERRADO')
          and upper(coalesce(wo.maintenance_kind,'')) not in ('CEBADO','PROYECTO')
          and upper(coalesce(wo.status,'')) not in (${annulled})
          and upper(coalesce(wo.valor_json->>'approval_action','')) not in (${annulled})
          and coalesce(jsonb_typeof(wo.valor_json::jsonb->'annulment'),'') <> 'object'
          and p.nombre ~* '^[[:space:]]*MPG[[:space:]-]*[0-9]+[[:space:]]*H'
      ) x) as servicios_mpg
      from kpi_maintenance.tb_equipo e
      left join kpi_inventory.tb_marca m on m.id=e.marca_id
      left join kpi_maintenance.tb_location l on l.id=e.location_id
      left join kpi_inventory.tb_sucursal s on s.id=l.sucursal_id
      where e.id=$1 and not e.is_deleted limit 1`,
      [id],
    );
  }
  components(id: string) {
    return this.db.query(
      `select id,parent_id,codigo,nombre,nombre_oficial,serie,categoria,descripcion,orden,updated_at
    from kpi_maintenance.tb_equipo_componente where equipo_id=$1 and not is_deleted order by orden,nombre`,
      [id],
    );
  }
  alerts(id: string) {
    return this.db.query(
      `select id,tipo_alerta,detalle,nivel,estado,fecha_generada,ultima_evaluacion_at
    from kpi_maintenance.tb_alerta_mantenimiento where equipo_id=$1 and not is_deleted
      and upper(estado) in ('ABIERTA','EN_PROCESO') order by fecha_generada desc limit 200`,
      [id],
    );
  }
  orders(id: string) {
    return this.db.query(
      `select id,code,title,status_workflow,maintenance_kind,equipo_componente_id,
    equipo_componente_nombre_oficial,started_at,closed_at,created_at
    from kpi_process.tb_work_order where equipment_id=$1 and not is_deleted
      and upper(coalesce(status,'')) not in (${annulled})
      and upper(coalesce(valor_json->>'approval_action','')) not in (${annulled})
      and coalesce(jsonb_typeof(valor_json::jsonb->'annulment'),'') <> 'object'
    order by coalesce(closed_at,started_at,created_at) desc limit 100`,
      [id],
    );
  }
  oil(id: string) {
    return this.db.query(
      `select a.id,a.codigo,a.compartimento_principal,a.fecha_muestra,a.fecha_reporte,
    a.estado_diagnostico,a.diagnostico,a.lubricante,a.payload_json,a.documento_origen,
    coalesce((select json_agg(d order by d.orden) from (select compartimento,parametro,resultado_numerico,resultado_texto,
      unidad,linea_base,nivel_alerta,tendencia,observacion,orden from kpi_maintenance.tb_analisis_lubricante_det
      where analisis_id=a.id and not is_deleted) d),'[]'::json) as measurements
    from kpi_maintenance.tb_analisis_lubricante a
    where a.equipo_id=$1 and not a.is_deleted order by a.fecha_muestra desc nulls last,a.fecha_reporte desc nulls last,a.created_at desc limit 200`,
      [id],
    );
  }
  readings(id: string) {
    return this.db.query(
      `select id,horometro_anterior,horometro_nuevo,changed_at,fuente,observacion,changed_by as actor
    from kpi_maintenance.tb_equipo_horometro_historial where equipo_id=$1
      and changed_at >= now()-interval '180 days' order by changed_at desc limit 1000`,
      [id],
    );
  }
  operations(id: string) {
    return this.db.query(
      `select id,estado_anterior,estado_nuevo,changed_at,changed_by as actor
    from kpi_maintenance.tb_equipo_funcionamiento_historial where equipo_id=$1 order by changed_at desc limit 100`,
      [id],
    );
  }
  locations(id: string) {
    return this.db.query(
      `select id,location_codigo,location_nombre,sucursal_nombre,valid_from,valid_to,source
    from kpi_maintenance.tb_equipo_ubicacion_historial where equipo_id=$1 order by valid_from desc limit 100`,
      [id],
    );
  }

  orderEvents(id: string) {
    return this.db.query(
      `select h.id,h.changed_at,h.from_status,h.to_status,h.note,
      w.code,w.title,coalesce(nullif(u.name_surname,''),nullif(u.name_user,''),h.changed_by::text,'Usuario sin registro') as actor
      from kpi_process.tb_work_order_status_history h
      join kpi_process.tb_work_order w on w.id=h.work_order_id
      left join kpi_security.tb_user u on u.id=h.changed_by
      where w.equipment_id=$1 and not w.is_deleted
        and upper(coalesce(w.status,'')) not in (${annulled})
        and upper(coalesce(w.status_workflow,'')) not in (${annulled})
        and upper(coalesce(w.valor_json->>'approval_action','')) not in (${annulled})
        and coalesce(jsonb_typeof(w.valor_json::jsonb->'annulment'),'') <> 'object'
      order by h.changed_at desc limit 100`,
      [id],
    );
  }

  simulationOrders(id: string, asOf: string, allHistory = false) {
    return this.db.query(
      `select w.*,p.nombre as plan_name,p.requiere_parada as requires_stop,
      coalesce(w.scheduled_start::text,nullif(w.valor_json->>'fecha_programacion',''),sp.proxima_fecha::text) as schedule_reference,
      coalesce((select json_agg(h order by h.changed_at) from (
        select changed_at,from_status,to_status from kpi_process.tb_work_order_status_history
        where work_order_id=w.id) h),'[]'::json) as history
      from kpi_process.tb_work_order w
      left join kpi_maintenance.tb_plan_mantenimiento p on p.id=w.plan_id
      left join lateral (select proxima_fecha from kpi_maintenance.tb_programacion_plan
        where work_order_id=w.id and activo and not is_deleted order by updated_at desc limit 1) sp on true
      where w.equipment_id=$1 and not w.is_deleted
        and upper(coalesce(w.status,'')) not in (${annulled})
        and upper(coalesce(w.status_workflow,'')) not in (${annulled})
        and upper(coalesce(w.valor_json->>'approval_action','')) not in (${annulled})
        and coalesce(jsonb_typeof(w.valor_json::jsonb->'annulment'),'') <> 'object'
        and ($3::boolean or upper(w.status_workflow) not in ('CLOSED','CERRADA','CERRADO')
          or coalesce(w.hora_fin,w.closed_at) >= ($2::timestamptz at time zone 'America/Guayaquil')-interval '365 days')
      order by coalesce(w.hora_fin,w.closed_at,w.started_at,w.created_at) desc`,
      [id, asOf, allHistory],
    );
  }

  simulationSchedules(id: string) {
    return this.db.query(
      `select s.id,s.codigo as code,s.work_order_id,s.plan_id,s.proxima_fecha,s.proxima_horas,
      p.nombre as plan_name,p.requiere_parada as requires_stop,md.horas_mantenimiento as planned_duration,p.tipo as maintenance_kind
      from kpi_maintenance.tb_programacion_plan s
      left join kpi_maintenance.tb_plan_mantenimiento p on p.id=s.plan_id
      left join lateral (select d.horas_mantenimiento from kpi_maintenance.tb_programacion_mensual_det d
        join kpi_maintenance.tb_programacion_mensual m on m.id=d.programacion_mensual_id
        where d.programacion_id=s.id and not d.is_deleted and not m.is_deleted
        and upper(d.status)='ACTIVE' and upper(m.status)='ACTIVE'
        order by d.updated_at desc limit 1) md on true
      where s.equipo_id=$1 and s.activo and not s.is_deleted and upper(s.status)='ACTIVE'
      union all
      select d.id,concat(m.codigo,' · ',d.valor_normalizado),null::uuid,d.plan_id,d.fecha_programada,
        null::numeric,p.nombre,p.requiere_parada,d.horas_mantenimiento,p.tipo
      from kpi_maintenance.tb_programacion_mensual_det d
      join kpi_maintenance.tb_programacion_mensual m on m.id=d.programacion_mensual_id
      left join kpi_maintenance.tb_plan_mantenimiento p on p.id=d.plan_id
      where d.equipo_id=$1 and d.programacion_id is null and not d.is_deleted and not m.is_deleted
        and d.es_sincronizable and upper(d.status)='ACTIVE' and upper(m.status)='ACTIVE'`,
      [id],
    );
  }

  async capture(id: string, state: any, actor: string) {
    // Serialize captures per twin and save the current state + append-only history atomically.
    return this.db.transaction(async (manager) => {
      await manager.query(
        'select id from kpi_process.tb_digital_twin where id=$1 for update',
        [id],
      );
      const [record] = await manager.query(
        `insert into kpi_process.tb_digital_twin_state
        (digital_twin_id,recorded_at,recorded_by,state_json) values ($1,now(),$2,$3::jsonb)
        returning id,recorded_at,recorded_by`,
        [id, actor, JSON.stringify(state)],
      );
      await manager.query(
        `update kpi_process.tb_digital_twin set snapshot_json=$2::jsonb,
        last_snapshot_at=now(),operational_status=$3,updated_at=now(),updated_by=$4 where id=$1`,
        [id, JSON.stringify(state), state.condition.status, actor],
      );
      return record;
    });
  }
  history(id: string) {
    return this.db.query(
      `select id,recorded_at,recorded_by,
    state_json->'horometer' as horometer,state_json->'condition' as condition,
    state_json->'identity' as identity,state_json->'quality' as quality
    from kpi_process.tb_digital_twin_state where digital_twin_id=$1 order by recorded_at desc limit 100`,
      [id],
    );
  }
  captureById(id: string, captureId: string) {
    return this.db.query(
      `select id,recorded_at,recorded_by,state_json
    from kpi_process.tb_digital_twin_state where digital_twin_id=$1 and id=$2`,
      [id, captureId],
    );
  }
}
