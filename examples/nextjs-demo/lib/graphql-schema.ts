import {
    GraphQLNonNull,
    GraphQLString,
    createZenStackGraphQLSchema,
    printSchema,
} from 'zenstack-graphql';

import { ensureDemoDatabaseReady } from './zenstack-demo';
import { schema } from '@/zenstack/schema';

export const graphqlSchema = createZenStackGraphQLSchema({
    schema,
    async getClient() {
        return ensureDemoDatabaseReady();
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

export const graphqlSchemaSDL = printSchema(graphqlSchema);
