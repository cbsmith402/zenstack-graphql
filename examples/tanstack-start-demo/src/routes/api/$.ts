import { createFileRoute } from '@tanstack/react-router';

import { handleGraphQLRequest } from '../../demo';

export const Route = createFileRoute('/api/$')({
    server: {
        handlers: {
            GET: handleGraphQLRequest,
            POST: handleGraphQLRequest,
            PUT: handleGraphQLRequest,
            PATCH: handleGraphQLRequest,
            DELETE: handleGraphQLRequest,
        },
    },
});
