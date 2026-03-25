# kpi-process-main

Microservicio NestJS para el esquema `kpi_process`.

## Variables de entorno
Crea un archivo `.env` con valores similares a estos:

```env
PORT=3000
BASE_PATH=/kpi_process
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASS=postgres
DB_NAME=justice_kpi
DB_SSL=false
```

## Scripts
```bash
npm install
npm run start:dev
npm run build
```

## Swagger
Si defines `BASE_PATH`, Swagger queda disponible en:
- `/<prefix>/docs`
- `/<prefix>/docs-json`

## Cobertura inicial
Este proyecto cubre las tablas del esquema `kpi_process`:
- tb_attachment
- tb_checklist_run
- tb_checklist_run_item
- tb_checklist_template
- tb_checklist_template_item
- tb_equipment
- tb_location
- tb_maintenance_plan
- tb_work_order
- tb_work_order_status_history

## Nota de arquitectura
En el SQL actual existen señales de solapamiento entre `kpi_process` y `kpi_maintenance` (por ejemplo `tb_work_order` referencia `kpi_maintenance.tb_equipo` y `kpi_maintenance.tb_plan_mantenimiento` mediante FKs `NOT VALID`). Este microservicio quedó preparado para exponer el esquema actual sin alterar tu base, pero conviene consolidar la responsabilidad funcional cuando integremos el frontend.

