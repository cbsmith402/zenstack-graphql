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
    initialSchema: string;
    initialSnapshot: Snapshot;
    initialZModel: string;
};

export function Playground({
    samples,
    initialSchema,
    initialSnapshot,
    initialZModel,
}: PlaygroundProps) {
    const [query, setQuery] = useState(samples[0]?.query ?? '');
    const [variables, setVariables] = useState(samples[0]?.variables ?? '{}');
    const [result, setResult] = useState<string>('Run a query to see the JSON response.');
    const [snapshot, setSnapshot] = useState<Snapshot>(initialSnapshot);
    const [status, setStatus] = useState('Ready');
    const [isPending, startTransition] = useTransition();

    function applySample(sample: SampleOperation) {
        setQuery(sample.query);
        setVariables(sample.variables);
        setStatus(`Loaded "${sample.label}"`);
    }

    async function runQuery() {
        startTransition(async () => {
            setStatus('Running GraphQL request...');
            try {
                const parsedVariables = variables.trim() ? JSON.parse(variables) : {};
                const response = await fetch('/api/graphql', {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                    },
                    body: JSON.stringify({
                        query,
                        variables: parsedVariables,
                    }),
                });
                const payload = await response.json();
                setResult(JSON.stringify(payload, null, 2));
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
            setStatus('Resetting in-memory demo data...');
            const response = await fetch('/api/reset', { method: 'POST' });
            const payload = (await response.json()) as { snapshot: Snapshot };
            setSnapshot(payload.snapshot);
            setStatus('Demo data reset to the seed state.');
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
                            Next.js App Router project. The API route uses an in-memory store so you
                            can try queries and mutations instantly, then reset the data between runs.
                        </p>
                        <div className="pill-row">
                            <span className="pill">Hasura-style root fields</span>
                            <span className="pill">Nested relation reads</span>
                            <span className="pill">Aggregates + CRUD mutations</span>
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
                        GET <code>/api/schema</code>
                    </span>
                </div>
                <div className="meta-box">
                    <strong>Reset Seed Data</strong>
                    <span className="muted">
                        POST <code>/api/reset</code>
                    </span>
                </div>
            </section>

            <section className="playground">
                <div className="card pad">
                    <div className="panel-header">
                        <h2>Playground</h2>
                        <div className="button-row">
                            <button className="button secondary" onClick={resetData} disabled={isPending}>
                                Reset Data
                            </button>
                            <button className="button" onClick={runQuery} disabled={isPending}>
                                {isPending ? 'Working...' : 'Run Query'}
                            </button>
                        </div>
                    </div>

                    <div className={`status ${status.includes('successfully') ? 'success' : ''}`}>
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
                        <pre className="code-block">{initialSchema}</pre>
                    </div>
                </div>
            </section>
        </div>
    );
}
