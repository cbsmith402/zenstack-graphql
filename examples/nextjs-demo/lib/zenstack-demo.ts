import path from 'node:path';
import fs from 'node:fs/promises';

import Database from 'better-sqlite3';
import { ZenStackClient } from '@zenstackhq/orm';
import type { ClientContract } from '@zenstackhq/orm';
import { SqliteDialect } from '@zenstackhq/orm/dialects/sqlite';

import { schema } from '@/zenstack/schema';

const DATABASE_PATH = path.join(process.cwd(), 'zenstack', 'dev.db');

type DemoClient = ClientContract<typeof schema>;

declare global {
    var __ZENSTACK_GRAPHQL_DEMO_CLIENT__: DemoClient | undefined;
    var __ZENSTACK_GRAPHQL_DEMO_INIT__: Promise<void> | undefined;
}

function createClient() {
    const sqlite = new Database(DATABASE_PATH);
    sqlite.pragma('foreign_keys = ON');
    return new ZenStackClient(schema, {
        dialect: new SqliteDialect({ database: sqlite }),
    });
}

export function getDemoClient() {
    if (!globalThis.__ZENSTACK_GRAPHQL_DEMO_CLIENT__) {
        globalThis.__ZENSTACK_GRAPHQL_DEMO_CLIENT__ = createClient();
    }
    return globalThis.__ZENSTACK_GRAPHQL_DEMO_CLIENT__;
}

async function seedDemoDatabase(client: DemoClient) {
    if ((await client.user.count()) > 0) {
        return;
    }

    const ada = await client.user.create({
        data: {
            name: 'Ada',
            age: 34,
            role: 'ADMIN',
        },
    });

    const ben = await client.user.create({
        data: {
            name: 'Ben',
            age: 19,
            role: 'USER',
        },
    });

    await client.post.createMany({
        data: [
            { title: 'ZenStack Intro', authorId: ada.id, views: 5 },
            { title: 'Hasura Notes', authorId: ada.id, views: 8 },
            { title: 'GraphQL Adapter', authorId: ben.id, views: 13 },
        ],
    });
}

export async function ensureDemoDatabaseReady() {
    if (!globalThis.__ZENSTACK_GRAPHQL_DEMO_INIT__) {
        globalThis.__ZENSTACK_GRAPHQL_DEMO_INIT__ = (async () => {
            const client = getDemoClient();
            await fs.mkdir(path.dirname(DATABASE_PATH), { recursive: true });
            await client.$pushSchema();
            await seedDemoDatabase(client);
        })();
    }

    await globalThis.__ZENSTACK_GRAPHQL_DEMO_INIT__;
    return getDemoClient();
}

export async function resetDemoDatabase() {
    const client = await ensureDemoDatabaseReady();
    await client.post.deleteMany({});
    await client.user.deleteMany({});
    await seedDemoDatabase(client);
}

export async function getDemoSnapshot() {
    const client = await ensureDemoDatabaseReady();
    const users = await client.user.findMany({
        orderBy: { id: 'asc' },
        include: {
            posts: {
                orderBy: { id: 'asc' },
            },
        },
    });

    return {
        databasePath: DATABASE_PATH,
        users,
    };
}
