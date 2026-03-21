import { NextResponse } from 'next/server';

import {
    DEMO_ROLE_HEADER,
    DEFAULT_DEMO_ROLE,
    graphqlSchemaFactory,
    normalizeDemoRole,
} from '@/lib/graphql-schema';

type GraphQLRequestBody = {
    query?: string;
    variables?: Record<string, unknown>;
    operationName?: string;
};

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
    const body = (await request.json()) as GraphQLRequestBody;
    if (!body.query) {
        return NextResponse.json(
            {
                errors: [{ message: 'A GraphQL "query" string is required.' }],
            },
            { status: 400 }
        );
    }

    const role = normalizeDemoRole(request.headers.get(DEMO_ROLE_HEADER));
    const result = await graphqlSchemaFactory.execute({
        contextValue: { role },
        source: body.query,
        variableValues: body.variables,
        operationName: body.operationName,
    });

    return NextResponse.json(result);
}
