// Creates the Hedera Consensus Service topic used for the audit trail.
// Usage: set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY in .env, run `npm run hedera:topic`,
// then put the printed id in HEDERA_TOPIC_ID.
import { hederaClient } from '../services/hedera.ts';

const { sdk, client } = await hederaClient();
const tx = await new sdk.TopicCreateTransaction().setTopicMemo('Cold-Grid audit trail').execute(client);
const receipt = await tx.getReceipt(client);
console.log(`HEDERA_TOPIC_ID=${receipt.topicId?.toString()}`);
client.close();
