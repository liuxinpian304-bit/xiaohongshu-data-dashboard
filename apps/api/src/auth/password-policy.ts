export function validateAdminPasswordHash(hash: string | undefined): asserts hash is string {
  if (!hash?.startsWith('$argon2id$')) throw new Error('ADMIN_PASSWORD_HASH must be an Argon2id PHC string');
  const parameters = hash.split('$')[3];
  const values = Object.fromEntries(parameters.split(',').map((entry) => entry.split('=')));
  if (Number(values.m) < 65_536 || Number(values.t) < 3 || Number(values.p) < 1) throw new Error('ADMIN_PASSWORD_HASH Argon2id parameters are below minimum');
}
