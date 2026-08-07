import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountsService } from './accounts.service';
import type { AuditService } from '../common/audit.service';

const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.mock('@xhs/database', () => ({ prisma: { $transaction: transaction } }));

describe('AccountsService authorization availability', () => {
  beforeEach(() => transaction.mockClear());

  it.each(['mock', 'official', 'schema-test'])('rejects unavailable connector %s before database access', async (connectorType) => {
    const service = new AccountsService({ record: vi.fn() } as unknown as AuditService);

    await expect(service.authorize({ connectorType, platformId: 'p1', secret: 'secret', kind: 'token' }))
      .rejects.toThrow('connector authorization is not available');
    expect(transaction).not.toHaveBeenCalled();
  });
});
