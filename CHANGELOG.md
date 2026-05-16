# Changelog

All notable changes to `zenstack-graphql` will be documented in this file.

## 0.2.2 - 2026-05-16

Maintenance release focused on package publishing and the Hasura importer CLI.

### Added

- published the Hasura importer as the `zenstack-graphql-hasura-import` package binary so it can be run from an installed npm package

### Fixed

- fixed the Hasura importer packaging so its runtime dependencies are installed for package consumers
- fixed CLI execution when launched through npm's `node_modules/.bin` symlinked binary path

### Changed

- updated the release workflow to install the latest npm before publishing

## 0.2.1 - 2026-05-16

Maintenance release focused on dependency refreshes, example app polish, and publish pipeline cleanup.

### Changed

- updated package and example app dependencies
- added example permissions across the demo apps to better reflect real ZenStack setups

### Fixed

- fixed overflow issues in the Next.js demo playground UI
- tightened publish workflow behavior after the initial `0.2.0` release

## 0.2.0 - 2026-03-27

Release centered on Hasura migration tooling and a packaging shift toward ZenStack's API adapter model.

### Added

- Hasura importer support for converting Hasura Postgres metadata plus live database introspection into a best-effort `schema.zmodel`
- CI and publish GitHub Actions workflows for automated checks and package releases

### Changed

- aligned the package and examples around ZenStack's API adapter model instead of framework-specific wrapper exports
- refreshed the README and examples to reflect the new adapter-first integration approach

### Removed

- removed the dedicated `next`, `express`, and `hono` adapter entrypoints in favor of the shared API adapter pattern

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
