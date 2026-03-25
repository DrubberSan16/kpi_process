import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CrudController } from '../../common/crud/crud.controller';
import { Attachment } from '../entities/attachment.entity';
import { AttachmentService } from './attachment.service';

@ApiTags('attachments')
@Controller('attachments')
export class AttachmentController extends CrudController<Attachment> {
  constructor(protected readonly service: AttachmentService) {
    super(service);
  }
}
