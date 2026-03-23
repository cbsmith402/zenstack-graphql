import { NextResponse } from 'next/server';

import {
    DEMO_ROLE_HEADER,
    DEFAULT_DEMO_ROLE,
    handleGraphQLRequest,
} from '@/lib/graphql-schema';

export async function GET() {
    return NextResponse.json({
        ok: true,
        endpoint: '/api/graphql',
        roleHeader: DEMO_ROLE_HEADER,
        defaultRole: DEFAULT_DEMO_ROLE,
        usage: {
            method: 'POST',
            headers: {
                [DEMO_ROLE_HEADER]: 'admin | user',
            },
            body: {
                query: 'query { users { id name } }',
                variables: {},
            },
        },
    });
}

export async function POST(request: Request) {
    return handleGraphQLRequest(request);
}
