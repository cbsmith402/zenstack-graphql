# TanStack Start Demo

This example shows `zenstack-graphql` mounted through TanStack Start server routes while keeping the same ZenStack SQLite flow as the other demos.

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
