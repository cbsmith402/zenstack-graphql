# TanStack Start Demo

This example shows `zenstack-graphql` mounted through ZenStack's real TanStack Start server adapter,
using `GraphQLApiHandler` as the framework-agnostic API handler.

## Run

```bash
npm install
npm run dev
```

Then visit:

- `http://localhost:4003/`
- `http://localhost:4003/api/schema`
- `http://localhost:4003/api/graphql`

Use the `x-hasura-role` header with `admin` or `user` to switch schema slices.
