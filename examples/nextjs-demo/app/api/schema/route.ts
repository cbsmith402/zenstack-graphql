import { NextResponse } from 'next/server';

import {
    DEMO_ROLE_HEADER,
    getGraphqlSchemaSDL,
    normalizeDemoRole,
} from '@/lib/graphql-schema';

export async function GET(request: Request) {
    const role = normalizeDemoRole(request.headers.get(DEMO_ROLE_HEADER));
    const schemaSDL = await getGraphqlSchemaSDL(role);

    return new NextResponse(schemaSDL, {
        headers: {
            'content-type': 'text/plain; charset=utf-8',
        },
    });
}
