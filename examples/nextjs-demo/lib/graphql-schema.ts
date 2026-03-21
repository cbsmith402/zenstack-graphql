import {
    GraphQLNonNull,
    GraphQLString,
    createZenStackGraphQLSchemaFactory,
    printSchema,
} from 'zenstack-graphql';

import { ensureDemoDatabaseReady } from './zenstack-demo';
import { schema } from '@/zenstack/schema';

export type DemoRole = 'admin' | 'user';

export const DEFAULT_DEMO_ROLE: DemoRole = 'admin';
export const DEMO_ROLE_HEADER = 'x-hasura-role';

export function normalizeDemoRole(input: string | null | undefined): DemoRole {
    return input?.toLowerCase() === 'user' ? 'user' : DEFAULT_DEMO_ROLE;
}

export const graphqlSchemaFactory = createZenStackGraphQLSchemaFactory({
    schema,
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
    extensions: {
        query: {
            demoSummary: {
                type: new GraphQLNonNull(GraphQLString),
                async resolve(_source, _args, _context, _info, { client }) {
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
    },
});

export async function getGraphqlSchemaSDL(role: DemoRole = DEFAULT_DEMO_ROLE) {
    return printSchema(await graphqlSchemaFactory.getSchema({ role }));
}
