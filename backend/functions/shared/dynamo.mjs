// Thin DynamoDB document-client wrapper. One table, keyed by bookingId, with a
// `byDate` GSI (PK dateISO) so we can list a day's bookings to enforce capacity.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME;

export async function putBooking(item) {
  await doc.send(new PutCommand({ TableName: TABLE, Item: item }));
}

export async function getBooking(bookingId) {
  const { Item } = await doc.send(new GetCommand({ TableName: TABLE, Key: { bookingId } }));
  return Item || null;
}

// Every booking for one date, via the byDate GSI. Capacity counting happens in code.
export async function queryByDate(dateISO) {
  const { Items } = await doc.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'byDate',
    KeyConditionExpression: 'dateISO = :d',
    ExpressionAttributeValues: { ':d': dateISO },
  }));
  return Items || [];
}

// Flip a pending booking to paid, but only if it isn't already paid.
// ConditionalCheckFailed => already processed (idempotent webhook retries).
export async function markPaid(bookingId, paymentIntentId) {
  await doc.send(new UpdateCommand({
    TableName: TABLE,
    Key: { bookingId },
    UpdateExpression: 'SET #s = :paid, paidAt = :now, paymentIntentId = :pi',
    ConditionExpression: 'attribute_exists(bookingId) AND #s <> :paid',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':paid': 'paid',
      ':now': new Date().toISOString(),
      ':pi': paymentIntentId || null,
    },
  }));
}
