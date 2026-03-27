import path from 'node:path';
import fs from 'node:fs/promises';

import Database from 'better-sqlite3';
import express from 'express';
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
import { GraphQLApiHandler } from 'zenstack-graphql/server';
import { ZenStackMiddleware } from '@zenstackhq/server/express';

import { schema } from './zenstack/schema.js';

const PORT = Number(process.env.PORT ?? 4001);
const DATABASE_PATH = path.join(process.cwd(), 'zenstack', 'dev.db');
const DEMO_ROLE_HEADER = 'x-hasura-role';
const DEFAULT_DEMO_ROLE = 'admin';

type DemoRole = 'admin' | 'user';
type DemoClient = ClientContract<typeof schema>;
type DemoGraphQLClient = DemoClient & { __graphqlRole?: DemoRole };

declare global {
    var __ZENSTACK_GRAPHQL_EXPRESS_CLIENT__: DemoClient | undefined;
    var __ZENSTACK_GRAPHQL_EXPRESS_INIT__: Promise<void> | undefined;
}

const sampleOperations = [
    {
        label: 'Nested Query',
        query: `query NestedUsers {
  users(order_by: [{ age: desc }]) {
    id
    name
    age
    role
    posts(order_by: [{ id: asc }]) {
      id
      title
      views
    }
  }
}`,
    },
    {
        label: 'Procedure Root',
        query: `query ProcedureRoot {
  getUserFeeds(userId: 1, limit: 2) {
    id
    title
    views
  }
}`,
    },
    {
        label: 'Relay Connection',
        query: `query RelayUsers {
  users_connection(first: 2, order_by: [{ id: asc }]) {
    edges {
      cursor
      node {
        id
        name
      }
    }
    pageInfo {
      hasNextPage
      endCursor
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
    if (!globalThis.__ZENSTACK_GRAPHQL_EXPRESS_CLIENT__) {
        globalThis.__ZENSTACK_GRAPHQL_EXPRESS_CLIENT__ = createClient();
    }
    return globalThis.__ZENSTACK_GRAPHQL_EXPRESS_CLIENT__;
}

function createGraphQLClient(role: DemoRole): DemoGraphQLClient {
    const client = getDemoClient();
    return new Proxy(client as DemoGraphQLClient, {
        get(target, property, receiver) {
            if (property === '__graphqlRole') {
                return role;
            }

            const value = Reflect.get(target, property, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
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
                interests: ['express', 'sqlite'],
            },
        },
    });

    await client.post.createMany({
        data: [
            { title: 'ZenStack Intro', authorId: ada.id, views: 5 },
            { title: 'Hasura Notes', authorId: ada.id, views: 8 },
            { title: 'Express Adapter', authorId: ben.id, views: 13 },
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
    if (!globalThis.__ZENSTACK_GRAPHQL_EXPRESS_INIT__) {
        globalThis.__ZENSTACK_GRAPHQL_EXPRESS_INIT__ = (async () => {
            await ensureDemoSchemaCompatibility();
            const client = getDemoClient();
            await client.$pushSchema();
            await reseedDemoDatabase(client);
        })();
    }

    await globalThis.__ZENSTACK_GRAPHQL_EXPRESS_INIT__;
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

const graphqlApiHandler = new GraphQLApiHandler<
    DemoGraphQLClient,
    undefined,
    DemoRole,
    typeof schema
>({
    schema,
    relay: { enabled: true },
    getSlicing(request) {
        return getRoleSlicing(request.client.__graphqlRole ?? DEFAULT_DEMO_ROLE);
    },
    getCacheKey({ request }) {
        return request.client.__graphqlRole ?? DEFAULT_DEMO_ROLE;
    },
    extensions: serverExtensions,
});

const graphqlMiddleware = ZenStackMiddleware({
    apiHandler: graphqlApiHandler,
    async getClient(req) {
        await ensureDemoDatabaseReady();
        return createGraphQLClient(
            normalizeDemoRole(req.headers[DEMO_ROLE_HEADER] as string | undefined)
        );
    },
    sendResponse: true,
});

async function main() {
    await ensureDemoDatabaseReady();

    const app = express();
    app.use(express.json());

    app.get('/', async (_req, res) => {
        res.json({
            ok: true,
            framework: 'express',
            endpoint: '/api/graphql',
            schemaEndpoint: '/api/schema',
            resetEndpoint: '/api/reset',
            stateEndpoint: '/api/state',
            roleHeader: DEMO_ROLE_HEADER,
            sampleOperations,
        });
    });

    app.get('/api/schema', async (req, res) => {
        const role = normalizeDemoRole(req.header(DEMO_ROLE_HEADER) ?? undefined);
        res.type('text/plain').send(printSchema(await graphqlSchemaFactory.getSchema({ role })));
    });

    app.get('/api/state', async (_req, res) => {
        res.json({
            databasePath: DATABASE_PATH,
            users: await getDemoSnapshot(),
        });
    });

    app.post('/api/reset', async (_req, res) => {
        const client = await ensureDemoDatabaseReady();
        await reseedDemoDatabase(client);
        res.json({ ok: true });
    });

    app.use('/api/graphql', graphqlMiddleware);

    app.listen(PORT, () => {
        console.log(`zenstack-graphql express demo listening on http://localhost:${PORT}`);
    });
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
