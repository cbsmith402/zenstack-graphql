import { NextResponse } from 'next/server';
import { graphql } from 'zenstack-graphql';

import { graphqlSchema } from '@/lib/graphql-schema';

type GraphQLRequestBody = {
    query?: string;
    variables?: Record<string, unknown>;
    operationName?: string;
};

export async function GET() {
    return NextResponse.json({
        ok: true,
        endpoint: '/api/graphql',
        usage: {
            method: 'POST',
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

    const result = await graphql({
        schema: graphqlSchema,
        source: body.query,
        variableValues: body.variables,
        operationName: body.operationName,
    });

    return NextResponse.json(result);
}
