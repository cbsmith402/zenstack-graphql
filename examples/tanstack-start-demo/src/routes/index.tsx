import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';

import {
    DEFAULT_DEMO_ROLE,
    DEMO_ROLE_HEADER,
    sampleOperations,
    type DemoRole,
} from '../demo-config';

export const Route = createFileRoute('/')({
    component: HomePage,
});

function HomePage() {
    const [role, setRole] = useState<DemoRole>(DEFAULT_DEMO_ROLE);
    const [query, setQuery] = useState(sampleOperations[0]?.query ?? '');
    const [result, setResult] = useState('Run a sample query to see the GraphQL response.');
    const [schema, setSchema] = useState('Loading schema...');
    const [state, setState] = useState('Loading database state...');
    const [isPending, setIsPending] = useState(false);

    async function refreshPanels(nextRole: DemoRole) {
        const headers = { [DEMO_ROLE_HEADER]: nextRole };
        const [schemaResponse, stateResponse] = await Promise.all([
            fetch('/api/schema', { headers }),
            fetch('/api/state', { headers }),
        ]);
        setSchema(await schemaResponse.text());
        setState(JSON.stringify(await stateResponse.json(), null, 2));
    }

    useEffect(() => {
        void refreshPanels(role);
    }, [role]);

    async function runQuery() {
        setIsPending(true);
        try {
            const response = await fetch('/api/graphql', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    [DEMO_ROLE_HEADER]: role,
                },
                body: JSON.stringify({
                    query,
                    variables: {},
                }),
            });

            setResult(JSON.stringify(await response.json(), null, 2));
            await refreshPanels(role);
        } finally {
            setIsPending(false);
        }
    }

    async function resetData() {
        setIsPending(true);
        try {
            await fetch('/api/reset', { method: 'POST' });
            setResult('Database reset complete.');
            await refreshPanels(role);
        } finally {
            setIsPending(false);
        }
    }

    return (
        <main className="shell">
            <section className="hero">
                <div className="eyebrow">TanStack Start Demo</div>
                <h1>Server routes meet Hasura-style GraphQL.</h1>
                <p>
                    This app mounts `GraphQLApiHandler` through ZenStack&apos;s TanStack Start
                    server adapter, backed by a real ZenStack + SQLite setup.
                </p>
            </section>

            <section className="grid">
                <div className="panel">
                    <h2>Playground</h2>
                    <div className="controls">
                        <span className="pill">Endpoint: /api/graphql</span>
                        <label className="pill">
                            Role{' '}
                            <select
                                value={role}
                                onChange={(event) => setRole(event.target.value as DemoRole)}
                            >
                                <option value="admin">admin</option>
                                <option value="user">user</option>
                            </select>
                        </label>
                        <span className="pill">Header: {DEMO_ROLE_HEADER}</span>
                    </div>

                    <textarea
                        className="editor"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    />

                    <div className="actions">
                        <button className="button" disabled={isPending} onClick={() => void runQuery()}>
                            {isPending ? 'Running…' : 'Run query'}
                        </button>
                        <button
                            className="button secondary"
                            disabled={isPending}
                            onClick={() => void resetData()}
                        >
                            Reset SQLite data
                        </button>
                    </div>

                    <h3>Response</h3>
                    <pre className="code">{result}</pre>
                </div>

                <div className="panel">
                    <h2>Samples</h2>
                    <div className="samples">
                        {sampleOperations.map((sample) => (
                            <button
                                key={sample.label}
                                className="sample-button"
                                onClick={() => setQuery(sample.query)}
                            >
                                <strong>{sample.label}</strong>
                                <span>{sample.description}</span>
                            </button>
                        ))}
                    </div>

                    <h3>Current schema</h3>
                    <pre className="code">{schema}</pre>

                    <h3>Current data</h3>
                    <pre className="code">{state}</pre>
                </div>
            </section>
        </main>
    );
}
