import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ENTITIES } from './modules/entities';
import { AttachmentModule } from './modules/attachment/attachment.module';
import { ChecklistRunModule } from './modules/checklist-run/checklist-run.module';
import { ChecklistRunItemModule } from './modules/checklist-run-item/checklist-run-item.module';
import { ChecklistTemplateModule } from './modules/checklist-template/checklist-template.module';
import { ChecklistTemplateItemModule } from './modules/checklist-template-item/checklist-template-item.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { DigitalTwinModule } from './modules/digital-twin/digital-twin.module';
import { LocationModule } from './modules/location/location.module';
import { MaintenancePlanModule } from './modules/maintenance-plan/maintenance-plan.module';
import { WorkOrderModule } from './modules/work-order/work-order.module';
import { WorkOrderStatusHistoryModule } from './modules/work-order-status-history/work-order-status-history.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const sslEnabled = String(config.get('DB_SSL') || 'false') === 'true';
        const appTimeZone =
          String(config.get('APP_TIMEZONE') || '').trim() ||
          'America/Guayaquil';
        return {
          type: 'postgres',
          host: config.get('DB_HOST'),
          port: Number(config.get('DB_PORT') || 5432),
          username: config.get('DB_USER'),
          password: config.get('DB_PASS'),
          database: config.get('DB_NAME'),
          schema: 'kpi_process',
          entities: ENTITIES,
          autoLoadEntities: false,
          synchronize: false,
          logging: false,
          ssl: sslEnabled ? { rejectUnauthorized: false } : false,
          extra: { options: `-c timezone=${appTimeZone}` },
        };
      },
    }),
    AttachmentModule,
    ChecklistRunModule,
    ChecklistRunItemModule,
    ChecklistTemplateModule,
    ChecklistTemplateItemModule,
    DigitalTwinModule,
    EquipmentModule,
    LocationModule,
    MaintenancePlanModule,
    WorkOrderModule,
    WorkOrderStatusHistoryModule,
  ],
})
export class AppModule {}
