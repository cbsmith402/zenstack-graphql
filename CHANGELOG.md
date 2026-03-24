# Changelog

All notable changes to `zenstack-graphql` will be documented in this file.

## 0.1.0 - 2026-03-23

Initial public release of the standalone ZenStack V3 GraphQL adapter.

### Added

- Hasura-style CRUD query and mutation roots
- model-driven filters, ordering, aggregates, and nested relation reads
- `on_conflict`, nested relation inserts, and supported nested relation update shapes
- request-wide mutation transactions
- ZenStack procedure roots plus manual GraphQL root extensions
- role-aware schema pruning and cached schema factories
- optional Relay query layer with root and nested connections plus `node(id:)`
- framework-agnostic `GraphQLApiHandler`
- server adapters for fetch/Web `Request`, Next.js, Express, and Hono
- Hasura compatibility helpers for `x-hasura-role` request extraction and slicing
- SQLite-backed demo apps for Next.js, Express, Hono, and TanStack Start
- regression test suite

### Compatibility Notes

- The adapter is designed for the common "Hasura as a CRUD GraphQL layer" use case, not full Hasura product parity.
- Subscriptions, remote schemas, DB-native SQL routine introspection, and Relay mutations are intentionally unsupported in this release.
- Relation aggregate ordering is supported only for ORM-backed `count`.

### Packaging Notes

- `graphql` is a peer dependency.
- The recommended import surfaces are:
  - `zenstack-graphql/core`
  - `zenstack-graphql/server`
  - `zenstack-graphql/next`
  - `zenstack-graphql/express`
  - `zenstack-graphql/hono`
- The root `zenstack-graphql` export remains available as a convenience superset.
