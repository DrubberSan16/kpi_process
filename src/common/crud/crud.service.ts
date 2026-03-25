import { Injectable, NotFoundException } from '@nestjs/common';
import { DeepPartial, Repository } from 'typeorm';

@Injectable()
export class CrudService<T extends { id: string }> {
  constructor(private readonly repository: Repository<T>) {}

  private hasColumn(propertyName: string): boolean {
    return this.repository.metadata.columns.some(
      (column) => column.propertyName === propertyName,
    );
  }

  create(payload: DeepPartial<T>) {
    const entity = this.repository.create(payload);
    return this.repository.save(entity);
  }

  async findAll(page = 1, limit = 10, includeDeleted = false) {
    const safePage = Number.isFinite(+page) && +page > 0 ? +page : 1;
    const safeLimit =
      Number.isFinite(+limit) && +limit > 0 ? Math.min(+limit, 100) : 10;

    const qb = this.repository.createQueryBuilder('item');

    if (this.hasColumn('is_deleted') && !includeDeleted) {
      qb.andWhere('item.is_deleted = :isDeleted', { isDeleted: false });
    }

    if (this.hasColumn('created_at')) {
      qb.orderBy('item.created_at', 'DESC');
    } else if (this.hasColumn('changed_at')) {
      qb.orderBy('item.changed_at', 'DESC');
    }

    qb.skip((safePage - 1) * safeLimit).take(safeLimit);
    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async findOne(id: string) {
    const qb = this.repository
      .createQueryBuilder('item')
      .where('item.id = :id', { id });

    if (this.hasColumn('is_deleted')) {
      qb.andWhere('item.is_deleted = :isDeleted', { isDeleted: false });
    }

    const item = await qb.getOne();
    if (!item) {
      throw new NotFoundException(`Registro ${id} no encontrado`);
    }
    return item;
  }

  async update(id: string, payload: DeepPartial<T>) {
    const current = await this.findOne(id);
    const merged = this.repository.merge(current, payload);
    return this.repository.save(merged);
  }

  async remove(id: string, deletedBy?: string) {
    const current = await this.findOne(id);
    const entity = current as Record<string, unknown>;

    if (this.hasColumn('is_deleted')) {
      entity.is_deleted = true;
      if (this.hasColumn('deleted_at')) entity.deleted_at = new Date();
      if (this.hasColumn('deleted_by')) entity.deleted_by = deletedBy ?? null;
      await this.repository.save(entity as T);
      return { message: `Registro ${id} eliminado correctamente` };
    }

    await this.repository.delete(id);
    return { message: `Registro ${id} eliminado físicamente` };
  }
}
