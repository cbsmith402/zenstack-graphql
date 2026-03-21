'use client';

import { useState, useTransition } from 'react';

type SampleOperation = {
    label: string;
    description: string;
    query: string;
    variables: string;
};

type Snapshot = {
    databasePath: string;
    users: Array<Record<string, unknown>>;
};

type PlaygroundProps = {
    samples: SampleOperation[];
    initialRole: 'admin' | 'user';
    initialSchema: string;
    initialSnapshot: Snapshot;
    initialZModel: string;
};

export function Playground({
    samples,
    initialRole,
    initialSchema,
    initialSnapshot,
    initialZModel,
}: PlaygroundProps) {
    const [query, setQuery] = useState(samples[0]?.query ?? '');
    const [variables, setVariables] = useState(samples[0]?.variables ?? '{}');
    const [role, setRole] = useState<'admin' | 'user'>(initialRole);
    const [schemaSDL, setSchemaSDL] = useState(initialSchema);
    const [result, setResult] = useState<string>('Run a query to see the JSON response.');
    const [snapshot, setSnapshot] = useState<Snapshot>(initialSnapshot);
    const [status, setStatus] = useState('Ready');
    const [isPending, startTransition] = useTransition();

    async function refreshSnapshot() {
        const response = await fetch('/api/state');
        const payload = (await response.json()) as { snapshot: Snapshot };
        setSnapshot(payload.snapshot);
    }

    async function refreshSchema(nextRole: 'admin' | 'user') {
        const response = await fetch('/api/schema', {
            headers: {
                'x-hasura-role': nextRole,
            },
        });
        const payload = await response.text();
        setSchemaSDL(payload);
    }

    function applySample(sample: SampleOperation) {
        setQuery(sample.query);
        setVariables(sample.variables);
        setStatus(`Loaded "${sample.label}"`);
    }

    async function runQuery() {
        startTransition(async () => {
            setStatus(`Running GraphQL request as ${role}...`);
            try {
                const parsedVariables = variables.trim() ? JSON.parse(variables) : {};
                const response = await fetch('/api/graphql', {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-hasura-role': role,
                    },
                    body: JSON.stringify({
                        query,
                        variables: parsedVariables,
                    }),
                });
                const payload = await response.json();
                setResult(JSON.stringify(payload, null, 2));
                await refreshSnapshot();
                setStatus(payload.errors ? 'GraphQL returned errors.' : 'Query completed successfully.');
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown request failure';
                setResult(JSON.stringify({ error: message }, null, 2));
                setStatus('The request failed before GraphQL could respond.');
            }
        });
    }

    async function resetData() {
        startTransition(async () => {
            setStatus('Resetting SQLite demo data...');
            const response = await fetch('/api/reset', { method: 'POST' });
            const payload = (await response.json()) as { snapshot: Snapshot };
            setSnapshot(payload.snapshot);
            setStatus('Demo data reset to the seed state.');
        });
    }

    function changeRole(nextRole: 'admin' | 'user') {
        startTransition(async () => {
            setRole(nextRole);
            setStatus(`Switching schema to ${nextRole} role...`);
            try {
                await refreshSchema(nextRole);
                setStatus(`Loaded the ${nextRole} schema.`);
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown schema refresh failure';
                setResult(JSON.stringify({ error: message }, null, 2));
                setStatus('Failed to refresh the role-specific schema.');
            }
        });
    }

    return (
        <div className="shell">
            <section className="hero">
                <div className="hero-grid">
                    <div>
                        <p className="eyebrow">Next.js Demo App</p>
                        <h1>Test the adapter with a real GraphQL route.</h1>
                        <p>
                            This sample wraps the local <code>zenstack-graphql</code> package in a
                            Next.js App Router project. The API route runs against a real ZenStack
                            schema backed by SQLite, so you can try queries, mutations, transaction
                            rollbacks, and Hasura-style role-based schema pruning end to end.
                        </p>
                        <div className="pill-row">
                            <span className="pill">Hasura-style root fields</span>
                            <span className="pill">Nested relation reads</span>
                            <span className="pill">Aggregates + CRUD mutations</span>
                            <span className="pill">Header-based role slicing</span>
                        </div>
                    </div>
                    <div className="card pad">
                        <h2 className="section-title">Quick Start</h2>
                        <p className="muted">
                            Run <code>npm install</code> and <code>npm run dev</code> inside
                            <code> examples/nextjs-demo</code>, then open <code>/</code>. The app
                            regenerates the ZenStack TypeScript schema before startup and bootstraps
                            the SQLite database on first request.
                        </p>
                        <pre className="code-block">{`cd examples/nextjs-demo
npm install
npm run dev`}</pre>
                    </div>
                </div>
            </section>

            <section className="meta-grid">
                <div className="meta-box">
                    <strong>GraphQL Endpoint</strong>
                    <span className="muted">
                        POST <code>/api/graphql</code>
                    </span>
                </div>
                <div className="meta-box">
                    <strong>Schema SDL</strong>
                    <span className="muted">
                        GET <code>/api/schema</code> with <code>x-hasura-role</code>
                    </span>
                </div>
                <div className="meta-box">
                    <strong>Reset Seed Data</strong>
                    <span className="muted">
                        POST <code>/api/reset</code>
                    </span>
                </div>
                <div className="meta-box">
                    <strong>Current SQLite State</strong>
                    <span className="muted">
                        GET <code>/api/state</code>
                    </span>
                </div>
            </section>

            <section className="playground">
                <div className="card pad">
                    <div className="panel-header">
                        <h2>Playground</h2>
                        <div className="button-row">
                            <select
                                className="button secondary"
                                value={role}
                                onChange={(event) => changeRole(event.target.value as 'admin' | 'user')}
                                disabled={isPending}
                            >
                                <option value="admin">Role: admin</option>
                                <option value="user">Role: user</option>
                            </select>
                            <button className="button secondary" onClick={resetData} disabled={isPending}>
                                Reset Data
                            </button>
                            <button className="button" onClick={runQuery} disabled={isPending}>
                                {isPending ? 'Working...' : 'Run Query'}
                            </button>
                        </div>
                    </div>

                    <div className={`status ${status.includes('successfully') || status.startsWith('Loaded the') ? 'success' : ''}`}>
                        {status}
                    </div>

                    <div className="editor-stack" style={{ marginTop: 16 }}>
                        <div>
                            <div className="editor-label">
                                <span>Query</span>
                            </div>
                            <textarea
                                className="editor"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                spellCheck={false}
                            />
                        </div>

                        <div>
                            <div className="editor-label">
                                <span>Variables</span>
                            </div>
                            <textarea
                                className="editor small"
                                value={variables}
                                onChange={(event) => setVariables(event.target.value)}
                                spellCheck={false}
                            />
                        </div>

                        <div>
                            <div className="editor-label">
                                <span>Result</span>
                                <span className="muted">Header: x-hasura-role = {role}</span>
                            </div>
                            <pre className="result">{result}</pre>
                        </div>
                    </div>
                </div>

                <div className="side-grid">
                    <div className="card pad">
                        <div className="panel-header">
                            <h3>Sample Operations</h3>
                        </div>
                        <div className="sample-list">
                            {samples.map((sample) => (
                                <button
                                    key={sample.label}
                                    className="sample-button"
                                    onClick={() => applySample(sample)}
                                >
                                    <strong>{sample.label}</strong>
                                    <span>{sample.description}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="card pad">
                        <div className="panel-header">
                            <h3>Current Demo Data</h3>
                        </div>
                        <p className="muted">
                            SQLite file: <code>{snapshot.databasePath}</code>
                        </p>
                        <pre className="code-block">{JSON.stringify(snapshot, null, 2)}</pre>
                    </div>

                    <div className="card pad">
                        <div className="panel-header">
                            <h3>ZenStack Schema</h3>
                        </div>
                        <pre className="code-block">{initialZModel}</pre>
                    </div>

                    <div className="card pad">
                        <div className="panel-header">
                            <h3>Generated Schema</h3>
                        </div>
                        <p className="muted">
                            Current role: <code>{role}</code>
                        </p>
                        <pre className="code-block">{schemaSDL}</pre>
                    </div>
                </div>
            </section>
        </div>
    );
}
