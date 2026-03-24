# zenstack-graphql

`zenstack-graphql` is a standalone GraphQL adapter for ZenStack-style model metadata. It generates a framework-agnostic `GraphQLSchema` with Hasura-like CRUD roots, model-driven filters and ordering, aggregates, nested relation inserts, core insert/update/delete mutations, ZenStack procedure roots, and optional custom root resolvers.

## Requirements

- Node.js `>=18.17`
- `graphql` `^16.11.0` as a peer dependency
- ZenStack V3 schema metadata and a request-scoped ZenStack client

## Install

```bash
npm install zenstack-graphql graphql
```

## Choose Your Surface

Use the lowest-level API that matches your app:

- `zenstack-graphql/core`
  - For direct schema generation and custom GraphQL server wiring
- `zenstack-graphql/server`
  - For the framework-agnostic transport handler
- `zenstack-graphql/next`
  - For Next.js route handlers
- `zenstack-graphql/express`
  - For Express middleware
- `zenstack-graphql/hono`
  - For Hono handlers
- `zenstack-graphql/hasura`
  - For convenience helpers around `x-hasura-role` request extraction and schema slicing
- `zenstack-graphql`
  - Convenience root export that re-exports the full public surface

## Core Usage

```ts
import { createZenStackGraphQLSchema } from 'zenstack-graphql/core';

const schema = createZenStackGraphQLSchema({
    schema: {
        models: [
            {
                name: 'User',
                fields: [
                    { name: 'id', kind: 'scalar', type: 'Int', isId: true },
                    { name: 'name', kind: 'scalar', type: 'String' },
                ],
            },
        ],
    },
    async getClient(context) {
        return context.db;
    },
});
```

## Public API

- `createZenStackGraphQLSchema({ schema, getClient, compatibility, naming, features, relay, slicing, scalars, scalarAliases, hooks, extensions })`
- `createZenStackGraphQLSchemaFactory({ schema, getClient, getSlicing, getCacheKey, ... })`
- `new GraphQLApiHandler({ schema, getClient, getContext, getSlicing, getCacheKey, ... })`
- `createFetchGraphQLHandler(...)`
- `createNextGraphQLHandler(...)`
- `createExpressGraphQLMiddleware(...)`
- `createHonoGraphQLHandler(...)`
- `normalizeSchema(schema)`
- `normalizeError(error)`

The generated schema uses Hasura-like defaults:

- Query roots: `users`, `users_by_pk`, `users_aggregate`
- Mutation roots: `insert_users`, `insert_users_one`, `update_users`, `update_users_by_pk`, `delete_users`, `delete_users_by_pk`
- String filters include Hasura-style pattern operators like `_like`, `_nlike`, `_ilike`, and `_nilike`, plus extended prefix/suffix/contains variants
- Provider-specific filters now include PostgreSQL scalar-list operators (`has`, `hasEvery`, `hasSome`, `isEmpty`) and ZenStack-style `Json` filters with JSON-path support
- Comparable scalar filters include `_between`
- Strongly typed JSON / typedef-backed fields can be filtered recursively, including list-object filters with `some`, `every`, and `none`
- `insert_*` and `insert_*_one` support `on_conflict`
- `*_insert_input` supports nested relation `data` inserts
- `*_set_input` supports relation-aware updates for the nested mutation shapes supported by the underlying ZenStack ORM
- To-many relation filters support the ORM-backed `some`, `every`, and `none` semantics via additive GraphQL fields like `posts_some`, `posts_every`, and `posts_none`
- `features.computedFields` enables read-only `@computed` fields detected from ZenStack-generated metadata
- `slicing` supports schema pruning with ZenStack-style model, operation, procedure, and filter slicing, plus GraphQL field visibility pruning for role-specific schemas
- `createZenStackGraphQLSchemaFactory` caches one generated schema per slice key, which makes role-aware introspection and execution much easier
- ZModel `procedure` and `mutation procedure` definitions are exposed as GraphQL query and mutation roots via `client.$procs`
- `extensions.query` and `extensions.mutation` let you attach manual GraphQL root fields that receive the same request-scoped ZenStack client as generated resolvers
- `*_by_pk` roots are emitted only for real primary keys
- Relation aggregate `order_by` on parent collections is currently supported only for `count`, matching the documented ORM `orderBy: { relation: { _count: ... } }` shape
- `distinct_on` is generated only for providers where the ORM supports `distinct`
- `relay.enabled` adds an opt-in Relay query layer with `<models>_connection`, nested `<relation>_connection`, and `node(id:)`

For closer compatibility with existing Hasura documents, the easiest path is:

- `compatibility: 'hasura-compat'`
  - Turns on the safe Hasura-oriented compatibility bundle:
    - singular table-style roots from `model.dbName` / `model.name`
    - Hasura/Postgres scalar aliases like `uuid`, `timestamptz`, `jsonb`, `numeric`, `bigint`, and `citext`
    - Hasura-style generated helper/input type names like `payment_payable_bool_exp` and `uuid_comparison_exp`
    - ORM-backed relation aggregate count predicates like `posts_aggregate: { count: { predicate: { _eq: 0 } } }`

If you only want part of that behavior, the lower-level knobs are still available:

- `naming: 'hasura-table'`
  - Uses singular table-root names from `model.dbName` / `model.name`, such as `identity_organization`, `identity_organization_by_pk`, and `insert_identity_organization_one`
- `scalarAliases: 'hasura'`
  - Renames the generated GraphQL scalar surface to Hasura/Postgres-style names where safe:
    - `DateTime -> timestamptz`
    - `Decimal -> numeric`
    - `Json -> jsonb`
    - `BigInt -> bigint`
    - native DB hints like `@db.Uuid -> uuid` and `@db.Citext -> citext`

Example:

```ts
const schema = createZenStackGraphQLSchema({
    schema: zenstackSchema,
    compatibility: 'hasura-compat',
    async getClient(context) {
        return context.db;
    },
});
```

## Server Adapters

The low-level schema factory is still available, but the package now also includes a ZenStack-style
`api handler + server adapter` layer so you can integrate GraphQL the same way ZenStack's REST and
RPC services integrate with different server frameworks.

Use `GraphQLApiHandler` when you want a framework-agnostic transport boundary:

```ts
import { GraphQLApiHandler } from 'zenstack-graphql';

const handler = new GraphQLApiHandler({
    schema,
    async getClient(request) {
        return request.db;
    },
});

const response = await handler.handle({
    method: 'POST',
    request: { db },
    body: {
        query: 'query { users { id name } }',
    },
});
```

Or use the thin framework adapters directly.

### Next.js

```ts
import { createNextGraphQLHandler } from 'zenstack-graphql/next';

export const POST = createNextGraphQLHandler({
    schema,
    async getClient(request) {
        return getZenStackClientFromRequest(request);
    },
    getContext(request) {
        return {
            role: request.headers.get('x-hasura-role') ?? 'admin',
        };
    },
});
```

### Express

```ts
import express from 'express';
import { createExpressGraphQLMiddleware } from 'zenstack-graphql/express';

const app = express();
app.use(express.json());

app.use(
    '/api/graphql',
    createExpressGraphQLMiddleware({
        schema,
        async getClient(req) {
            return getZenStackClientFromRequest(req);
        },
    })
);
```

### Hono

```ts
import { Hono } from 'hono';
import { createHonoGraphQLHandler } from 'zenstack-graphql/hono';

const app = new Hono();
const graphql = createHonoGraphQLHandler({
    schema,
    async getClient(request) {
        return getZenStackClientFromRequest(request);
    },
});

app.all('/api/graphql', (c) => graphql(c));
```

### Transport Notes

The current adapter layer supports:

- fetch / Web `Request` handlers
- Next.js route handlers
- Express middleware
- Hono handlers

All of them share the same core execution path, including request-wide mutation transactions,
Relay support, procedures, extensions, and role-aware schema slicing.

## Hasura Helpers

If you want a lightweight compatibility layer for Hasura-style role headers, use
`createHasuraCompatibilityHelpers`.

```ts
import { createHasuraCompatibilityHelpers } from 'zenstack-graphql/hasura';

const hasura = createHasuraCompatibilityHelpers<Request, 'admin' | 'user'>({
    defaultRole: 'admin',
    getHeaders(request) {
        return request.headers;
    },
    normalizeRole(role) {
        return role?.toLowerCase() === 'user' ? 'user' : 'admin';
    },
    getSlicing(role) {
        return role === 'user'
            ? {
                  models: {
                      user: {
                          excludedFields: ['age'],
                      },
                  },
              }
            : undefined;
    },
});

createNextGraphQLHandler({
    schema,
    getClient: getZenStackClientFromRequest,
    getContext: hasura.getContext,
    getSlicing: hasura.getSlicing,
    getCacheKey: hasura.getCacheKey,
});
```

That helper intentionally stays small. It standardizes:

- the `x-hasura-role` header name
- role extraction from `Headers` or Node-style header objects
- default-role fallback
- request-to-context mapping
- role-based schema slicing and cache keys

## Compatibility Snapshot

This adapter is aiming for "mostly painless for common Hasura CRUD use cases", not full Hasura platform parity.

Supported well today:

- Hasura-like list, `*_by_pk`, and `*_aggregate` query roots
- Optional `compatibility: 'hasura-compat'` preset for table-style roots, Hasura/Postgres scalar aliases, Hasura-style generated helper/input type names, and safe aggregate `count.predicate` compatibility
- Optional `naming: 'hasura-table'` mode for singular table-root compatibility with existing Hasura documents
- Core insert, update, and delete mutation roots with `returning`
- `on_conflict` on `insert_*` and `insert_*_one`
- Nested relation inserts and the supported nested relation update shapes exposed by ZenStack ORM
- Aggregates, relation aggregate fields, and parent `order_by` by relation `count`
- Hasura-style filtering and ordering, including `_between`, relation `some` / `every` / `none`, and provider-gated `distinct_on`
- ORM-backed Hasura aggregate count predicates like `_eq: 0` and `_gt: 0` on `<relation>_aggregate.count`
- Optional `scalarAliases: 'hasura'` mode for Hasura/Postgres scalar names like `uuid`, `timestamptz`, `jsonb`, `numeric`, `bigint`, and `citext`
- ZenStack custom procedures as GraphQL roots
- Manual custom root resolvers through `extensions`
- Role-aware schema pruning through `slicing` or the schema factory
- Request-wide mutation transactions when the client exposes `$transaction`
- Optional Relay root and nested connections plus `node(id:)`

Supported, but with explicit limits:

- Relation aggregate `order_by` only supports `count`
- Provider-specific operators only appear where ZenStack metadata says the backend supports them
- Typed JSON / typedef filters are supported recursively for scalar, enum, typedef, and list-of-typedef fields, but not arbitrary relation fields nested inside typedefs
- Role-aware schemas are static per slice key; auth enforcement still belongs in the ZenStack client you provide
- Relay is implemented as a parallel type layer, so connection `node` objects use `UserNode` / `PostNode` types instead of reusing the existing Hasura-style `User` / `Post` object types

Intentionally unsupported right now:

- Subscriptions
- Hasura remote schemas
- Auto-generated database-native SQL function/procedure roots
- Cursor pagination
- Relation aggregate ordering beyond ORM-backed `count`
- Any feature that would require in-memory query semantics instead of safe ORM lowering

See [docs/compatibility.md](/Users/cbsmith/Projects/zenstack-graphql/docs/compatibility.md) for the longer compatibility matrix and [docs/migration.md](/Users/cbsmith/Projects/zenstack-graphql/docs/migration.md) for a practical Hasura migration checklist.
Release notes for the current adapter surface are in [CHANGELOG.md](/Users/cbsmith/Projects/zenstack-graphql/CHANGELOG.md).

## Role-aware schemas

If you want different GraphQL schemas per role, use the schema factory and derive `slicing`
from request context.

```ts
import {
    createZenStackGraphQLSchemaFactory,
} from 'zenstack-graphql/core';

const factory = createZenStackGraphQLSchemaFactory({
    schema,
    getClient: async (context) => context.db,
    getSlicing(context) {
        return context.role === 'admin'
            ? undefined
            : {
                  models: {
                      user: {
                          excludedFields: ['age'],
                          excludedOperations: ['deleteMany', 'deleteByPk'],
                      },
                  },
              };
    },
    getCacheKey({ context }) {
        return context.role;
    },
});

const graphqlSchema = await factory.getSchema(context);
const result = await factory.execute({
    contextValue: context,
    source: '{ users { id name } }',
});
```

## Notes

- The adapter accepts a normalized metadata object today so it can work as a standalone package before being wired into a full ZenStack V3 repository.
- Delegates are expected to look Prisma-like (`findMany`, `findUnique`, `aggregate`, `create`, `update`, `delete`, and optional bulk variants).
- Provider capabilities are normalized from the schema metadata so backend-specific filter behavior can be gated cleanly as the adapter grows.
- ZenStack custom procedures are supported; database-native SQL routines are not auto-generated today.
- The root `zenstack-graphql` entrypoint is a convenience export; framework-specific subpaths are the cleaner long-term import surface for apps and examples.

## Example Apps

The repository now includes three runnable examples:

- `examples/nextjs-demo`
  - Full browser playground with schema viewer, seeded data panel, role switching, and sample operations
- `examples/express-demo`
  - Minimal Express server using `createExpressGraphQLMiddleware`
- `examples/hono-demo`
  - Minimal Hono server using `createHonoGraphQLHandler`
- `examples/tanstack-start-demo`
  - TanStack Start app using server routes and the fetch-based adapter

All three examples use a real ZenStack schema, generate local metadata with `zenstack generate`,
boot a SQLite database, and support Hasura-style role selection via the `x-hasura-role` header.

### Next.js

The Next.js playground includes examples for:

- Nested reads and aggregates
- CRUD mutations, nested inserts, and `on_conflict`
- Atomic rollback across multiple mutation fields
- JSON-path filters and `_between`
- Relay root connections, nested relation connections, and `node(id:)`
- ZenStack procedures and manual extension roots
- Role-pruned schemas with `x-hasura-role`

```bash
cd examples/nextjs-demo
npm install
npm run dev
```

Or from the repo root:

```bash
npm run demo:dev
```

### Express

```bash
cd examples/express-demo
npm install
npm run dev
```

Or from the repo root:

```bash
npm run demo:express:dev
```

### Hono

```bash
cd examples/hono-demo
npm install
npm run dev
```

Or from the repo root:

```bash
npm run demo:hono:dev
```

### TanStack Start

```bash
cd examples/tanstack-start-demo
npm install
npm run dev
```

Or from the repo root:

```bash
npm run demo:tanstack:dev
```
