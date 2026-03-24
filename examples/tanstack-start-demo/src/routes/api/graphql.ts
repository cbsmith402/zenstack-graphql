import { createFileRoute } from '@tanstack/react-router';

import { handleGraphQLRequest } from '../../demo';

export const Route = createFileRoute('/api/graphql')({
    server: {
        handlers: {
            GET: async ({ request }) => handleGraphQLRequest(request),
            POST: async ({ request }) => handleGraphQLRequest(request),
        },
    },
});
