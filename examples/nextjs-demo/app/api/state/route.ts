import { NextResponse } from 'next/server';

import { getDemoSnapshot } from '@/lib/zenstack-demo';

export async function GET() {
    return NextResponse.json({
        ok: true,
        snapshot: await getDemoSnapshot(),
    });
}
