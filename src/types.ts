import type {
    GraphQLError,
    GraphQLFieldConfig,
    GraphQLFieldConfigMap,
    GraphQLResolveInfo,
    GraphQLScalarType,
} from 'graphql';

export type ScalarType =
    | 'ID'
    | 'String'
    | 'Int'
    | 'Float'
    | 'Boolean'
    | 'DateTime'
    | 'Decimal'
    | 'Json'
    | 'BigInt';

export type FieldKind = 'scalar' | 'enum' | 'relation' | 'typeDef';
export type ProcedureTypeKind = 'scalar' | 'enum' | 'model' | 'typeDef';

export interface BaseFieldDefinition {
    name: string;
    kind: FieldKind;
    isList?: boolean;
    isNullable?: boolean;
    isId?: boolean;
    isUnique?: boolean;
    isReadOnly?: boolean;
    isComputed?: boolean;
    isInternal?: boolean;
    nativeType?: string;
    description?: string;
}

export interface ScalarFieldDefinition extends BaseFieldDefinition {
    kind: 'scalar';
    type: ScalarType;
}

export interface EnumFieldDefinition extends BaseFieldDefinition {
    kind: 'enum';
    type: string;
}

export interface RelationFieldDefinition extends BaseFieldDefinition {
    kind: 'relation';
    type: string;
    foreignKeyFields?: string[];
    referenceFields?: string[];
}

export type FieldDefinition =
    | ScalarFieldDefinition
    | EnumFieldDefinition
    | RelationFieldDefinition;

export interface UniqueConstraintDefinition {
    name?: string;
    fields: string[];
}

export interface ModelDefinition {
    name: string;
    dbName?: string;
    description?: string;
    fields: FieldDefinition[] | Record<string, FieldDefinition>;
    primaryKey?: string[];
    uniqueConstraints?: UniqueConstraintDefinition[];
}

export interface EnumDefinition {
    name: string;
    values: string[] | Record<string, string>;
    description?: string;
}

export interface TypeDefDefinition {
    name: string;
    fields: FieldDefinition[] | Record<string, FieldDefinition>;
    description?: string;
}

export interface ProcedureParamDefinition {
    name: string;
    type: string;
    isList?: boolean;
    isNullable?: boolean;
}

export interface ProcedureDefinition {
    name?: string;
    params?:
        | ProcedureParamDefinition[]
        | Record<string, ProcedureParamDefinition>
        | Record<string, Record<string, unknown>>;
    returnType: string;
    returnArray?: boolean;
    mutation?: boolean;
    description?: string;
}

export interface ZenStackSchemaLike {
    provider?: {
        type?: string;
    };
    models?:
        | ModelDefinition[]
        | Record<string, ModelDefinition>
        | Record<string, { fields: ModelDefinition['fields']; primaryKey?: string[]; uniqueConstraints?: UniqueConstraintDefinition[] }>
        | Record<
              string,
              {
                  name?: string;
                  fields: Record<string, Record<string, unknown>>;
                  idFields?: readonly string[];
                  uniqueFields?: Record<string, unknown>;
              }
          >;
    enums?: EnumDefinition[] | Record<string, EnumDefinition>;
    typeDefs?:
        | TypeDefDefinition[]
        | Record<string, TypeDefDefinition>
        | Record<string, { name?: string; fields: Record<string, Record<string, unknown>> }>;
    procedures?: ProcedureDefinition[] | Record<string, ProcedureDefinition>;
    modelMeta?: ZenStackSchemaLike['models'];
    enumMeta?: ZenStackSchemaLike['enums'];
    typeDefMeta?: ZenStackSchemaLike['typeDefs'];
    procedureMeta?: ZenStackSchemaLike['procedures'];
}

export interface NormalizedEnumDefinition {
    name: string;
    values: string[];
    description?: string;
}

export interface NormalizedFieldDefinition extends BaseFieldDefinition {
    kind: FieldKind;
    type: string;
    foreignKeyFields?: string[];
    referenceFields?: string[];
}

export interface NormalizedModelDefinition {
    name: string;
    dbName?: string;
    description?: string;
    fields: NormalizedFieldDefinition[];
    fieldMap: Map<string, NormalizedFieldDefinition>;
    primaryKey: string[];
    uniqueConstraints: UniqueConstraintDefinition[];
}

export interface NormalizedTypeDefDefinition {
    name: string;
    description?: string;
    fields: NormalizedFieldDefinition[];
    fieldMap: Map<string, NormalizedFieldDefinition>;
}

export interface NormalizedProcedureParamDefinition {
    name: string;
    type: string;
    kind: ProcedureTypeKind;
    isList?: boolean;
    isNullable?: boolean;
    nativeType?: string;
}

export interface NormalizedProcedureDefinition {
    name: string;
    description?: string;
    params: NormalizedProcedureParamDefinition[];
    returnType: string;
    returnKind: ProcedureTypeKind;
    returnArray?: boolean;
    mutation?: boolean;
}

export interface NormalizedSchema {
    provider?: {
        type?: string;
    };
    models: NormalizedModelDefinition[];
    modelMap: Map<string, NormalizedModelDefinition>;
    enums: NormalizedEnumDefinition[];
    enumMap: Map<string, NormalizedEnumDefinition>;
    typeDefs: NormalizedTypeDefDefinition[];
    typeDefMap: Map<string, NormalizedTypeDefDefinition>;
    procedures: NormalizedProcedureDefinition[];
    procedureMap: Map<string, NormalizedProcedureDefinition>;
}

export interface ProviderCapabilities {
    provider: string;
    supportsInsensitiveMode: boolean;
    supportsDistinctOn: boolean;
    supportsJsonFilters: boolean;
    supportsJsonFilterMode: boolean;
    supportsScalarListFilters: boolean;
}

export type OrderByDirection =
    | 'asc'
    | 'desc'
    | 'asc_nulls_first'
    | 'asc_nulls_last'
    | 'desc_nulls_first'
    | 'desc_nulls_last';

export interface ResolverInvocation<TContext = unknown> {
    operation:
        | 'query'
        | 'aggregate'
        | 'insertMany'
        | 'insertOne'
        | 'updateMany'
        | 'updateByPk'
        | 'deleteMany'
        | 'deleteByPk'
        | 'relation'
        | 'procedureQuery'
        | 'procedureMutation'
        | 'extensionQuery'
        | 'extensionMutation';
    model?: NormalizedModelDefinition;
    fieldName: string;
    args: Record<string, unknown>;
    context: TContext;
    info: GraphQLResolveInfo;
}

export interface ResolverHooks<TContext = unknown> {
    beforeResolve?: (invocation: ResolverInvocation<TContext>) => void | Promise<void>;
    afterResolve?: (
        result: unknown,
        invocation: ResolverInvocation<TContext>
    ) => void | Promise<void>;
    formatError?: (
        error: GraphQLError,
        invocation: ResolverInvocation<TContext>
    ) => GraphQLError | Promise<GraphQLError>;
}

export interface FeatureFlags {
    aggregates?: boolean;
    nestedArgs?: boolean;
    computedFields?: boolean;
    conflictClauses?: boolean;
    subscriptions?: boolean;
    exposeInternalFields?: boolean;
}

export interface RelayOptions {
    enabled?: boolean;
}

export type CompatibilityMode = 'hasura-compat';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Logger = (level: LogLevel, message: string, error?: unknown) => void;
export type LogConfig = ReadonlyArray<LogLevel> | Logger;

export interface GraphQLApiRequestContext<TClient = unknown, TContext = unknown> {
    client: TClient;
    method: string;
    path: string;
    query?: Record<string, string | string[]>;
    requestBody?: unknown;
    context?: TContext;
}

export interface GraphQLApiResponse {
    status: number;
    headers?: Record<string, string>;
    body: unknown;
}

export interface GraphQLHandlerRequest<TRequest = unknown> {
    method: string;
    request: TRequest;
    headers?: Headers | Record<string, unknown>;
    searchParams?: URLSearchParams | URL | Record<string, unknown>;
    body?: unknown;
}

export interface GraphQLHandlerResponse {
    status: number;
    headers?: Record<string, string>;
    body: unknown;
}

export type SchemaFilterKind =
    | 'Equality'
    | 'Range'
    | 'Like'
    | 'Relation'
    | 'Json'
    | 'List';

export type SchemaCrudOperation =
    | 'findMany'
    | 'queryMany'
    | 'findUnique'
    | 'queryByPk'
    | 'aggregate'
    | 'createMany'
    | 'insertMany'
    | 'create'
    | 'insertOne'
    | 'updateMany'
    | 'update'
    | 'updateByPk'
    | 'deleteMany'
    | 'delete'
    | 'deleteByPk';

export interface FieldSlicingConfig {
    includedFilterKinds?: SchemaFilterKind[];
    excludedFilterKinds?: SchemaFilterKind[];
}

export interface ModelSlicingConfig {
    includedOperations?: SchemaCrudOperation[];
    excludedOperations?: SchemaCrudOperation[];
    includedFields?: string[];
    excludedFields?: string[];
    fields?: Record<string, FieldSlicingConfig | undefined>;
}

export interface SchemaSlicingConfig {
    includedModels?: string[];
    excludedModels?: string[];
    includedProcedures?: string[];
    excludedProcedures?: string[];
    models?: Record<string, ModelSlicingConfig | undefined>;
}

export interface NamingStrategy {
    queryMany(model: NormalizedModelDefinition): string;
    queryByPk(model: NormalizedModelDefinition): string;
    queryAggregate(model: NormalizedModelDefinition): string;
    insertMany(model: NormalizedModelDefinition): string;
    insertOne(model: NormalizedModelDefinition): string;
    updateMany(model: NormalizedModelDefinition): string;
    updateByPk(model: NormalizedModelDefinition): string;
    deleteMany(model: NormalizedModelDefinition): string;
    deleteByPk(model: NormalizedModelDefinition): string;
    typeName(modelName: string): string;
}

export type NamingConfig = 'hasura' | 'hasura-table' | 'prisma' | Partial<NamingStrategy>;

export interface ScalarAliasConfig {
    defaults?: Partial<Record<ScalarType, string>>;
    nativeTypes?: Record<string, string>;
}

export type RootFieldConfig<TClient = unknown, TContext = unknown> = Omit<
    GraphQLFieldConfig<unknown, TContext>,
    'resolve'
> & {
    resolve?: (
        source: unknown,
        args: Record<string, unknown>,
        context: TContext,
        info: GraphQLResolveInfo,
        helpers: { client: TClient }
    ) => unknown | Promise<unknown>;
};

export interface RootFieldExtensions<TClient = unknown, TContext = unknown> {
    query?: Record<string, RootFieldConfig<TClient, TContext>>;
    mutation?: Record<string, RootFieldConfig<TClient, TContext>>;
}

export type SchemaInput = ZenStackSchemaLike | ModelDefinition[];

export interface CreateZenStackGraphQLSchemaOptions<
    TClient = unknown,
    TContext = unknown,
    TSchema extends SchemaInput = SchemaInput,
> {
    schema: TSchema;
    getClient(context: TContext): TClient | Promise<TClient>;
    compatibility?: CompatibilityMode;
    naming?: NamingConfig;
    features?: FeatureFlags;
    relay?: RelayOptions;
    slicing?: SchemaSlicingConfig;
    scalars?: Partial<Record<ScalarType, GraphQLScalarType>>;
    scalarAliases?: ScalarAliasConfig | 'hasura';
    hooks?: ResolverHooks<TContext>;
    extensions?: RootFieldExtensions<TClient, TContext>;
}

export interface ModelDelegate {
    findMany?(args?: Record<string, unknown>): Promise<unknown[]>;
    findUnique?(args: Record<string, unknown>): Promise<unknown | null>;
    count?(args?: Record<string, unknown>): Promise<number>;
    aggregate?(args?: Record<string, unknown>): Promise<Record<string, unknown>>;
    create?(args: Record<string, unknown>): Promise<unknown>;
    createMany?(args: Record<string, unknown>): Promise<{ count: number }>;
    createManyAndReturn?(args: Record<string, unknown>): Promise<unknown[]>;
    upsert?(args: Record<string, unknown>): Promise<unknown>;
    update?(args: Record<string, unknown>): Promise<unknown>;
    updateMany?(args: Record<string, unknown>): Promise<{ count: number }>;
    delete?(args: Record<string, unknown>): Promise<unknown>;
    deleteMany?(args: Record<string, unknown>): Promise<{ count: number }>;
}

export type ZenStackClientLike = Record<string, unknown> & {
    $transaction?: unknown;
    $procs?: Record<string, unknown>;
};

export interface ZenStackGraphQLExecutionMetadata<
    TClient extends ZenStackClientLike = ZenStackClientLike,
    TContext = unknown,
> {
    getClient(context: TContext): TClient | Promise<TClient>;
}
