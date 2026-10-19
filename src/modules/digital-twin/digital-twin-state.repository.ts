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
      (select coalesce(json_agg(x order by x.cerrada_en desc nulls last), '[]'::json) from (
        select wo.code as work_order_code, coalesce(wo.hora_fin, wo.closed_at) as cerrada_en,
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
      `select id,parent_id,codigo,nombre,nombre_oficial,serie,categoria,descripcion,orden
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
      `select id,codigo,compartimento_principal,fecha_muestra,fecha_reporte,
    estado_diagnostico,diagnostico,lubricante from kpi_maintenance.tb_analisis_lubricante
    where equipo_id=$1 and not is_deleted order by fecha_reporte desc nulls last,created_at desc limit 20`,
      [id],
    );
  }
  readings(id: string) {
    return this.db.query(
      `select id,horometro_anterior,horometro_nuevo,changed_at,fuente,observacion
    from kpi_maintenance.tb_equipo_horometro_historial where equipo_id=$1 order by changed_at desc limit 100`,
      [id],
    );
  }
  operations(id: string) {
    return this.db.query(
      `select id,estado_anterior,estado_nuevo,changed_at
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
