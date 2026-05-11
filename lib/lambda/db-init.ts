import { Client } from 'pg';

const DB_HOST = process.env.DB_HOST!;
const DB_PASSWORD = process.env.DB_PASSWORD!;
const DB_NAMES = (process.env.DB_NAMES ?? '').split(',').filter(Boolean);

async function connectWithRetry(retries = 10, delayMs = 15_000): Promise<Client> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const client = new Client({
      host: DB_HOST,
      port: 5432,
      user: 'postgres',
      password: DB_PASSWORD,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10_000,
      query_timeout: 10_000,
      statement_timeout: 10_000,
    });
    try {
      await client.connect();
      console.log(`Connected on attempt ${attempt}`);
      return client;
    } catch (err) {
      console.log(`Attempt ${attempt}/${retries} failed: ${(err as Error).message}`);
      await client.end().catch(() => {});
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('Exhausted connection retries');
}

export const handler = async () => {
  const client = await connectWithRetry();
  try {
    for (const name of DB_NAMES) {
      const { rowCount } = await client.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [name],
      );
      if (!rowCount) {
        await client.query(`CREATE DATABASE "${name}"`);
        console.log(`Created database: ${name}`);
      } else {
        console.log(`Database already exists: ${name}`);
      }
    }
  } finally {
    await client.end().catch(() => {});
  }
};
