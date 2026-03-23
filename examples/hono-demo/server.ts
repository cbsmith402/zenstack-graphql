import path from 'node:path';
import fs from 'node:fs/promises';

import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { ZenStackClient } from '@zenstackhq/orm';
import type { ClientContract } from '@zenstackhq/orm';
import { SqliteDialect } from '@zenstackhq/orm/dialects/sqlite';
import {
    GraphQLNonNull,
    GraphQLString,
    createZenStackGraphQLSchemaFactory,
    printSchema,
    type CreateZenStackGraphQLSchemaFactoryOptions,
    type SchemaSlicingConfig,
} from 'zenstack-graphql/core';
import { createHonoGraphQLHandler } from 'zenstack-graphql/hono';

import { schema } from './zenstack/schema.js';

const PORT = Number(process.env.PORT ?? 4002);
const DATABASE_PATH = path.join(process.cwd(), 'zenstack', 'dev.db');
const DEMO_ROLE_HEADER = 'x-hasura-role';
const DEFAULT_DEMO_ROLE = 'admin';

type DemoRole = 'admin' | 'user';
type DemoClient = ClientContract<typeof schema>;

declare global {
    var __ZENSTACK_GRAPHQL_HONO_CLIENT__: DemoClient | undefined;
    var __ZENSTACK_GRAPHQL_HONO_INIT__: Promise<void> | undefined;
}

const sampleOperations = [
    {
        label: 'Role-pruned Query',
        query: `query RolePruned {
  users(order_by: [{ id: asc }]) {
    id
    name
    age
  }
}`,
    },
    {
        label: 'JSON Filter',
        query: `query JsonFilter {
  users(where: { profile: { path: "$.bio", string_contains: "builder" } }) {
    id
    name
    profile
  }
}`,
    },
    {
        label: 'Relay Node',
        query: `query RelayUsers {
  users_connection(first: 1, order_by: [{ id: asc }]) {
    edges {
      cursor
      node {
        id
        name
      }
    }
  }
}`,
    },
];

const serverExtensions = {
    query: {
        demoSummary: {
            type: new GraphQLNonNull(GraphQLString),
            async resolve(
                _source: unknown,
                _args: Record<string, unknown>,
                _context: unknown,
                _info: unknown,
                { client }: { client: Awaited<ReturnType<typeof ensureDemoDatabaseReady>> }
            ) {
                const [userCount, postCount] = await Promise.all([
                    client.user.count(),
                    client.post.count(),
                ]);
                return `${userCount} users, ${postCount} posts`;
            },
        },
    },
};

function normalizeDemoRole(input: string | undefined): DemoRole {
    return input?.toLowerCase() === 'user' ? 'user' : DEFAULT_DEMO_ROLE;
}

function createClient() {
    const sqlite = new Database(DATABASE_PATH);
    sqlite.pragma('foreign_keys = ON');
    return new ZenStackClient(schema, {
        dialect: new SqliteDialect({ database: sqlite }),
        procedures: {
            async getUserFeeds({ client, args }) {
                return client.post.findMany({
                    where: { authorId: args.userId },
                    orderBy: { createdAt: 'desc' },
                    take: args.limit ?? undefined,
                });
            },
        },
    });
}

async function ensureDemoSchemaCompatibility() {
    await fs.mkdir(path.dirname(DATABASE_PATH), { recursive: true });
    const sqlite = new Database(DATABASE_PATH);
    try {
        const userColumns = sqlite.prepare(`PRAGMA table_info("User")`).all() as Array<{
            name?: string;
        }>;
        const hasUserTable = userColumns.length > 0;
        const hasProfile = userColumns.some((column) => column.name === 'profile');
        if (hasUserTable && !hasProfile) {
            sqlite.exec(`ALTER TABLE "User" ADD COLUMN "profile" TEXT`);
        }
    } finally {
        sqlite.close();
    }
}

function getDemoClient() {
    if (!globalThis.__ZENSTACK_GRAPHQL_HONO_CLIENT__) {
        globalThis.__ZENSTACK_GRAPHQL_HONO_CLIENT__ = createClient();
    }
    return globalThis.__ZENSTACK_GRAPHQL_HONO_CLIENT__;
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
                interests: ['hono', 'sqlite'],
            },
        },
    });

    await client.post.createMany({
        data: [
            { title: 'ZenStack Intro', authorId: ada.id, views: 5 },
            { title: 'Hasura Notes', authorId: ada.id, views: 8 },
            { title: 'Hono Adapter', authorId: ben.id, views: 13 },
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

async function ensureDemoDatabaseReady() {
    if (!globalThis.__ZENSTACK_GRAPHQL_HONO_INIT__) {
        globalThis.__ZENSTACK_GRAPHQL_HONO_INIT__ = (async () => {
            await ensureDemoSchemaCompatibility();
            const client = getDemoClient();
            await client.$pushSchema();
            await reseedDemoDatabase(client);
        })();
    }

    await globalThis.__ZENSTACK_GRAPHQL_HONO_INIT__;
    return getDemoClient();
}

async function getDemoSnapshot() {
    const client = await ensureDemoDatabaseReady();
    return client.user.findMany({
        orderBy: { id: 'asc' },
        include: { posts: { orderBy: { id: 'asc' } } },
    });
}

function getRoleSlicing(role: DemoRole): SchemaSlicingConfig | undefined {
    if (role !== 'user') {
        return undefined;
    }
    return {
        models: {
            user: {
                excludedFields: ['age'],
                excludedOperations: ['deleteMany', 'deleteByPk'],
            },
        },
    };
}

const schemaFactoryOptions: CreateZenStackGraphQLSchemaFactoryOptions<
    Awaited<ReturnType<typeof ensureDemoDatabaseReady>>,
    { role: DemoRole },
    DemoRole
> = {
    schema,
    relay: { enabled: true },
    async getClient() {
        return ensureDemoDatabaseReady();
    },
    getSlicing(context) {
        return getRoleSlicing(context.role);
    },
    getCacheKey({ context }) {
        return context.role;
    },
    extensions: serverExtensions,
};

const graphqlSchemaFactory = createZenStackGraphQLSchemaFactory(schemaFactoryOptions);

const graphqlHandler = createHonoGraphQLHandler({
    schema,
    relay: { enabled: true },
    async getClient() {
        return ensureDemoDatabaseReady();
    },
    getContext(request) {
        return {
            role: normalizeDemoRole(request.headers.get(DEMO_ROLE_HEADER) ?? undefined),
        };
    },
    getSlicing(_request, context) {
        return getRoleSlicing(context.role);
    },
    getCacheKey({ context }) {
        return context.role;
    },
    extensions: serverExtensions,
});

async function main() {
    await ensureDemoDatabaseReady();

    const app = new Hono();

    app.get('/', (c) => {
        return c.json({
            ok: true,
            framework: 'hono',
            endpoint: '/api/graphql',
            schemaEndpoint: '/api/schema',
            resetEndpoint: '/api/reset',
            stateEndpoint: '/api/state',
            roleHeader: DEMO_ROLE_HEADER,
            sampleOperations,
        });
    });

    app.get('/api/schema', async (c) => {
        const role = normalizeDemoRole(c.req.header(DEMO_ROLE_HEADER) ?? undefined);
        return c.text(printSchema(await graphqlSchemaFactory.getSchema({ role })));
    });

    app.get('/api/state', async (c) => {
        return c.json({
            databasePath: DATABASE_PATH,
            users: await getDemoSnapshot(),
        });
    });

    app.post('/api/reset', async (c) => {
        const client = await ensureDemoDatabaseReady();
        await reseedDemoDatabase(client);
        return c.json({ ok: true });
    });

    app.all('/api/graphql', (c) => graphqlHandler(c));

    serve(
        {
            fetch: app.fetch,
            port: PORT,
        },
        (info) => {
            console.log(`zenstack-graphql hono demo listening on http://localhost:${info.port}`);
        }
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
