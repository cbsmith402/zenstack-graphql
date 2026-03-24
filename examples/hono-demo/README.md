# Hono Demo

This example shows `zenstack-graphql` mounted through the Hono adapter and Node server runtime.

## Run

```bash
npm install
npm run dev
```

Then visit:

- `http://localhost:4002/`
- `http://localhost:4002/api/schema`
- `http://localhost:4002/api/graphql`

Use the `x-hasura-role` header with `admin` or `user` to switch schema slices.
