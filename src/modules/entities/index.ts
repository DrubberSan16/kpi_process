export * from './attachment.entity';
export * from './checklist-run.entity';
export * from './checklist-run-item.entity';
export * from './checklist-template.entity';
export * from './checklist-template-item.entity';
export * from './equipment.entity';
export * from './digital-twin.entity';
export * from './location.entity';
export * from './maintenance-plan.entity';
export * from './work-order.entity';
export * from './work-order-status-history.entity';

import { Attachment } from './attachment.entity';
import { ChecklistRun } from './checklist-run.entity';
import { ChecklistRunItem } from './checklist-run-item.entity';
import { ChecklistTemplate } from './checklist-template.entity';
import { ChecklistTemplateItem } from './checklist-template-item.entity';
import { Equipment } from './equipment.entity';
import {
  DigitalTwin,
  DigitalTwinInsight,
  DigitalTwinSignal,
} from './digital-twin.entity';
import { Location } from './location.entity';
import { MaintenancePlan } from './maintenance-plan.entity';
import { WorkOrder } from './work-order.entity';
import { WorkOrderStatusHistory } from './work-order-status-history.entity';

export const ENTITIES = [
  Attachment,
  ChecklistRun,
  ChecklistRunItem,
  ChecklistTemplate,
  ChecklistTemplateItem,
  Equipment,
  DigitalTwin,
  DigitalTwinSignal,
  DigitalTwinInsight,
  Location,
  MaintenancePlan,
  WorkOrder,
  WorkOrderStatusHistory
];
