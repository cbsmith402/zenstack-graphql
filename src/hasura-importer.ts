import fs from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';

type JsonObject = Record<string, unknown>;

export type QualifiedName = {
    schema: string;
    name: string;
};

export type ImportSummary = {
    importedTables: number;
    importedViews: number;
    commentedViewStubs: number;
    rolesTranslated: number;
    permissionsTranslated: number;
    permissionsWithTodos: number;
    unsupportedOperators: Record<string, number>;
};

export type ImportWarning = {
    scope: string;
    message: string;
};

export type PermissionTodo = {
    role: string;
    operation: 'read' | 'create' | 'update' | 'delete';
    message: string;
};

type PermissionTranslation = {
    operation: 'read' | 'create' | 'update' | 'delete';
    role: string;
    expression?: string;
    todos: string[];
    translated: boolean;
};

type ColumnInfo = {
    schema: string;
    tableName: string;
    columnName: string;
    position: number;
    isNullable: boolean;
    dataType: string;
    udtName: string;
    defaultValue: string | null;
    isIdentity: boolean;
};

type ConstraintInfo = {
    schema: string;
    tableName: string;
    constraintName: string;
    columns: string[];
};

type ForeignKeyInfo = {
    schema: string;
    tableName: string;
    constraintName: string;
    columns: string[];
    referencedSchema: string;
    referencedTable: string;
    referencedColumns: string[];
};

type RelationConfig = {
    name: string;
    kind: 'object' | 'array';
    local?: QualifiedName;
    remote: QualifiedName;
    localColumns: string[];
    remoteColumns: string[];
    source: 'foreign_key' | 'manual';
};

type PermissionConfig = {
    role: string;
    operation: 'read' | 'create' | 'update' | 'delete';
    filter: unknown;
    check?: unknown;
    columns?: string[];
    presets?: Record<string, unknown>;
    allowAggregations?: boolean;
    comment?: string;
};

export type LoadedTrackedEntity = {
    target: QualifiedName;
    relationships: RelationConfig[];
    permissions: PermissionConfig[];
};

export type LoadedHasuraMetadata = {
    sourceName: string;
    sourceKind: string;
    entities: LoadedTrackedEntity[];
};

type IntrospectedField = {
    name: string;
    zmodelName: string;
    type: string;
    isNullable: boolean;
    isId: boolean;
    isUnique: boolean;
    defaultExpression?: string;
    map?: string;
    rawType: string;
    comments: string[];
};

type IntrospectedRelation = {
    name: string;
    targetModel: string;
    target: QualifiedName;
    kind: 'object' | 'array';
    localColumns: string[];
    remoteColumns: string[];
    relationName?: string;
    source: 'foreign_key' | 'manual';
    renderable: boolean;
    comments: string[];
};

export type IntrospectedEntity = {
    target: QualifiedName;
    modelName: string;
    isView: boolean;
    columns: IntrospectedField[];
    primaryKey: string[];
    uniqueConstraints: string[][];
    relations: IntrospectedRelation[];
    comments: string[];
};

export type IntrospectedSource = {
    entities: IntrospectedEntity[];
};

type RenderedEntity = {
    target: QualifiedName;
    modelName: string;
    isView: boolean;
    renderable: boolean;
    fields: IntrospectedField[];
    relations: IntrospectedRelation[];
    primaryKey: string[];
    uniqueConstraints: string[][];
    policies: string[];
    comments: string[];
    todos: string[];
};

export type ImportResult = {
    sourceName: string;
    entities: RenderedEntity[];
    warnings: ImportWarning[];
    summary: ImportSummary;
};

type Queryable = {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: JsonObject[] }>;
};

export type IntrospectPostgresSourceOptions = {
    databaseUrl?: string;
    schemaFilter?: string[];
    queryable?: Queryable;
};

export type ImportHasuraToZModelOptions = {
    metadataDir: string;
    databaseUrl: string;
    sourceName?: string;
    includeViews?: boolean;
    schemaFilter?: string[];
};

export type ImportHasuraToZModelResult = {
    zmodel: string;
    result: ImportResult;
};

const READ_ONLY_VIEW_POLICY = `@@deny('create, update, delete', true)`;

function isPlainObject(value: unknown): value is JsonObject {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toPascalCase(value: string) {
    return value
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

function toCamelCase(value: string) {
    const pascal = toPascalCase(value);
    return pascal.length > 0 ? pascal.charAt(0).toLowerCase() + pascal.slice(1) : value;
}

function pluralize(value: string) {
    if (value.endsWith('s')) {
        return value;
    }
    if (value.endsWith('y') && !/[aeiou]y$/i.test(value)) {
        return `${value.slice(0, -1)}ies`;
    }
    return `${value}s`;
}

function qualifiedKey(target: QualifiedName) {
    return `${target.schema}.${target.name}`;
}

function normalizeQualifiedName(input: unknown): QualifiedName | undefined {
    if (!isPlainObject(input) || typeof input.name !== 'string' || typeof input.schema !== 'string') {
        return undefined;
    }
    return {
        schema: input.schema,
        name: input.name,
    };
}

function normalizeMaybeQualifiedName(input: unknown): QualifiedName | undefined {
    if (typeof input === 'string') {
        const [schema, name] = input.includes('.') ? input.split('.', 2) : ['public', input];
        return { schema, name };
    }
    return normalizeQualifiedName(input);
}

async function parseYamlWithIncludes(filePath: string): Promise<unknown> {
    const text = await fs.readFile(filePath, 'utf8');
    const parsed = YAML.parse(text);
    return resolveIncludes(parsed, path.dirname(filePath));
}

async function resolveIncludes(value: unknown, baseDir: string): Promise<unknown> {
    if (Array.isArray(value)) {
        const entries = await Promise.all(value.map((entry) => resolveIncludes(entry, baseDir)));
        return entries.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
    }

    if (typeof value === 'string') {
        const includeMatch = value.match(/^!include\s+(.+)$/);
        if (!includeMatch) {
            return value;
        }
        const nextPath = path.resolve(baseDir, includeMatch[1]);
        return parseYamlWithIncludes(nextPath);
    }

    if (!isPlainObject(value)) {
        return value;
    }

    const resolved: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
        resolved[key] = await resolveIncludes(entry, baseDir);
    }
    return resolved;
}

function normalizeRelationship(
    target: QualifiedName,
    raw: unknown,
    kind: 'object' | 'array'
): RelationConfig | undefined {
    if (!isPlainObject(raw) || typeof raw.name !== 'string' || !isPlainObject(raw.using)) {
        return undefined;
    }

    const using = raw.using;
    const manual = isPlainObject(using.manual_configuration) ? using.manual_configuration : undefined;
    if (manual) {
        const remote = normalizeQualifiedName(manual.remote_table);
        const columnMapping = isPlainObject(manual.column_mapping) ? manual.column_mapping : undefined;
        if (!remote || !columnMapping) {
            return undefined;
        }

        const localColumns = Object.keys(columnMapping);
        const remoteColumns = Object.values(columnMapping).filter(
            (value): value is string => typeof value === 'string'
        );

        return {
            name: raw.name,
            kind,
            local: target,
            remote,
            localColumns,
            remoteColumns,
            source: 'manual',
        };
    }

    const fk = using.foreign_key_constraint_on;
    if (!fk) {
        return undefined;
    }

    if (typeof fk === 'string') {
        return {
            name: raw.name,
            kind,
            local: target,
            remote: target,
            localColumns: [fk],
            remoteColumns: [],
            source: 'foreign_key',
        };
    }

    if (isPlainObject(fk) && typeof fk.column === 'string') {
        const remote = normalizeQualifiedName(fk.table);
        if (!remote) {
            return undefined;
        }
        return {
            name: raw.name,
            kind,
            local: target,
            remote,
            localColumns: [fk.column],
            remoteColumns: [],
            source: 'foreign_key',
        };
    }

    return undefined;
}

function normalizePermissions(rawEntity: JsonObject): PermissionConfig[] {
    const result: PermissionConfig[] = [];
    const mappings = [
        ['select_permissions', 'read', 'filter'],
        ['insert_permissions', 'create', 'check'],
        ['update_permissions', 'update', 'filter'],
        ['delete_permissions', 'delete', 'filter'],
    ] as const;

    for (const [key, operation, primaryField] of mappings) {
        const entries = Array.isArray(rawEntity[key]) ? rawEntity[key] : [];
        for (const entry of entries) {
            if (!isPlainObject(entry) || typeof entry.role !== 'string' || !isPlainObject(entry.permission)) {
                continue;
            }
            const permission = entry.permission;
            result.push({
                role: entry.role,
                operation,
                filter: permission[primaryField] ?? {},
                check: permission.check,
                columns: Array.isArray(permission.columns)
                    ? permission.columns.filter((column): column is string => typeof column === 'string')
                    : undefined,
                presets: isPlainObject(permission.set) ? permission.set : undefined,
                allowAggregations: permission.allow_aggregations === true,
                comment: typeof entry.comment === 'string' ? entry.comment : undefined,
            });
        }
    }

    return result;
}

export async function loadHasuraMetadata(
    metadataDir: string,
    sourceName = 'default'
): Promise<LoadedHasuraMetadata> {
    const databasesPath = path.join(metadataDir, 'databases', 'databases.yaml');
    const parsed = await parseYamlWithIncludes(databasesPath);
    if (!Array.isArray(parsed)) {
        throw new Error(`Expected ${databasesPath} to contain a list of sources`);
    }

    const source = parsed.find(
        (entry) => isPlainObject(entry) && entry.name === sourceName
    );
    if (!isPlainObject(source)) {
        throw new Error(`Hasura source "${sourceName}" not found in ${databasesPath}`);
    }
    if (source.kind !== 'postgres') {
        throw new Error(`Hasura source "${sourceName}" has unsupported kind "${String(source.kind)}"`);
    }

    const rawTables = Array.isArray(source.tables) ? source.tables : [];
    const entities: LoadedTrackedEntity[] = [];
    for (const entry of rawTables) {
        if (!isPlainObject(entry)) {
            continue;
        }
        const target = normalizeQualifiedName(entry.table);
        if (!target) {
            continue;
        }

        const relationships = [
            ...(Array.isArray(entry.object_relationships) ? entry.object_relationships : []).map((relationship) =>
                normalizeRelationship(target, relationship, 'object')
            ),
            ...(Array.isArray(entry.array_relationships) ? entry.array_relationships : []).map((relationship) =>
                normalizeRelationship(target, relationship, 'array')
            ),
        ].filter((relationship): relationship is RelationConfig => Boolean(relationship));

        entities.push({
            target,
            relationships,
            permissions: normalizePermissions(entry),
        });
    }

    return {
        sourceName,
        sourceKind: 'postgres',
        entities,
    };
}

function mapPostgresType(column: ColumnInfo) {
    const normalized = column.dataType.toLowerCase();
    const udt = column.udtName.toLowerCase();

    if (
        normalized.includes('int') ||
        udt === 'int2' ||
        udt === 'int4'
    ) {
        return 'Int';
    }
    if (udt === 'int8' || normalized === 'bigint') {
        return 'BigInt';
    }
    if (normalized === 'numeric' || normalized === 'decimal') {
        return 'Decimal';
    }
    if (
        normalized === 'real' ||
        normalized === 'double precision' ||
        normalized === 'float'
    ) {
        return 'Float';
    }
    if (normalized === 'boolean' || udt === 'bool') {
        return 'Boolean';
    }
    if (
        normalized.includes('timestamp') ||
        normalized === 'date' ||
        normalized.includes('time')
    ) {
        return 'DateTime';
    }
    if (normalized === 'json' || normalized === 'jsonb') {
        return 'Json';
    }
    if (normalized === 'uuid') {
        return 'String';
    }
    if (
        normalized.includes('char') ||
        normalized === 'text' ||
        normalized === 'citext' ||
        normalized === 'varchar'
    ) {
        return 'String';
    }
    if (normalized === 'bytea') {
        return 'Bytes';
    }
    return 'String';
}

function mapDefaultExpression(column: ColumnInfo): string | undefined {
    const value = column.defaultValue ?? '';
    if (column.isIdentity) {
        return '@default(autoincrement())';
    }
    if (/nextval\(/i.test(value)) {
        return '@default(autoincrement())';
    }
    if (/gen_random_uuid\(\)|uuid_generate_v4\(\)/i.test(value)) {
        return '@default(uuid())';
    }
    if (/^now\(\)|current_timestamp/i.test(value)) {
        return '@default(now())';
    }
    const literal = value.match(/^'([^']*)'::/);
    if (literal) {
        return `@default("${literal[1].replace(/"/g, '\\"')}")`;
    }
    if (/^(true|false)$/i.test(value)) {
        return `@default(${value.toLowerCase()})`;
    }
    if (/^-?\d+(\.\d+)?$/.test(value)) {
        return `@default(${value})`;
    }
    return undefined;
}

async function createPgQueryable(databaseUrl: string): Promise<{ queryable: Queryable; close: () => Promise<void> }> {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    return {
        queryable: {
            query: (sql, params) => client.query(sql, params),
        },
        close: async () => {
            await client.end();
        },
    };
}

async function readRows<T extends JsonObject>(
    queryable: Queryable,
    sql: string,
    params: unknown[] = []
): Promise<T[]> {
    const result = await queryable.query(sql, params);
    return result.rows as T[];
}

function buildSchemaFilterSql(schemaFilter?: string[]) {
    if (!schemaFilter || schemaFilter.length === 0) {
        return {
            clause: `n.nspname NOT IN ('pg_catalog', 'information_schema')`,
            params: [] as unknown[],
        };
    }
    return {
        clause: `n.nspname = ANY($1::text[])`,
        params: [schemaFilter],
    };
}

export async function introspectPostgresSource(
    options: IntrospectPostgresSourceOptions
): Promise<IntrospectedSource> {
    const holder = options.queryable
        ? { queryable: options.queryable, close: async () => undefined }
        : await createPgQueryable(options.databaseUrl ?? '');
    const { clause, params } = buildSchemaFilterSql(options.schemaFilter);

    try {
        const objects = await readRows<{
            schema_name: string;
            object_name: string;
            relkind: string;
        }>(
            holder.queryable,
            `
                select n.nspname as schema_name, c.relname as object_name, c.relkind
                from pg_class c
                inner join pg_namespace n on n.oid = c.relnamespace
                where c.relkind in ('r', 'p', 'v', 'm')
                  and ${clause}
            `,
            params
        );

        const columns = await readRows<{
            schema_name: string;
            table_name: string;
            column_name: string;
            ordinal_position: number;
            is_nullable: 'YES' | 'NO';
            data_type: string;
            udt_name: string;
            column_default: string | null;
            is_identity: 'YES' | 'NO';
        }>(
            holder.queryable,
            `
                select
                    table_schema as schema_name,
                    table_name,
                    column_name,
                    ordinal_position,
                    is_nullable,
                    data_type,
                    udt_name,
                    column_default,
                    is_identity
                from information_schema.columns
                where table_schema not in ('pg_catalog', 'information_schema')
                ${options.schemaFilter?.length ? 'and table_schema = ANY($1::text[])' : ''}
                order by table_schema, table_name, ordinal_position
            `,
            options.schemaFilter?.length ? [options.schemaFilter] : []
        );

        const primaryKeys = await readRows<{
            schema_name: string;
            table_name: string;
            constraint_name: string;
            column_name: string;
            ordinal_position: number;
        }>(
            holder.queryable,
            `
                select
                    tc.table_schema as schema_name,
                    tc.table_name,
                    tc.constraint_name,
                    kcu.column_name,
                    kcu.ordinal_position
                from information_schema.table_constraints tc
                inner join information_schema.key_column_usage kcu
                    on tc.constraint_name = kcu.constraint_name
                    and tc.table_schema = kcu.table_schema
                    and tc.table_name = kcu.table_name
                where tc.constraint_type = 'PRIMARY KEY'
                  and tc.table_schema not in ('pg_catalog', 'information_schema')
                  ${options.schemaFilter?.length ? 'and tc.table_schema = ANY($1::text[])' : ''}
                order by tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position
            `,
            options.schemaFilter?.length ? [options.schemaFilter] : []
        );

        const uniques = await readRows<{
            schema_name: string;
            table_name: string;
            constraint_name: string;
            column_name: string;
            ordinal_position: number;
        }>(
            holder.queryable,
            `
                select
                    tc.table_schema as schema_name,
                    tc.table_name,
                    tc.constraint_name,
                    kcu.column_name,
                    kcu.ordinal_position
                from information_schema.table_constraints tc
                inner join information_schema.key_column_usage kcu
                    on tc.constraint_name = kcu.constraint_name
                    and tc.table_schema = kcu.table_schema
                    and tc.table_name = kcu.table_name
                where tc.constraint_type = 'UNIQUE'
                  and tc.table_schema not in ('pg_catalog', 'information_schema')
                  ${options.schemaFilter?.length ? 'and tc.table_schema = ANY($1::text[])' : ''}
                order by tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position
            `,
            options.schemaFilter?.length ? [options.schemaFilter] : []
        );

        const foreignKeys = await readRows<{
            schema_name: string;
            table_name: string;
            constraint_name: string;
            column_name: string;
            referenced_schema: string;
            referenced_table: string;
            referenced_column: string;
            ordinal_position: number;
        }>(
            holder.queryable,
            `
                select
                    tc.table_schema as schema_name,
                    tc.table_name,
                    tc.constraint_name,
                    kcu.column_name,
                    ccu.table_schema as referenced_schema,
                    ccu.table_name as referenced_table,
                    ccu.column_name as referenced_column,
                    kcu.ordinal_position
                from information_schema.table_constraints tc
                inner join information_schema.key_column_usage kcu
                    on tc.constraint_name = kcu.constraint_name
                    and tc.table_schema = kcu.table_schema
                    and tc.table_name = kcu.table_name
                inner join information_schema.constraint_column_usage ccu
                    on ccu.constraint_name = tc.constraint_name
                    and ccu.constraint_schema = tc.table_schema
                where tc.constraint_type = 'FOREIGN KEY'
                  and tc.table_schema not in ('pg_catalog', 'information_schema')
                  ${options.schemaFilter?.length ? 'and tc.table_schema = ANY($1::text[])' : ''}
                order by tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position
            `,
            options.schemaFilter?.length ? [options.schemaFilter] : []
        );

        return normalizeIntrospection({
            objects,
            columns,
            primaryKeys,
            uniques,
            foreignKeys,
        });
    } finally {
        await holder.close();
    }
}

export function normalizeIntrospection(input: {
    objects: Array<{ schema_name: string; object_name: string; relkind: string }>;
    columns: Array<{
        schema_name: string;
        table_name: string;
        column_name: string;
        ordinal_position: number;
        is_nullable: 'YES' | 'NO';
        data_type: string;
        udt_name: string;
        column_default: string | null;
        is_identity: 'YES' | 'NO';
    }>;
    primaryKeys: Array<{
        schema_name: string;
        table_name: string;
        constraint_name: string;
        column_name: string;
        ordinal_position: number;
    }>;
    uniques: Array<{
        schema_name: string;
        table_name: string;
        constraint_name: string;
        column_name: string;
        ordinal_position: number;
    }>;
    foreignKeys: Array<{
        schema_name: string;
        table_name: string;
        constraint_name: string;
        column_name: string;
        referenced_schema: string;
        referenced_table: string;
        referenced_column: string;
        ordinal_position: number;
    }>;
}): IntrospectedSource {
    const columnMap = new Map<string, ColumnInfo[]>();
    for (const row of input.columns) {
        const key = `${row.schema_name}.${row.table_name}`;
        const list = columnMap.get(key) ?? [];
        list.push({
            schema: row.schema_name,
            tableName: row.table_name,
            columnName: row.column_name,
            position: row.ordinal_position,
            isNullable: row.is_nullable === 'YES',
            dataType: row.data_type,
            udtName: row.udt_name,
            defaultValue: row.column_default,
            isIdentity: row.is_identity === 'YES',
        });
        columnMap.set(key, list);
    }

    const pkMap = groupConstraints(input.primaryKeys);
    const uniqueMap = groupConstraints(input.uniques);
    const fkMap = groupForeignKeys(input.foreignKeys);

    const entities: IntrospectedEntity[] = [];
    for (const object of input.objects) {
        const target = {
            schema: object.schema_name,
            name: object.object_name,
        };
        const key = qualifiedKey(target);
        const pk = pkMap.get(key)?.[0]?.columns ?? [];
        const uniqueConstraints = uniqueMap.get(key)?.map((constraint) => constraint.columns) ?? [];
        const columns = (columnMap.get(key) ?? [])
            .sort((left, right) => left.position - right.position)
            .map((column) => {
                const zmodelName = toCamelCase(column.columnName);
                return {
                    name: column.columnName,
                    zmodelName,
                    type: mapPostgresType(column),
                    isNullable: column.isNullable,
                    isId: pk.length === 1 && pk[0] === column.columnName,
                    isUnique: uniqueConstraints.some(
                        (constraint) => constraint.length === 1 && constraint[0] === column.columnName
                    ),
                    defaultExpression: mapDefaultExpression(column),
                    map: zmodelName !== column.columnName ? column.columnName : undefined,
                    rawType: column.dataType,
                    comments:
                        mapDefaultExpression(column) === undefined && column.defaultValue
                            ? [`TODO default expression not translated: ${column.defaultValue}`]
                            : [],
                } satisfies IntrospectedField;
            });

        entities.push({
            target,
            modelName: `${toPascalCase(target.schema)}${toPascalCase(target.name)}`,
            isView: object.relkind === 'v' || object.relkind === 'm',
            columns,
            primaryKey: pk,
            uniqueConstraints,
            relations: (fkMap.get(key) ?? []).map((fk) => ({
                name: toCamelCase(fk.referencedTable),
                targetModel: `${toPascalCase(fk.referencedSchema)}${toPascalCase(fk.referencedTable)}`,
                target: {
                    schema: fk.referencedSchema,
                    name: fk.referencedTable,
                },
                kind: 'object',
                localColumns: fk.columns,
                remoteColumns: fk.referencedColumns,
                relationName: fk.constraintName,
                source: 'foreign_key',
                renderable: true,
                comments: [],
            })),
            comments: target.schema !== 'public' ? [`Original schema: ${target.schema}`] : [],
        });
    }

    return { entities };
}

function groupConstraints(
    rows: Array<{
        schema_name: string;
        table_name: string;
        constraint_name: string;
        column_name: string;
        ordinal_position: number;
    }>
) {
    const map = new Map<string, ConstraintInfo[]>();
    for (const row of rows) {
        const key = `${row.schema_name}.${row.table_name}`;
        const list = map.get(key) ?? [];
        let constraint = list.find((entry) => entry.constraintName === row.constraint_name);
        if (!constraint) {
            constraint = {
                schema: row.schema_name,
                tableName: row.table_name,
                constraintName: row.constraint_name,
                columns: [],
            };
            list.push(constraint);
        }
        constraint.columns[row.ordinal_position - 1] = row.column_name;
        map.set(key, list);
    }
    return map;
}

function groupForeignKeys(
    rows: Array<{
        schema_name: string;
        table_name: string;
        constraint_name: string;
        column_name: string;
        referenced_schema: string;
        referenced_table: string;
        referenced_column: string;
        ordinal_position: number;
    }>
) {
    const map = new Map<string, ForeignKeyInfo[]>();
    for (const row of rows) {
        const key = `${row.schema_name}.${row.table_name}`;
        const list = map.get(key) ?? [];
        let constraint = list.find((entry) => entry.constraintName === row.constraint_name);
        if (!constraint) {
            constraint = {
                schema: row.schema_name,
                tableName: row.table_name,
                constraintName: row.constraint_name,
                columns: [],
                referencedSchema: row.referenced_schema,
                referencedTable: row.referenced_table,
                referencedColumns: [],
            };
            list.push(constraint);
        }
        constraint.columns[row.ordinal_position - 1] = row.column_name;
        constraint.referencedColumns[row.ordinal_position - 1] = row.referenced_column;
        map.set(key, list);
    }
    return map;
}

function mapSessionVariableName(input: string) {
    if (input === 'X-Hasura-User-Id') {
        return 'auth().id';
    }

    if (!input.startsWith('X-Hasura-')) {
        return undefined;
    }

    const suffix = input.slice('X-Hasura-'.length);
    return `auth().${toCamelCase(suffix)}`;
}

function quoteLiteral(value: unknown): string {
    if (value === null) {
        return 'null';
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
        return String(value);
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function renderComparisonValue(value: unknown) {
    if (typeof value === 'string' && /^auth\(\)\./.test(value)) {
        return value;
    }
    return quoteLiteral(value);
}

function joinAnd(expressions: string[]) {
    const filtered = expressions.filter(Boolean);
    if (filtered.length === 0) {
        return 'true';
    }
    if (filtered.length === 1) {
        return filtered[0];
    }
    return `(${filtered.join(' && ')})`;
}

function joinOr(expressions: string[]) {
    const filtered = expressions.filter(Boolean);
    if (filtered.length === 0) {
        return 'false';
    }
    if (filtered.length === 1) {
        return filtered[0];
    }
    return `(${filtered.join(' || ')})`;
}

type ExpressionTranslation = {
    expression?: string;
    todos: string[];
    unsupportedOperators: string[];
};

function translateComparison(fieldRef: string, operator: string, value: unknown): ExpressionTranslation {
    switch (operator) {
        case '_eq':
            return { expression: `${fieldRef} == ${renderComparisonValue(value)}`, todos: [], unsupportedOperators: [] };
        case '_neq':
            return { expression: `${fieldRef} != ${renderComparisonValue(value)}`, todos: [], unsupportedOperators: [] };
        case '_gt':
            return { expression: `${fieldRef} > ${renderComparisonValue(value)}`, todos: [], unsupportedOperators: [] };
        case '_gte':
            return { expression: `${fieldRef} >= ${renderComparisonValue(value)}`, todos: [], unsupportedOperators: [] };
        case '_lt':
            return { expression: `${fieldRef} < ${renderComparisonValue(value)}`, todos: [], unsupportedOperators: [] };
        case '_lte':
            return { expression: `${fieldRef} <= ${renderComparisonValue(value)}`, todos: [], unsupportedOperators: [] };
        case '_is_null':
            return {
                expression: value === true ? `${fieldRef} == null` : `${fieldRef} != null`,
                todos: [],
                unsupportedOperators: [],
            };
        case '_in':
            if (!Array.isArray(value) || value.length === 0) {
                return { expression: 'false', todos: [], unsupportedOperators: [] };
            }
                return {
                expression: joinOr(value.map((entry) => `${fieldRef} == ${renderComparisonValue(entry)}`)),
                todos: [],
                unsupportedOperators: [],
            };
        case '_nin':
            if (!Array.isArray(value) || value.length === 0) {
                return { expression: 'true', todos: [], unsupportedOperators: [] };
            }
                return {
                expression: joinAnd(value.map((entry) => `${fieldRef} != ${renderComparisonValue(entry)}`)),
                todos: [],
                unsupportedOperators: [],
            };
        default:
            return {
                todos: [`TODO unsupported Hasura operator ${operator}`],
                unsupportedOperators: [operator],
            };
    }
}

function translateExpressionNode(
    entity: IntrospectedEntity,
    node: unknown,
    relationPath = '',
    depth = 0
): ExpressionTranslation {
    if (!isPlainObject(node)) {
        return { expression: 'true', todos: [], unsupportedOperators: [] };
    }

    const expressions: string[] = [];
    const todos: string[] = [];
    const unsupportedOperators: string[] = [];

    for (const [key, value] of Object.entries(node)) {
        if (key === '_and') {
            if (!Array.isArray(value)) {
                continue;
            }
            const translated = value.map((entry) => translateExpressionNode(entity, entry, relationPath, depth + 1));
            expressions.push(joinAnd(translated.map((entry) => entry.expression ?? 'true')));
            todos.push(...translated.flatMap((entry) => entry.todos));
            unsupportedOperators.push(...translated.flatMap((entry) => entry.unsupportedOperators));
            continue;
        }

        if (key === '_or') {
            if (!Array.isArray(value)) {
                continue;
            }
            const translated = value.map((entry) => translateExpressionNode(entity, entry, relationPath, depth + 1));
            expressions.push(joinOr(translated.map((entry) => entry.expression ?? 'false')));
            todos.push(...translated.flatMap((entry) => entry.todos));
            unsupportedOperators.push(...translated.flatMap((entry) => entry.unsupportedOperators));
            continue;
        }

        if (key === '_not') {
            const translated = translateExpressionNode(entity, value, relationPath, depth + 1);
            if (translated.expression) {
                expressions.push(`!(${translated.expression})`);
            }
            todos.push(...translated.todos);
            unsupportedOperators.push(...translated.unsupportedOperators);
            continue;
        }

        const relation = entity.relations.find((entry) => entry.name === key && entry.kind === 'object');
        if (relation && isPlainObject(value)) {
            const nextEntityRef = `${relationPath}${relation.name}.`;
            const translated = translateExpressionNode(entity, value, nextEntityRef, depth + 1);
            if (translated.expression) {
                expressions.push(`${relationPath}${relation.name} != null && ${translated.expression}`);
            }
            todos.push(...translated.todos);
            unsupportedOperators.push(...translated.unsupportedOperators);
            continue;
        }

        const listRelation = entity.relations.find((entry) => entry.name === key && entry.kind === 'array');
        if (listRelation) {
            todos.push(`TODO unsupported list relation predicate on ${key}`);
            unsupportedOperators.push('list_relation_predicate');
            continue;
        }

        const field = entity.columns.find(
            (entry) => entry.zmodelName === key || entry.name === key
        );
        if (!field) {
            todos.push(`TODO unsupported permission field ${relationPath}${key}`);
            unsupportedOperators.push('unknown_field');
            continue;
        }

        if (isPlainObject(value)) {
            for (const [operator, rawValue] of Object.entries(value)) {
                const resolvedValue =
                    typeof rawValue === 'string' && rawValue.startsWith('X-Hasura-')
                        ? mapSessionVariableName(rawValue)
                        : undefined;
                const translated = translateComparison(
                    `${relationPath}${field.zmodelName}`,
                    operator,
                    resolvedValue ?? rawValue
                );
                if (translated.expression) {
                    expressions.push(translated.expression);
                }
                todos.push(...translated.todos);
                unsupportedOperators.push(...translated.unsupportedOperators);
            }
            continue;
        }

        const mappedSessionValue =
            typeof value === 'string' && value.startsWith('X-Hasura-')
                ? mapSessionVariableName(value)
                : undefined;
        expressions.push(
            mappedSessionValue
                ? `${relationPath}${field.zmodelName} == ${mappedSessionValue}`
                : `${relationPath}${field.zmodelName} == ${quoteLiteral(value)}`
        );
    }

    return {
        expression: expressions.length > 0 ? joinAnd(expressions) : 'true',
        todos,
        unsupportedOperators,
    };
}

export function translatePermission(
    entity: IntrospectedEntity,
    permission: PermissionConfig
): ExpressionTranslation & { policy?: string; translated: boolean } {
    const todos: string[] = [];
    if ((permission.columns?.length ?? 0) > 0) {
        todos.push(`TODO column-level ${permission.operation} permission columns not translated`);
    }
    if (permission.presets && Object.keys(permission.presets).length > 0) {
        todos.push(`TODO ${permission.operation} presets not translated`);
    }
    if (permission.allowAggregations) {
        todos.push('TODO allow_aggregations metadata not translated');
    }
    if (permission.operation === 'update' && permission.check && JSON.stringify(permission.check) !== '{}') {
        todos.push('TODO update.check post-update validation semantics not translated');
    }
    if (permission.comment) {
        todos.push(`TODO original Hasura permission comment: ${permission.comment}`);
    }

    const sourceNode =
        permission.operation === 'create'
            ? permission.check ?? permission.filter
            : permission.filter;
    const translated = translateExpressionNode(entity, sourceNode);
    todos.push(...translated.todos);

    const guard = `auth().role == '${permission.role}'`;
    const body = translated.expression && translated.expression !== 'true'
        ? `${guard} && ${translated.expression}`
        : guard;

    return {
        ...translated,
        todos,
        policy: `@@allow('${permission.operation}', ${body})`,
        translated: translated.unsupportedOperators.length === 0,
    };
}

function applyRelationshipMetadata(
    entity: IntrospectedEntity,
    metadataEntity: LoadedTrackedEntity,
    entityMap: Map<string, IntrospectedEntity>
) {
    const usedNames = new Set(entity.relations.map((relation) => relation.name));

    for (const relation of metadataEntity.relationships) {
        const relationTargetKey = qualifiedKey(relation.remote);
        const targetEntity = entityMap.get(relationTargetKey);
        const matched = entity.relations.find((entry) => {
            return (
                entry.localColumns.length === relation.localColumns.length &&
                entry.localColumns.every((column, index) => column === relation.localColumns[index]) &&
                (
                    qualifiedKey(entry.target) === relationTargetKey ||
                    relation.remoteColumns.length === 0
                )
            );
        });

        if (matched && relation.name !== matched.name && !usedNames.has(relation.name)) {
            usedNames.delete(matched.name);
            matched.name = relation.name;
            matched.comments.push('Hasura relationship name applied');
            usedNames.add(relation.name);
            continue;
        }

        if (!matched && relation.source === 'manual' && relation.kind === 'object' && targetEntity) {
            const targetHasUnique = targetEntity.primaryKey.length > 0 ||
                targetEntity.uniqueConstraints.some(
                    (constraint) =>
                        constraint.length === relation.remoteColumns.length &&
                        constraint.every((column, index) => column === relation.remoteColumns[index])
                );
            if (!targetHasUnique) {
                entity.comments.push(
                    `TODO manual relationship ${relation.name} could not be rendered safely because remote columns are not uniquely identified`
                );
                continue;
            }

            const localColumnsExist = relation.localColumns.every((column) =>
                entity.columns.some((field) => field.name === column)
            );
            if (!localColumnsExist) {
                entity.comments.push(
                    `TODO manual relationship ${relation.name} could not be rendered because local columns are missing`
                );
                continue;
            }

            const name = usedNames.has(relation.name)
                ? `${relation.name}Manual`
                : relation.name;
            entity.relations.push({
                name,
                targetModel: targetEntity.modelName,
                target: relation.remote,
                kind: 'object',
                localColumns: relation.localColumns,
                remoteColumns: relation.remoteColumns,
                relationName: `${entity.modelName}_${targetEntity.modelName}_${name}`,
                source: 'manual',
                renderable: true,
                comments: ['Manual Hasura relationship rendered without DB foreign key'],
            });
            usedNames.add(name);
            continue;
        }

        if (!matched) {
            entity.comments.push(`TODO unsupported Hasura relationship ${relation.name}`);
        }
    }
}

export function translateToIntermediateModel(
    loaded: LoadedHasuraMetadata,
    introspected: IntrospectedSource,
    options?: { includeViews?: boolean }
): ImportResult {
    const includeViews = options?.includeViews !== false;
    const entityMap = new Map(
        introspected.entities.map((entity) => [qualifiedKey(entity.target), entity])
    );
    const warnings: ImportWarning[] = [];
    const rendered: RenderedEntity[] = [];
    const roles = new Set<string>();
    const unsupportedOperators: Record<string, number> = {};
    let translatedPermissions = 0;
    let permissionTodos = 0;
    let importedTables = 0;
    let importedViews = 0;
    let commentedViewStubs = 0;

    for (const metadataEntity of loaded.entities) {
        const introspectedEntity = entityMap.get(qualifiedKey(metadataEntity.target));
        if (!introspectedEntity) {
            warnings.push({
                scope: qualifiedKey(metadataEntity.target),
                message: 'Tracked Hasura entity was not found during Postgres introspection',
            });
            continue;
        }

        applyRelationshipMetadata(introspectedEntity, metadataEntity, entityMap);

        const todos: string[] = [];
        const policies: string[] = [];
        const comments = [...introspectedEntity.comments];

        if (introspectedEntity.isView && !includeViews) {
            comments.push('TODO skipped tracked view because --include-views was disabled');
        }

        const hasIdentity =
            introspectedEntity.primaryKey.length > 0 ||
            introspectedEntity.uniqueConstraints.some((constraint) => constraint.length > 0);
        const renderable = !introspectedEntity.isView || hasIdentity;

        if (introspectedEntity.isView && renderable) {
            policies.push(READ_ONLY_VIEW_POLICY);
            comments.push('Imported from a Hasura-tracked view');
            importedViews++;
        } else if (introspectedEntity.isView) {
            commentedViewStubs++;
            todos.push('TODO tracked view has no primary key or unique constraint, so a model stub was emitted instead');
        } else {
            importedTables++;
        }

        for (const permission of metadataEntity.permissions) {
            roles.add(permission.role);
            const translated = translatePermission(introspectedEntity, permission);
            if (translated.policy) {
                policies.push(translated.policy);
            }
            if (translated.translated) {
                translatedPermissions++;
            }
            if (translated.todos.length > 0 || translated.unsupportedOperators.length > 0) {
                permissionTodos++;
            }
            todos.push(...translated.todos.map((todo) => `[${permission.role}:${permission.operation}] ${todo}`));
            for (const operator of translated.unsupportedOperators) {
                unsupportedOperators[operator] = (unsupportedOperators[operator] ?? 0) + 1;
            }
        }

        rendered.push({
            target: introspectedEntity.target,
            modelName: introspectedEntity.modelName,
            isView: introspectedEntity.isView,
            renderable: renderable && (!introspectedEntity.isView || includeViews),
            fields: introspectedEntity.columns,
            relations: introspectedEntity.relations,
            primaryKey: introspectedEntity.primaryKey,
            uniqueConstraints: introspectedEntity.uniqueConstraints,
            policies: Array.from(new Set(policies)),
            comments,
            todos,
        });
    }

    rendered.sort((left, right) => qualifiedKey(left.target).localeCompare(qualifiedKey(right.target)));

    return {
        sourceName: loaded.sourceName,
        entities: rendered,
        warnings,
        summary: {
            importedTables,
            importedViews,
            commentedViewStubs,
            rolesTranslated: roles.size,
            permissionsTranslated: translatedPermissions,
            permissionsWithTodos: permissionTodos,
            unsupportedOperators,
        },
    };
}

function renderField(field: IntrospectedField) {
    const parts = [`  ${field.zmodelName}`, `${field.type}${field.isNullable ? '?' : ''}`];
    if (field.isId) {
        parts.push('@id');
    }
    if (field.isUnique) {
        parts.push('@unique');
    }
    if (field.defaultExpression) {
        parts.push(field.defaultExpression);
    }
    if (field.map) {
        parts.push(`@map("${field.map}")`);
    }
    return parts.join(' ');
}

function renderRelation(relation: IntrospectedRelation, fields: IntrospectedField[]) {
    const targetType = relation.kind === 'array' ? `${relation.targetModel}[]` : relation.targetModel;
    const parts = [`  ${relation.name}`, targetType];
    if (relation.kind === 'object') {
        const localFieldNames = relation.localColumns
            .map((column) => fields.find((field) => field.name === column)?.zmodelName)
            .filter((column): column is string => Boolean(column));
        const remoteFieldNames = relation.remoteColumns.map((column) => toCamelCase(column));
        if (
            relation.renderable &&
            localFieldNames.length === relation.localColumns.length &&
            remoteFieldNames.length === relation.remoteColumns.length
        ) {
            const relationArgs = [
                `fields: [${localFieldNames.join(', ')}]`,
                `references: [${remoteFieldNames.join(', ')}]`,
            ];
            if (relation.relationName) {
                relationArgs.unshift(`"${relation.relationName}"`);
            }
            parts.push(`@relation(${relationArgs.join(', ')})`);
        }
    } else if (relation.relationName) {
        parts.push(`@relation("${relation.relationName}")`);
    }
    return parts.join(' ');
}

function renderViewStub(entity: RenderedEntity) {
    const lines = [
        `// TODO tracked view ${qualifiedKey(entity.target)} could not be rendered as a model`,
        `// Reason: no primary key or unique constraint was found during introspection`,
        `// model ${entity.modelName} {`,
    ];
    for (const field of entity.fields) {
        lines.push(`// ${renderField(field).trim()}`);
    }
    lines.push(`//   @@map("${entity.target.name}")`);
    lines.push('// }');
    return lines.join('\n');
}

function renderSummary(summary: ImportSummary) {
    const lines = [
        '// Import summary',
        `// imported_tables: ${summary.importedTables}`,
        `// imported_views: ${summary.importedViews}`,
        `// commented_view_stubs: ${summary.commentedViewStubs}`,
        `// roles_translated: ${summary.rolesTranslated}`,
        `// permissions_translated: ${summary.permissionsTranslated}`,
        `// permissions_with_todos: ${summary.permissionsWithTodos}`,
        `// unsupported_operators: ${
            Object.keys(summary.unsupportedOperators).length > 0
                ? JSON.stringify(summary.unsupportedOperators)
                : '{}'
        }`,
    ];
    return lines.join('\n');
}

export function renderZModel(result: ImportResult) {
    const lines = [
        '// Generated by import-hasura-to-zmodel',
        `// Source: ${result.sourceName}`,
        '// This file is a best-effort import from Hasura metadata plus Postgres introspection.',
        '',
    ];

    for (const entity of result.entities) {
        if (!entity.renderable) {
            lines.push(renderViewStub(entity), '');
            continue;
        }

        for (const comment of entity.comments) {
            lines.push(`// ${comment}`);
        }
        for (const todo of entity.todos) {
            lines.push(`// ${todo}`);
        }

        lines.push(`model ${entity.modelName} {`);
        for (const field of entity.fields) {
            lines.push(renderField(field));
            for (const comment of field.comments) {
                lines.push(`  // ${comment}`);
            }
        }

        for (const relation of entity.relations.filter((relation) => relation.kind === 'object')) {
            lines.push(renderRelation(relation, entity.fields));
            for (const comment of relation.comments) {
                lines.push(`  // ${comment}`);
            }
        }

        for (const relation of entity.relations.filter((relation) => relation.kind === 'array')) {
            if (!relation.renderable) {
                lines.push(`  // TODO unsupported array relation ${relation.name}`);
                continue;
            }
            lines.push(renderRelation(relation, entity.fields));
            for (const comment of relation.comments) {
                lines.push(`  // ${comment}`);
            }
        }

        if (entity.primaryKey.length > 1) {
            lines.push(`  @@id([${entity.primaryKey.map((column) => toCamelCase(column)).join(', ')}])`);
        }

        for (const unique of entity.uniqueConstraints.filter((constraint) => constraint.length > 1)) {
            lines.push(`  @@unique([${unique.map((column) => toCamelCase(column)).join(', ')}])`);
        }

        lines.push(`  @@map("${entity.target.name}")`);
        for (const policy of entity.policies) {
            lines.push(`  ${policy}`);
        }
        lines.push('}', '');
    }

    lines.push(renderSummary(result.summary));
    return lines.join('\n').trimEnd() + '\n';
}

export async function importHasuraToZModel(
    options: ImportHasuraToZModelOptions
): Promise<ImportHasuraToZModelResult> {
    const loaded = await loadHasuraMetadata(options.metadataDir, options.sourceName);
    const introspected = await introspectPostgresSource({
        databaseUrl: options.databaseUrl,
        schemaFilter: options.schemaFilter,
    });
    const result = translateToIntermediateModel(loaded, introspected, {
        includeViews: options.includeViews,
    });
    return {
        zmodel: renderZModel(result),
        result,
    };
}
