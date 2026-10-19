import { NotFoundException } from '@nestjs/common';
import { DigitalTwinAccessGuard } from './digital-twin-access.guard';
describe('Acceso exclusivo y oculto', () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });
  function fixture(headers: any, role = 'Super Administrador') {
    const req: any = { headers };
    const db = { query: jest.fn().mockResolvedValue([{ id: 'user', role }]) };
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const guard = new DigitalTwinAccessGuard(db as any, config as any);
    const context = { switchToHttp: () => ({ getRequest: () => req }) };
    global.fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          valid: true,
          internal: false,
          user: { userId: 'user', roleName: 'Super Administrador' },
        }),
      });
    return { guard, context, req, db };
  }
  it.each([
    'Administrador',
    'Técnico',
    'Supervisor',
    'Operador',
    'Gerente General',
    '',
  ])(
    'oculta el recurso para %s aunque el JWT o encabezado diga Super Administrador',
    async (role) => {
      const { guard, context } = fixture(
        { authorization: 'Bearer token', 'x-role-name': 'Super Administrador' },
        role,
      );
      await expect(guard.canActivate(context as any)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    },
  );
  it('exige autenticación real y no acepta el acceso interno por encabezados', async () => {
    const f = fixture({ 'x-role-name': 'Super Administrador' });
    await expect(f.guard.canActivate(f.context as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(global.fetch).not.toHaveBeenCalled();
    const g = fixture({ authorization: 'Bearer token' });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        valid: true,
        internal: true,
        user: { userId: 'user' },
      }),
    });
    await expect(g.guard.canActivate(g.context as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it('autoriza al perfil actual y no reenvía encabezados de suplantación', async () => {
    const { guard, context, req } = fixture({
      authorization: 'Bearer token',
      'x-internal-service-token': 'untrusted',
    });
    await expect(guard.canActivate(context as any)).resolves.toBe(true);
    expect(req.digitalTwinActor.id).toBe('user');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { authorization: 'Bearer token' } }),
    );
  });
});
