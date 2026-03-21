import { NextResponse } from 'next/server';

import { getDemoSnapshot, resetDemoDatabase } from '@/lib/zenstack-demo';

export async function POST() {
    await resetDemoDatabase();
    return NextResponse.json({
        ok: true,
        snapshot: await getDemoSnapshot(),
    });
}
