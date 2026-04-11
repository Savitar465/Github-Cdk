'use strict';

const { DynamoDBClient, PutItemCommand, ScanCommand, GetItemCommand, UpdateItemCommand, DeleteItemCommand } = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({});
const tableName = process.env.TABLE_NAME;

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function toAttrValue(value) {
  if (value === null || value === undefined) {
    return { NULL: true };
  }
  if (typeof value === 'string') {
    return { S: value };
  }
  if (typeof value === 'number') {
    return { N: String(value) };
  }
  if (typeof value === 'boolean') {
    return { BOOL: value };
  }
  if (Array.isArray(value)) {
    return { L: value.map((entry) => toAttrValue(entry)) };
  }
  return { S: JSON.stringify(value) };
}

function fromAttrValue(attr) {
  if (!attr) {
    return undefined;
  }
  if (attr.S !== undefined) {
    return attr.S;
  }
  if (attr.N !== undefined) {
    return Number(attr.N);
  }
  if (attr.BOOL !== undefined) {
    return attr.BOOL;
  }
  if (attr.NULL) {
    return null;
  }
  if (attr.L) {
    return attr.L.map((entry) => fromAttrValue(entry));
  }
  return undefined;
}

function unmarshall(item) {
  if (!item) {
    return undefined;
  }

  const output = {};
  Object.keys(item).forEach((key) => {
    output[key] = fromAttrValue(item[key]);
  });
  return output;
}

function normalizeVisibility(value) {
  if (!value) {
    return 'private';
  }

  const visibility = String(value).toLowerCase();
  return visibility === 'public' ? 'public' : 'private';
}

function mapRepositoryPayload(payload) {
  const name = payload.name ? String(payload.name).trim() : '';
  const owner = payload.owner ? String(payload.owner).trim() : '';

  return {
    name,
    owner,
    description: payload.description ? String(payload.description) : '',
    visibility: normalizeVisibility(payload.visibility),
    defaultBranch: payload.defaultBranch ? String(payload.defaultBranch) : 'main',
    topics: Array.isArray(payload.topics) ? payload.topics.map((topic) => String(topic).trim()).filter(Boolean) : [],
    archived: Boolean(payload.archived),
  };
}

function parseBody(event) {
  if (!event.body) {
    return {};
  }

  if (typeof event.body === 'string') {
    return JSON.parse(event.body);
  }

  return event.body;
}

exports.handler = async (event) => {
  try {
    const method = event.httpMethod;
    const resource = event.resource;
    const id = event.pathParameters && event.pathParameters.id;
    const rawBody = parseBody(event);

    if (method === 'POST' && resource === '/repositories') {
      const repository = mapRepositoryPayload(rawBody);
      if (!repository.name || !repository.owner) {
        return response(400, { message: 'Repository requires name and owner' });
      }

      const repositoryId = rawBody.id || rawBody.slug || (repository.name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now());
      const now = new Date().toISOString();
      const newRepository = {
        id: repositoryId,
        name: repository.name,
        owner: repository.owner,
        description: repository.description,
        visibility: repository.visibility,
        defaultBranch: repository.defaultBranch,
        topics: repository.topics,
        archived: repository.archived,
        stars: 0,
        forks: 0,
        openIssues: 0,
        createdAt: now,
        updatedAt: now,
      };

      const item = {};
      Object.keys(newRepository).forEach((key) => {
        item[key] = toAttrValue(newRepository[key]);
      });

      await client.send(new PutItemCommand({ TableName: tableName, Item: item }));
      return response(201, newRepository);
    }

    if (method === 'GET' && resource === '/repositories') {
      const result = await client.send(new ScanCommand({ TableName: tableName }));
      const repositories = (result.Items || []).map((item) => unmarshall(item));
      return response(200, repositories);
    }

    if (method === 'GET' && resource === '/repositories/{id}') {
      const result = await client.send(new GetItemCommand({
        TableName: tableName,
        Key: { id: { S: id } },
      }));

      if (!result.Item) {
        return response(404, { message: 'Repository not found' });
      }

      return response(200, unmarshall(result.Item));
    }

    if (method === 'PUT' && resource === '/repositories/{id}') {
      const repositoryUpdates = mapRepositoryPayload(rawBody);
      const mutableFields = {
        name: repositoryUpdates.name,
        owner: repositoryUpdates.owner,
        description: repositoryUpdates.description,
        visibility: repositoryUpdates.visibility,
        defaultBranch: repositoryUpdates.defaultBranch,
        topics: repositoryUpdates.topics,
        archived: repositoryUpdates.archived,
        stars: typeof rawBody.stars === 'number' ? rawBody.stars : undefined,
        forks: typeof rawBody.forks === 'number' ? rawBody.forks : undefined,
        openIssues: typeof rawBody.openIssues === 'number' ? rawBody.openIssues : undefined,
        updatedAt: new Date().toISOString(),
      };

      Object.keys(mutableFields).forEach((field) => {
        if (mutableFields[field] === undefined || mutableFields[field] === '') {
          delete mutableFields[field];
        }
      });

      const fields = Object.keys(mutableFields);
      if (fields.length === 0) {
        return response(400, { message: 'No repository fields to update' });
      }

      const updateExpression = 'SET ' + fields.map((field, index) => '#f' + index + ' = :v' + index).join(', ');
      const expressionAttributeNames = {};
      const expressionAttributeValues = {};

      fields.forEach((field, index) => {
        expressionAttributeNames['#f' + index] = field;
        expressionAttributeValues[':v' + index] = toAttrValue(mutableFields[field]);
      });

      const result = await client.send(new UpdateItemCommand({
        TableName: tableName,
        Key: { id: { S: id } },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      }));

      return response(200, unmarshall(result.Attributes || {}));
    }

    if (method === 'DELETE' && resource === '/repositories/{id}') {
      await client.send(new DeleteItemCommand({
        TableName: tableName,
        Key: { id: { S: id } },
      }));
      return response(200, { message: 'Repository deleted' });
    }

    if (method === 'GET' && resource === '/health') {
      return response(200, { status: 'ok' });
    }

    return response(404, { message: 'Route not found' });
  } catch (error) {
    return response(500, {
      message: 'Internal server error',
      error: error && error.message ? error.message : 'Unknown error',
    });
  }
};

