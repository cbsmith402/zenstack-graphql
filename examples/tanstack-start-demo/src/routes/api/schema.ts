import { createFileRoute } from '@tanstack/react-router';
import { printSchema } from 'zenstack-graphql';

import { graphqlSchemaFactory, resolveRole } from '../../demo';

export const Route = createFileRoute('/api/schema')({
    server: {
        handlers: {
            GET: async ({ request }) => {
                const role = resolveRole(request);
                return new Response(
                    printSchema(await graphqlSchemaFactory.getSchema({ role })),
                    {
                        headers: {
                            'content-type': 'text/plain; charset=utf-8',
                        },
                    }
                );
            },
        },
    },
});
