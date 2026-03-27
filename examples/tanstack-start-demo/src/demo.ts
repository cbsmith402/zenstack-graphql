import path from 'node:path';
import fs from 'node:fs/promises';

import Database from 'better-sqlite3';
import { ZenStackClient } from '@zenstackhq/orm';
import type { ClientContract } from '@zenstackhq/orm';
import { SqliteDialect } from '@zenstackhq/orm/dialects/sqlite';
import { TanStackStartHandler } from '@zenstackhq/server/tanstack-start';
import {
    GraphQLNonNull,
    GraphQLString,
    GraphQLApiHandler,
    createHasuraCompatibilityHelpers,
    createZenStackGraphQLSchemaFactory,
    type CreateZenStackGraphQLSchemaFactoryOptions,
} from 'zenstack-graphql';

import {
    DEFAULT_DEMO_ROLE,
    DEMO_ROLE_HEADER,
    type DemoRole,
} from './demo-config';
import { schema } from '../zenstack/schema';

export const DATABASE_PATH = path.join(process.cwd(), 'zenstack', 'dev.db');

type DemoClient = ClientContract<typeof schema>;
type DemoGraphQLClient = DemoClient & { __graphqlRole?: DemoRole };
declare global {
    var __ZENSTACK_GRAPHQL_TANSTACK_CLIENT__: DemoClient | undefined;
    var __ZENSTACK_GRAPHQL_TANSTACK_INIT__: Promise<void> | undefined;
}

const hasura = createHasuraCompatibilityHelpers<Request, DemoRole>({
    defaultRole: DEFAULT_DEMO_ROLE,
    getHeaders(request) {
        return request.headers;
    },
    normalizeRole(role) {
        return role?.toLowerCase() === 'user' ? 'user' : DEFAULT_DEMO_ROLE;
    },
    getSlicing(role) {
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
    },
});

const serverExtensions = {
    query: {
        demoSummary: {
            type: new GraphQLNonNull(GraphQLString),
            async resolve(
                _source: unknown,
                _args: Record<string, unknown>,
                _context: unknown,
                _info: unknown,
                { client }: { client: DemoClient }
            ) {
                const [userCount, postCount, latestUser] = await Promise.all([
                    client.user.count(),
                    client.post.count(),
                    client.user.findFirst({
                        orderBy: { id: 'desc' },
                        select: { name: true },
                    }),
                ]);

                return `${userCount} users, ${postCount} posts, latest user: ${latestUser?.name ?? 'none'}`;
            },
        },
    },
};

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
    if (!globalThis.__ZENSTACK_GRAPHQL_TANSTACK_CLIENT__) {
        globalThis.__ZENSTACK_GRAPHQL_TANSTACK_CLIENT__ = createClient();
    }
    return globalThis.__ZENSTACK_GRAPHQL_TANSTACK_CLIENT__;
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
                interests: ['tanstack-start', 'sqlite'],
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
            { title: 'TanStack Start Adapter', authorId: ben.id, views: 13 },
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
    if (!globalThis.__ZENSTACK_GRAPHQL_TANSTACK_INIT__) {
        globalThis.__ZENSTACK_GRAPHQL_TANSTACK_INIT__ = (async () => {
            await ensureDemoSchemaCompatibility();
            const client = getDemoClient();
            await client.$pushSchema();
            await reseedDemoDatabase(client);
        })();
    }

    await globalThis.__ZENSTACK_GRAPHQL_TANSTACK_INIT__;
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
        return hasura.getSlicing(new Request('http://local.invalid'), context);
    },
    getCacheKey: hasura.getCacheKey,
    extensions: serverExtensions,
};

export const graphqlSchemaFactory = createZenStackGraphQLSchemaFactory(schemaFactoryOptions);

const graphQLApiHandler = new GraphQLApiHandler<
    DemoGraphQLClient,
    undefined,
    DemoRole,
    typeof schema
>({
    schema,
    allowedPaths: ['graphql'],
    relay: { enabled: true },
    getSlicing(request) {
        return hasura.getSlicing(
            new Request('http://local.invalid'),
            { role: request.client.__graphqlRole ?? DEFAULT_DEMO_ROLE }
        );
    },
    getCacheKey({ request }) {
        return hasura.getCacheKey({
            context: { role: request.client.__graphqlRole ?? DEFAULT_DEMO_ROLE },
        });
    },
    extensions: serverExtensions,
});

export const handleGraphQLRequest = TanStackStartHandler({
    apiHandler: graphQLApiHandler,
    async getClient(request) {
        await ensureDemoDatabaseReady();
        return createGraphQLClient(hasura.getContext(request).role);
    },
});

export function resolveRole(request: Request) {
    return hasura.getContext(request).role;
}
