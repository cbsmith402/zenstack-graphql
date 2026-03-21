export const sampleOperations = [
    {
        label: 'Nested Query',
        description: 'Read real SQLite-backed ZenStack models with nested posts and aggregates.',
        query: `query NestedUsers {
  users(order_by: [{ age: desc }]) {
    id
    name
    age
    role
    posts(order_by: [{ id: asc }]) {
      id
      title
      views
    }
  }

  users_aggregate(where: { role: { _eq: ADMIN } }) {
    aggregate {
      count
      avg {
        age
      }
      max {
        age
      }
    }
  }
}`,
        variables: '{}',
    },
    {
        label: 'Mutation Flow',
        description: 'Mutate real rows in SQLite through the generated ZenStack schema.',
        query: `mutation MutationFlow {
  insert_users_one(object: { name: "Cara", age: 25, role: USER }) {
    id
    name
    age
    role
  }

  update_users(where: { id: { _eq: 2 } }, _set: { name: "Benny" }, _inc: { age: 1 }) {
    affected_rows
    returning {
      id
      name
      age
    }
  }
}`,
        variables: '{}',
    },
    {
        label: 'Filtered Search',
        description: 'Use Hasura-style filters against relation data in SQLite.',
        query: `query RelatedFilter {
  users(where: { posts: { title: { _ilike: "%Hasura%" } } }) {
    id
    name
    posts(where: { title: { _ilike: "%Hasura%" } }) {
      id
      title
    }
  }
}`,
        variables: '{}',
    },
    {
        label: 'Relation Aggregate',
        description: 'Query Hasura-style relation aggregate fields generated from the ZenStack models.',
        query: `query RelationAggregate {
  users(order_by: [{ id: asc }]) {
    id
    name
    posts_aggregate(order_by: [{ views: desc }]) {
      aggregate {
        count
        sum {
          views
        }
        max {
          views
        }
      }
      nodes {
        id
        title
        views
      }
    }
  }
}`,
        variables: '{}',
    },
    {
        label: 'Atomic Rollback',
        description:
            'The first insert would succeed on its own, but the second one fails, so the whole mutation rolls back.',
        query: `mutation AtomicRollback {
  insert_users_one(object: { name: "Rollback Riley", age: 41, role: USER }) {
    id
    name
  }

  insert_posts_one(object: { title: "Broken Foreign Key", authorId: 999999, views: 1 }) {
    id
    title
  }
}`,
        variables: '{}',
    },
];

export const zmodelSource = `datasource db {
  provider = 'sqlite'
  url = env('DATABASE_URL')
}

enum Role {
  USER
  ADMIN
}

model User {
  id        Int      @id @default(autoincrement())
  name      String
  age       Int
  role      Role     @default(USER)
  createdAt DateTime @default(now())
  posts     Post[]
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  views     Int      @default(0)
  createdAt DateTime @default(now())
  author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
  authorId  Int
}`;
