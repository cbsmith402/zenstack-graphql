import type { NextRequest } from 'next/server';

import { nextGraphQLHandler } from '@/lib/graphql-schema';

type GraphQLRouteContext = {
    params: Promise<{
        path?: string[];
    }>;
};

function handleRequest(request: NextRequest, context: { params: Promise<unknown> }) {
    const routeContext = context as GraphQLRouteContext;
    return nextGraphQLHandler(request, {
        params: routeContext.params.then((params) => ({
            path: params.path ?? [],
        })),
    });
}

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
