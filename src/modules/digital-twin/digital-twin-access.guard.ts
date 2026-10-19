import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

export const isTwinAdministrator = (value: unknown) =>
  [
    'SUPER ADMINISTRADOR',
    'SUPERADMINISTRADOR',
    'SUPER_ADMINISTRADOR',
    'SUPER ADMIN',
    'SUPER_ADMIN',
  ].includes(
    String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase(),
  );

/** Authenticate the token, then authorize against the CURRENT role, never client headers. */
@Injectable()
export class DigitalTwinAccessGuard implements CanActivate {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers?.authorization;
    const denied = () => new NotFoundException('Recurso no encontrado');
    if (
      typeof authorization !== 'string' ||
      !/^Bearer \S+$/i.test(authorization)
    )
      throw denied();
    try {
      const base = String(
        this.config.get('SECURITY_SERVICE_URL') ||
          'http://127.0.0.1:3015/kpi_security',
      ).replace(/\/$/, '');
      const response = await fetch(`${base}/users/session/validate`, {
        headers: { authorization },
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (!response.ok) throw denied();
      const session = (await response.json()) as any;
      const userId = session?.user?.userId;
      if (!session?.valid || session.internal || !userId) throw denied();
      const [actor] = await this.db.query(
        `
        select u.id, u.name_surname as name, r.nombre as role
        from kpi_security.tb_user u join kpi_security.tb_role r on r.id = u.role_id
        where u.id = $1 and not u.is_deleted and not r.is_deleted
          and upper(u.status) = 'ACTIVE' and upper(r.status) = 'ACTIVE'`,
        [userId],
      );
      if (!actor || !isTwinAdministrator(actor.role)) throw denied();
      request.digitalTwinActor = actor;
      return true;
    } catch {
      throw denied();
    }
  }
}
