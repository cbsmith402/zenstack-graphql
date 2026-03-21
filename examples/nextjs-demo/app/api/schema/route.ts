import { NextResponse } from 'next/server';

import { graphqlSchemaSDL } from '@/lib/graphql-schema';

export async function GET() {
    return new NextResponse(graphqlSchemaSDL, {
        headers: {
            'content-type': 'text/plain; charset=utf-8',
        },
    });
}
