import {
    GraphQLNonNull,
    GraphQLString,
    createNextGraphQLHandler,
    createZenStackGraphQLSchemaFactory,
    printSchema,
    type CreateGraphQLApiHandlerOptions,
    type CreateZenStackGraphQLSchemaFactoryOptions,
    type SchemaSlicingConfig,
} from 'zenstack-graphql';

import { ensureDemoDatabaseReady } from './zenstack-demo';
import { schema } from '@/zenstack/schema';

export type DemoRole = 'admin' | 'user';

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

const roleSlicing = (_request: Request, context: { role: DemoRole }): SchemaSlicingConfig | undefined => {
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

const graphQLHandlerOptions: CreateGraphQLApiHandlerOptions<
    Awaited<ReturnType<typeof ensureDemoDatabaseReady>>,
    Request,
    { role: DemoRole },
    DemoRole
> = {
    schema,
    relay: { enabled: true },
    async getClient() {
        return ensureDemoDatabaseReady();
    },
    getContext(request: Request) {
        return {
            role: normalizeDemoRole(request.headers.get(DEMO_ROLE_HEADER)),
        };
    },
    getSlicing: roleSlicing,
    getCacheKey({ context }) {
        return context.role;
    },
    extensions: serverExtensions,
};

export const graphqlSchemaFactory = createZenStackGraphQLSchemaFactory(schemaFactoryOptions);

export const handleGraphQLRequest = createNextGraphQLHandler(graphQLHandlerOptions);

export async function getGraphqlSchemaSDL(role: DemoRole = DEFAULT_DEMO_ROLE) {
    return printSchema(await graphqlSchemaFactory.getSchema({ role }));
}
