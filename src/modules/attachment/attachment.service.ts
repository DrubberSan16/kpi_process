import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrudService } from '../../common/crud/crud.service';
import { Attachment } from '../entities/attachment.entity';

@Injectable()
export class AttachmentService extends CrudService<Attachment> {
  constructor(@InjectRepository(Attachment) repository: Repository<Attachment>) {
    super(repository);
  }
}
