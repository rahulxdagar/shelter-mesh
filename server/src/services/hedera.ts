import { config } from '../config.ts';
import type { AuditDoc } from '../types.ts';

// Only the event hash goes on-chain (SRS FR 6.3). No names, IDs or locations.
export function hederaMessage(doc: AuditDoc): string {
  return JSON.stringify({ app: 'coldgrid', v: 1, id: doc._id.toHexString(), type: doc.type, hash: doc.hash });
}

type Sdk = typeof import('@hashgraph/sdk');
let sdk: Sdk | null = null;
let client: InstanceType<Sdk['Client']> | null = null;

// The SDK is large, so it is loaded only when Hedera is configured.
export async function hederaClient() {
  if (!config.hedera) throw new Error('Hedera is not configured');
  if (client && sdk) return { sdk, client };
  sdk = await import('@hashgraph/sdk');
  const { accountId, privateKey, network } = config.hedera;
  // Portal keys: DER-encoded strings start with "302", raw hex keys are ECDSA by default.
  const key = privateKey.startsWith('302')
    ? sdk.PrivateKey.fromStringDer(privateKey)
    : sdk.PrivateKey.fromStringECDSA(privateKey);
  client = network === 'mainnet' ? sdk.Client.forMainnet() : sdk.Client.forTestnet();
  client.setOperator(sdk.AccountId.fromString(accountId), key);
  return { sdk, client };
}

export async function submitToHedera(message: string) {
  const { sdk, client } = await hederaClient();
  const topicId = config.hedera!.topicId;
  const response = await new sdk.TopicMessageSubmitTransaction({ topicId, message }).execute(client);
  const receipt = await response.getReceipt(client);
  return {
    topicId,
    sequenceNumber: receipt.topicSequenceNumber?.toString() ?? '',
    transactionId: response.transactionId.toString(),
  };
}
