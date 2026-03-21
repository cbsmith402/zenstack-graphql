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

async function ensureDemoSchemaCompatibility() {
    await fs.mkdir(path.dirname(DATABASE_PATH), { recursive: true });
    const sqlite = new Database(DATABASE_PATH);
    try {
        const userColumns = sqlite
            .prepare(`PRAGMA table_info("User")`)
            .all() as Array<{ name?: string }>;

        const hasUserTable = userColumns.length > 0;
        const hasProfile = userColumns.some((column) => column.name === 'profile');
        if (hasUserTable && !hasProfile) {
            sqlite.exec(`ALTER TABLE "User" ADD COLUMN "profile" TEXT`);
        }
    } finally {
        sqlite.close();
    }
}

export function getDemoClient() {
    if (!globalThis.__ZENSTACK_GRAPHQL_DEMO_CLIENT__) {
        globalThis.__ZENSTACK_GRAPHQL_DEMO_CLIENT__ = createClient();
    }
    return globalThis.__ZENSTACK_GRAPHQL_DEMO_CLIENT__;
}

async function seedDemoDatabase(client: DemoClient) {
    const ada = await client.user.create({
        data: {
            name: 'Ada',
            age: 34,
            role: 'ADMIN',
            profile: {
                bio: 'Typescript developer and query planner',
                interests: ['graphql', 'zenstack'],
                location: {
                    city: 'Boston',
                    region: 'MA',
                },
            },
        },
    });

    const ben = await client.user.create({
        data: {
            name: 'Ben',
            age: 19,
            role: 'USER',
            profile: {
                bio: 'Frontend builder exploring adapters',
                interests: ['react', 'sqlite'],
                location: {
                    city: 'New York',
                    region: 'NY',
                },
            },
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

function resetDemoSequences() {
    const sqlite = new Database(DATABASE_PATH);
    try {
        sqlite.exec(`DELETE FROM sqlite_sequence WHERE name IN ('User', 'Post')`);
    } finally {
        sqlite.close();
    }
}

async function reseedDemoDatabase(client: DemoClient) {
    await client.post.deleteMany({});
    await client.user.deleteMany({});
    resetDemoSequences();
    await seedDemoDatabase(client);
}

export async function ensureDemoDatabaseReady() {
    if (!globalThis.__ZENSTACK_GRAPHQL_DEMO_INIT__) {
        globalThis.__ZENSTACK_GRAPHQL_DEMO_INIT__ = (async () => {
            await ensureDemoSchemaCompatibility();
            const client = getDemoClient();
            await client.$pushSchema();
            await reseedDemoDatabase(client);
        })();
    }

    await globalThis.__ZENSTACK_GRAPHQL_DEMO_INIT__;
    return getDemoClient();
}

export async function resetDemoDatabase() {
    const client = await ensureDemoDatabaseReady();
    await reseedDemoDatabase(client);
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
