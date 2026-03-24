import { createFileRoute } from '@tanstack/react-router';

import { getDemoSnapshot } from '../../demo';

export const Route = createFileRoute('/api/state')({
    server: {
        handlers: {
            GET: async () => {
                return Response.json(await getDemoSnapshot());
            },
        },
    },
});
