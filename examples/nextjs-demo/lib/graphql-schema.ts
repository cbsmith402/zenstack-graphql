import {
    GraphQLNonNull,
    GraphQLString,
    GraphQLApiHandler,
    createZenStackGraphQLSchemaFactory,
    printSchema,
    type CreateZenStackGraphQLSchemaFactoryOptions,
    type SchemaSlicingConfig,
} from 'zenstack-graphql';
import { NextRequestHandler } from '@zenstackhq/server/next';

import { ensureDemoDatabaseReady } from './zenstack-demo';
import { schema } from '@/zenstack/schema';

export type DemoRole = 'admin' | 'user';
type DemoClient = Awaited<ReturnType<typeof ensureDemoDatabaseReady>>;
type DemoGraphQLClient = DemoClient & { __graphqlRole?: DemoRole };

export const DEFAULT_DEMO_ROLE: DemoRole = 'admin';
export const DEMO_ROLE_HEADER = 'x-hasura-role';

export function normalizeDemoRole(input: string | null | undefined): DemoRole {
    return input?.toLowerCase() === 'user' ? 'user' : DEFAULT_DEMO_ROLE;
}

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
    getSlicing(context: { role: DemoRole }) {
        if (context.role !== 'user') {
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
    getCacheKey({ context }) {
        return context.role;
    },
    extensions: serverExtensions,
};

const graphQLApiHandler = new GraphQLApiHandler<
    DemoGraphQLClient,
    undefined,
    DemoRole,
    typeof schema
>({
    schema,
    allowedPaths: [''],
    relay: { enabled: true },
    getSlicing(request) {
        return request.client.__graphqlRole === 'user'
            ? {
                  models: {
                      user: {
                          excludedFields: ['age'],
                          excludedOperations: ['deleteMany', 'deleteByPk'],
                      },
                  },
              }
            : undefined;
    },
    getCacheKey({ request }) {
        return request.client.__graphqlRole ?? DEFAULT_DEMO_ROLE;
    },
    extensions: serverExtensions,
});

export const graphqlSchemaFactory = createZenStackGraphQLSchemaFactory(schemaFactoryOptions);

function createGraphQLClient(role: DemoRole): Promise<DemoGraphQLClient> {
    return ensureDemoDatabaseReady().then((client) =>
        new Proxy(client as DemoGraphQLClient, {
            get(target, property, receiver) {
                if (property === '__graphqlRole') {
                    return role;
                }

                const value = Reflect.get(target, property, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        })
    );
}

export const nextGraphQLHandler = NextRequestHandler({
    apiHandler: graphQLApiHandler,
    async getClient(request) {
        return createGraphQLClient(normalizeDemoRole(request.headers.get(DEMO_ROLE_HEADER)));
    },
    useAppDir: true,
});

export async function getGraphqlSchemaSDL(role: DemoRole = DEFAULT_DEMO_ROLE) {
    return printSchema(await graphqlSchemaFactory.getSchema({ role }));
}
