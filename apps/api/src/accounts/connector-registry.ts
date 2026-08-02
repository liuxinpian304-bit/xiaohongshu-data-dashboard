import { Injectable } from '@nestjs/common';

export interface AuthorizationRevocationConnector {
  getCapabilities(): Promise<{ revokeAuthorization?: boolean }>;
  revokeAuthorization?(input: { accountId: string }): Promise<{ revoked: true }>;
}

@Injectable()
export class ConnectorRegistry {
  private readonly connectors: Map<string, AuthorizationRevocationConnector>;
  constructor(entries: Iterable<readonly [string, AuthorizationRevocationConnector]> = []) { this.connectors = new Map(entries); }
  register(connectorType: string, connector: AuthorizationRevocationConnector) { if (!connectorType) throw new Error('connectorType is required'); this.connectors.set(connectorType, connector); }
  resolve(connectorType: string) { return this.connectors.get(connectorType); }
}
