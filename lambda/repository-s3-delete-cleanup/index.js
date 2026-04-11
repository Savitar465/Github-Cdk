'use strict';

const { DynamoDBClient, DeleteItemCommand } = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({});
const tableName = process.env.TABLE_NAME;

function extractRepositoryIdFromKey(key) {
  const match = key.match(/^repositories\/([^/]+)\//);
  return match ? match[1] : undefined;
}

exports.handler = async (event) => {
  const records = event && event.Records ? event.Records : [];
  const repositoryIds = new Set();

  records.forEach((record) => {
    const key = record && record.s3 && record.s3.object && record.s3.object.key
      ? decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '))
      : '';

    const repositoryId = extractRepositoryIdFromKey(key);
    if (repositoryId) {
      repositoryIds.add(repositoryId);
    }
  });

  for (const repositoryId of repositoryIds) {
    await client.send(new DeleteItemCommand({
      TableName: tableName,
      Key: { id: { S: repositoryId } },
    }));
  }

  return {
    deleted: repositoryIds.size,
  };
};

