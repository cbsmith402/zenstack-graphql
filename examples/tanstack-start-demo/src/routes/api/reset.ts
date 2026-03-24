import { createFileRoute } from '@tanstack/react-router';

import { resetDemoDatabase } from '../../demo';

export const Route = createFileRoute('/api/reset')({
    server: {
        handlers: {
            POST: async () => {
                await resetDemoDatabase();
                return Response.json({ ok: true });
            },
        },
    },
});
