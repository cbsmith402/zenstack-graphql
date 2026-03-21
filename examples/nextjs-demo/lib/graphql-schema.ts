import { createZenStackGraphQLSchema, printSchema } from 'zenstack-graphql';

import { ensureDemoDatabaseReady } from './zenstack-demo';
import { schema } from '@/zenstack/schema';

export const graphqlSchema = createZenStackGraphQLSchema({
    schema,
    async getClient() {
        return ensureDemoDatabaseReady();
    },
});

export const graphqlSchemaSDL = printSchema(graphqlSchema);
