import {
    GraphQLBoolean,
    GraphQLEnumType,
    GraphQLInputObjectType,
    GraphQLInputType,
    GraphQLInt,
    GraphQLList,
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLOutputType,
    GraphQLSchema,
    GraphQLString,
    GraphQLFieldResolver,
    valueFromASTUntyped,
    type FieldNode,
    type GraphQLFieldConfig,
    type GraphQLFieldConfigMap,
    type GraphQLFieldConfigArgumentMap,
    type GraphQLInputFieldConfigMap,
    type GraphQLResolveInfo,
    type SelectionNode,
    type SelectionSetNode,
} from 'graphql';

import { normalizeError } from './errors.js';
import { getExecutionClient, registerExecutionMetadata } from './execution.js';
import {
    getIdentifierFields,
    getPrimaryKeyFields,
    getProviderCapabilities,
    getUniqueFieldSets,
    isComparableScalar,
    isMutableField,
    isNumericScalar,
    normalizeSchema,
} from './metadata.js';
import { getScalarType, maybeWrapList } from './scalars.js';
import type {
    CreateZenStackGraphQLSchemaOptions,
    FeatureFlags,
    ModelDelegate,
    NamingConfig,
    NamingStrategy,
    NormalizedFieldDefinition,
    NormalizedModelDefinition,
    NormalizedProcedureDefinition,
    NormalizedProcedureParamDefinition,
    NormalizedSchema,
    NormalizedTypeDefDefinition,
    OrderByDirection,
    ProviderCapabilities,
    ResolverInvocation,
    RootFieldConfig,
    ScalarType,
    SchemaCrudOperation,
    SchemaFilterKind,
    SchemaSlicingConfig,
    ZenStackClientLike,
} from './types.js';

const ORDER_BY_ENUM = new GraphQLEnumType({
    name: 'order_by',
    values: {
        asc: { value: 'asc' },
        desc: { value: 'desc' },
        asc_nulls_first: { value: 'asc_nulls_first' },
        asc_nulls_last: { value: 'asc_nulls_last' },
        desc_nulls_first: { value: 'desc_nulls_first' },
        desc_nulls_last: { value: 'desc_nulls_last' },
    },
});

const QUERY_MODE_ENUM = new GraphQLEnumType({
    name: 'query_mode',
    values: {
        default: { value: 'default' },
        insensitive: { value: 'insensitive' },
    },
});

const DEFAULT_FEATURES: Required<FeatureFlags> = {
    aggregates: true,
    nestedArgs: true,
    computedFields: false,
    conflictClauses: true,
    subscriptions: false,
    exposeInternalFields: false,
};

function lowerCamelCase(value: string) {
    return value.charAt(0).toLowerCase() + value.slice(1);
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

function toHasuraCollectionName(model: NormalizedModelDefinition) {
    return pluralize(lowerCamelCase(model.dbName ?? model.name));
}

function resolveNamingStrategy(config?: NamingConfig): NamingStrategy {
    const defaults: NamingStrategy = {
        queryMany(model) {
            return toHasuraCollectionName(model);
        },
        queryByPk(model) {
            return `${toHasuraCollectionName(model)}_by_pk`;
        },
        queryAggregate(model) {
            return `${toHasuraCollectionName(model)}_aggregate`;
        },
        insertMany(model) {
            return `insert_${toHasuraCollectionName(model)}`;
        },
        insertOne(model) {
            return `insert_${toHasuraCollectionName(model)}_one`;
        },
        updateMany(model) {
            return `update_${toHasuraCollectionName(model)}`;
        },
        updateByPk(model) {
            return `update_${toHasuraCollectionName(model)}_by_pk`;
        },
        deleteMany(model) {
            return `delete_${toHasuraCollectionName(model)}`;
        },
        deleteByPk(model) {
            return `delete_${toHasuraCollectionName(model)}_by_pk`;
        },
        typeName(modelName) {
            return modelName;
        },
    };

    if (!config || config === 'hasura') {
        return defaults;
    }

    if (config === 'prisma') {
        return {
            ...defaults,
            queryMany(model) {
                return lowerCamelCase(model.name);
            },
            queryByPk(model) {
                return `${lowerCamelCase(model.name)}ByPk`;
            },
            queryAggregate(model) {
                return `${lowerCamelCase(model.name)}Aggregate`;
            },
            insertMany(model) {
                return `create${pluralize(model.name)}`;
            },
            insertOne(model) {
                return `create${model.name}`;
            },
            updateMany(model) {
                return `update${pluralize(model.name)}`;
            },
            updateByPk(model) {
                return `update${model.name}ByPk`;
            },
            deleteMany(model) {
                return `delete${pluralize(model.name)}`;
            },
            deleteByPk(model) {
                return `delete${model.name}ByPk`;
            },
        };
    }

    return { ...defaults, ...config };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOrderDirection(direction: OrderByDirection) {
    return direction.startsWith('desc') ? 'desc' : 'asc';
}

function compileOrderDirection(direction: OrderByDirection) {
    const sort = normalizeOrderDirection(direction);
    if (direction.endsWith('nulls_first')) {
        return {
            sort,
            nulls: 'first' as const,
        };
    }
    if (direction.endsWith('nulls_last')) {
        return {
            sort,
            nulls: 'last' as const,
        };
    }
    return sort;
}

function mergeInsensitive(
    target: Record<string, unknown>,
    key: string,
    value: unknown,
    insensitive = false
) {
    target[key] = value;
    if (insensitive) {
        target.mode = 'insensitive';
    }
}

function likePatternToFilter(pattern: string, insensitive = false) {
    const startsWithPercent = pattern.startsWith('%');
    const endsWithPercent = pattern.endsWith('%');
    const core = pattern.replace(/^%/, '').replace(/%$/, '');
    const filter: Record<string, unknown> = {};

    if (startsWithPercent && endsWithPercent) {
        mergeInsensitive(filter, 'contains', core, insensitive);
        return filter;
    }
    if (startsWithPercent) {
        mergeInsensitive(filter, 'endsWith', core, insensitive);
        return filter;
    }
    if (endsWithPercent) {
        mergeInsensitive(filter, 'startsWith', core, insensitive);
        return filter;
    }

    mergeInsensitive(filter, 'equals', core, insensitive);
    return filter;
}

function compareAggregateValues(left: unknown, right: unknown) {
    if (left === right) {
        return 0;
    }

    const normalize = (value: unknown) => {
        if (value instanceof Date) {
            return value.getTime();
        }
        if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') {
            return value;
        }
        if (typeof value === 'boolean') {
            return Number(value);
        }
        return String(value ?? '');
    };

    const leftValue = normalize(left);
    const rightValue = normalize(right);
    return leftValue > rightValue ? 1 : -1;
}

type AggregateCountRequest = {
    columns?: string[];
    distinct?: boolean;
};

type RootCrudOperation =
    | 'queryMany'
    | 'queryByPk'
    | 'aggregate'
    | 'insertMany'
    | 'insertOne'
    | 'updateMany'
    | 'updateByPk'
    | 'deleteMany'
    | 'deleteByPk';

type AggregatePlan = {
    wantsAggregate: boolean;
    wantsNodes: boolean;
    countRequests: AggregateCountRequest[];
    aggregate: {
        avg: string[];
        sum: string[];
        min: string[];
        max: string[];
    };
    nodeSelection: Record<string, unknown> | undefined;
};

class SchemaBuilder<TClient extends ZenStackClientLike, TContext> {
    private readonly normalizedSchema: NormalizedSchema;
    private readonly features: Required<FeatureFlags>;
    private readonly naming: NamingStrategy;
    private readonly slicing: SchemaSlicingConfig | undefined;
    private readonly providerCapabilities: ProviderCapabilities;
    private readonly objectTypes = new Map<string, GraphQLObjectType>();
    private readonly typeDefObjectTypes = new Map<string, GraphQLObjectType>();
    private readonly enumTypes = new Map<string, GraphQLEnumType>();
    private readonly typeDefInputTypes = new Map<string, GraphQLInputObjectType>();
    private readonly typeDefWhereInputs = new Map<string, GraphQLInputObjectType>();
    private readonly typeDefListWhereInputs = new Map<string, GraphQLInputObjectType>();
    private readonly selectColumnEnums = new Map<string, GraphQLEnumType>();
    private readonly comparisonInputs = new Map<string, GraphQLInputObjectType>();
    private readonly whereInputs = new Map<string, GraphQLInputObjectType>();
    private readonly orderInputs = new Map<string, GraphQLInputObjectType>();
    private readonly aggregateCountOrderInputs = new Map<string, GraphQLInputObjectType>();
    private readonly insertInputs = new Map<string, GraphQLInputObjectType>();
    private readonly relationInsertInputs = new Map<string, GraphQLInputObjectType>();
    private readonly relationUpdateInputs = new Map<string, GraphQLInputObjectType>();
    private readonly relationUpdateManyInputs = new Map<string, GraphQLInputObjectType>();
    private readonly scalarSetInputs = new Map<string, GraphQLInputObjectType>();
    private readonly setInputs = new Map<string, GraphQLInputObjectType>();
    private readonly incInputs = new Map<string, GraphQLInputObjectType>();
    private readonly nestedPatchInputs = new Map<string, GraphQLInputObjectType>();
    private readonly constraintEnums = new Map<string, GraphQLEnumType>();
    private readonly updateColumnEnums = new Map<string, GraphQLEnumType>();
    private readonly onConflictInputs = new Map<string, GraphQLInputObjectType>();
    private readonly mutationResponseTypes = new Map<string, GraphQLObjectType>();
    private readonly aggregateTypes = new Map<string, GraphQLObjectType>();
    private readonly aggregateFieldsTypes = new Map<string, GraphQLObjectType>();
    private readonly aggregateLeafTypes = new Map<string, GraphQLObjectType>();

    constructor(private readonly options: CreateZenStackGraphQLSchemaOptions<TClient, TContext>) {
        this.normalizedSchema = normalizeSchema(options.schema);
        this.features = { ...DEFAULT_FEATURES, ...options.features };
        this.naming = resolveNamingStrategy(options.naming);
        this.slicing = options.slicing;
        this.providerCapabilities = getProviderCapabilities(this.normalizedSchema);
    }

    private supportsInsensitiveMode() {
        return this.providerCapabilities.supportsInsensitiveMode;
    }

    private supportsDistinctOn() {
        return this.providerCapabilities.supportsDistinctOn;
    }

    private supportsJsonFilters() {
        return this.providerCapabilities.supportsJsonFilters;
    }

    private supportsJsonFilterMode() {
        return this.providerCapabilities.supportsJsonFilterMode;
    }

    private supportsScalarListFilters() {
        return this.providerCapabilities.supportsScalarListFilters;
    }

    private getConfiguredNames(names: string[] | undefined) {
        return new Set((names ?? []).filter((name): name is string => typeof name === 'string'));
    }

    private getModelConfigKeys(model: NormalizedModelDefinition) {
        const keys = new Set<string>([
            model.name,
            lowerCamelCase(model.name),
        ]);
        if (model.dbName) {
            keys.add(model.dbName);
            keys.add(lowerCamelCase(model.dbName));
        }
        return Array.from(keys);
    }

    private isModelIncluded(model: NormalizedModelDefinition) {
        const candidates = this.getModelConfigKeys(model);
        const included = this.getConfiguredNames(this.slicing?.includedModels);
        const excluded = this.getConfiguredNames(this.slicing?.excludedModels);

        if (candidates.some((candidate) => excluded.has(candidate))) {
            return false;
        }
        if (included.size > 0) {
            return candidates.some((candidate) => included.has(candidate));
        }
        return true;
    }

    private getModelSlice(model: NormalizedModelDefinition) {
        const allConfig = this.slicing?.models?.$all;
        const specific = this.getModelConfigKeys(model)
            .map((key) => this.slicing?.models?.[key])
            .find((value) => value !== undefined);
        const allFields = allConfig?.fields?.$all;
        const sharedFields = allConfig?.fields ?? {};
        const modelFieldAllConfig = specific?.fields?.$all;
        const modelFields = specific?.fields ?? {};

        return {
            includedOperations: [
                ...(allConfig?.includedOperations ?? []),
                ...(specific?.includedOperations ?? []),
            ],
            excludedOperations: [
                ...(allConfig?.excludedOperations ?? []),
                ...(specific?.excludedOperations ?? []),
            ],
            includedFields: [
                ...(allConfig?.includedFields ?? []),
                ...(specific?.includedFields ?? []),
            ],
            excludedFields: [
                ...(allConfig?.excludedFields ?? []),
                ...(specific?.excludedFields ?? []),
            ],
            fields: modelFields,
            allFieldConfig: allFields,
            allModelFields: sharedFields,
            modelFieldAllConfig,
        };
    }

    private normalizeOperationName(operation: SchemaCrudOperation): RootCrudOperation | undefined {
        switch (operation) {
            case 'findMany':
            case 'queryMany':
                return 'queryMany';
            case 'findUnique':
            case 'queryByPk':
                return 'queryByPk';
            case 'aggregate':
                return 'aggregate';
            case 'createMany':
            case 'insertMany':
                return 'insertMany';
            case 'create':
            case 'insertOne':
                return 'insertOne';
            case 'updateMany':
                return 'updateMany';
            case 'update':
            case 'updateByPk':
                return 'updateByPk';
            case 'deleteMany':
                return 'deleteMany';
            case 'delete':
            case 'deleteByPk':
                return 'deleteByPk';
            default:
                return undefined;
        }
    }

    private isOperationEnabled(model: NormalizedModelDefinition, operation: RootCrudOperation) {
        if (!this.isModelIncluded(model)) {
            return false;
        }

        const slice = this.getModelSlice(model);
        const excluded = new Set(
            slice.excludedOperations
                .map((entry) => this.normalizeOperationName(entry))
                .filter((entry): entry is RootCrudOperation => Boolean(entry))
        );
        if (excluded.has(operation)) {
            return false;
        }

        const included = slice.includedOperations
            .map((entry) => this.normalizeOperationName(entry))
            .filter((entry): entry is RootCrudOperation => Boolean(entry));
        if (included.length > 0) {
            return included.includes(operation);
        }

        return true;
    }

    private isProcedureIncluded(procedure: NormalizedProcedureDefinition) {
        const included = this.getConfiguredNames(this.slicing?.includedProcedures);
        const excluded = this.getConfiguredNames(this.slicing?.excludedProcedures);

        if (excluded.has(procedure.name)) {
            return false;
        }
        if (included.size > 0 && !included.has(procedure.name)) {
            return false;
        }
        if (procedure.returnKind === 'model') {
            const model = this.normalizedSchema.modelMap.get(procedure.returnType);
            if (model && !this.isModelIncluded(model)) {
                return false;
            }
        }

        return procedure.params.every((param) => {
            if (param.kind !== 'model') {
                return true;
            }
            const model = this.normalizedSchema.modelMap.get(param.type);
            return !model || this.isModelIncluded(model);
        });
    }

    private isFieldIncluded(model: NormalizedModelDefinition, field: NormalizedFieldDefinition) {
        const slice = this.getModelSlice(model);
        const excludedFields = new Set(
            slice.excludedFields.filter((entry): entry is string => typeof entry === 'string')
        );
        if (excludedFields.has(field.name)) {
            return false;
        }

        const includedFields = slice.includedFields.filter(
            (entry): entry is string => typeof entry === 'string'
        );
        if (includedFields.length > 0 && !includedFields.includes(field.name)) {
            return false;
        }

        if (field.kind === 'relation') {
            const relatedModel = this.normalizedSchema.modelMap.get(field.type);
            if (relatedModel && !this.isModelIncluded(relatedModel)) {
                return false;
            }
        }

        return true;
    }

    private getFieldFilterKinds(
        model: NormalizedModelDefinition,
        field: NormalizedFieldDefinition
    ) {
        const defaults = this.getDefaultFieldFilterKinds(field);
        const slice = this.getModelSlice(model);
        const specific =
            slice.fields[field.name] ??
            slice.modelFieldAllConfig ??
            slice.allModelFields[field.name] ??
            slice.allFieldConfig;

        const included = specific?.includedFilterKinds ?? [];
        const excluded = new Set(specific?.excludedFilterKinds ?? []);
        const allowed =
            included.length > 0
                ? defaults.filter((kind) => included.includes(kind))
                : defaults;
        return allowed.filter((kind) => !excluded.has(kind));
    }

    private getDefaultFieldFilterKinds(field: NormalizedFieldDefinition) {
        const defaults: SchemaFilterKind[] = ['Equality'];

        if (field.kind === 'relation') {
            defaults.push('Relation');
        }
        if (!field.isList && field.kind === 'scalar' && isComparableScalar(field.type)) {
            defaults.push('Range');
        }
        if (!field.isList && field.kind === 'scalar' && field.type === 'String') {
            defaults.push('Like');
        }
        if (field.kind === 'scalar' && field.type === 'Json' && this.supportsJsonFilters()) {
            defaults.push('Json');
        }
        if (field.isList && this.supportsScalarListFilters()) {
            defaults.push('List');
        }

        return defaults;
    }

    private getFieldFilterKindsKey(
        model: NormalizedModelDefinition,
        field: NormalizedFieldDefinition
    ) {
        const allowed = this.getFieldFilterKinds(model, field);
        const defaults = this.getDefaultFieldFilterKinds(field);
        const hasDefaultKinds =
            allowed.length === defaults.length &&
            allowed.every((kind, index) => defaults[index] === kind);
        return hasDefaultKinds
            ? `${field.type}${field.isList ? '_list' : ''}_comparison_exp`
            : `${this.naming.typeName(model.name)}_${field.name}_comparison_exp`;
    }

    createSchema() {
        const queryFields: GraphQLFieldConfigMap<unknown, TContext> = {};
        const mutationFields: GraphQLFieldConfigMap<unknown, TContext> = {};

        for (const model of this.normalizedSchema.models) {
            if (this.isOperationEnabled(model, 'queryMany')) {
                queryFields[this.naming.queryMany(model)] = {
                    type: new GraphQLNonNull(new GraphQLList(this.getModelObjectType(model))),
                    description: `List ${model.name} records`,
                    args: this.getCollectionArgs(model),
                    resolve: this.createResolver('query', model, async ({ client, args, info }) => {
                        const delegate = this.getRequiredDelegate(client, model);
                        const queryArgs = this.compileFindManyArgs(model, args, info);
                        this.assertMethod(delegate, 'findMany', model);
                        return delegate.findMany!(queryArgs);
                    }),
                };
            }

            if (getPrimaryKeyFields(model).length > 0 && this.isOperationEnabled(model, 'queryByPk')) {
                queryFields[this.naming.queryByPk(model)] = {
                    type: this.getModelObjectType(model),
                    description: `Fetch ${model.name} by primary key`,
                    args: this.getPrimaryKeyArgs(model),
                    resolve: this.createResolver('query', model, async ({ client, args, info }) => {
                        const delegate = this.getRequiredDelegate(client, model);
                        if (delegate.findUnique) {
                            return delegate.findUnique({
                                where: this.buildUniqueWhere(model, args),
                                select: this.buildSelection(model, info.fieldNodes, info),
                            });
                        }
                        this.assertMethod(delegate, 'findMany', model);
                        const rows = await delegate.findMany!({
                            where: this.buildUniqueWhere(model, args),
                            take: 1,
                            select: this.buildSelection(model, info.fieldNodes, info),
                        });
                        return rows[0] ?? null;
                    }),
                };
            }

            if (this.features.aggregates && this.isOperationEnabled(model, 'aggregate')) {
                queryFields[this.naming.queryAggregate(model)] = {
                    type: new GraphQLNonNull(this.getAggregateType(model)),
                    description: `Aggregate ${model.name} records`,
                    args: this.getCollectionArgs(model),
                    resolve: this.createResolver(
                        'aggregate',
                        model,
                        async ({ client, args, info }) => this.resolveAggregate(model, client, args, info)
                    ),
                };
            }

            if (this.isOperationEnabled(model, 'insertMany')) {
                mutationFields[this.naming.insertMany(model)] = {
                    type: new GraphQLNonNull(this.getMutationResponseType(model)),
                    args: {
                        objects: {
                            type: new GraphQLNonNull(
                                new GraphQLList(new GraphQLNonNull(this.getInsertInput(model)))
                            ),
                        },
                        ...(this.features.conflictClauses && this.getConflictConstraints(model).length > 0
                            ? {
                                  on_conflict: {
                                      type: this.getOnConflictInput(model),
                                  },
                              }
                            : {}),
                    },
                    resolve: this.createResolver(
                        'insertMany',
                        model,
                        async ({ client, args, info }) =>
                            this.resolveInsertMany(model, client, args, info)
                    ),
                };
            }

            if (this.isOperationEnabled(model, 'insertOne')) {
                mutationFields[this.naming.insertOne(model)] = {
                    type: this.getModelObjectType(model),
                    args: {
                        object: { type: new GraphQLNonNull(this.getInsertInput(model)) },
                        ...(this.features.conflictClauses && this.getConflictConstraints(model).length > 0
                            ? {
                                  on_conflict: {
                                      type: this.getOnConflictInput(model),
                                  },
                              }
                            : {}),
                    },
                    resolve: this.createResolver(
                        'insertOne',
                        model,
                        async ({ client, args, info }) => {
                            return this.resolveInsertOne(model, client, args, info);
                        }
                    ),
                };
            }

            if (this.isOperationEnabled(model, 'updateMany')) {
                mutationFields[this.naming.updateMany(model)] = {
                    type: new GraphQLNonNull(this.getMutationResponseType(model)),
                    args: {
                        where: { type: new GraphQLNonNull(this.getWhereInput(model)) },
                        _set: { type: this.getSetInput(model) },
                        _inc: { type: this.getIncInput(model) },
                    },
                    resolve: this.createResolver(
                        'updateMany',
                        model,
                        async ({ client, args, info }) =>
                            this.resolveUpdateMany(model, client, args, info)
                    ),
                };
            }

            if (getPrimaryKeyFields(model).length > 0) {
                if (this.isOperationEnabled(model, 'updateByPk')) {
                    mutationFields[this.naming.updateByPk(model)] = {
                        type: this.getModelObjectType(model),
                        args: {
                            ...this.getPrimaryKeyArgs(model),
                            _set: { type: this.getSetInput(model) },
                            _inc: { type: this.getIncInput(model) },
                        },
                        resolve: this.createResolver(
                            'updateByPk',
                            model,
                            async ({ client, args, info }) =>
                                this.resolveUpdateByPk(model, client, args, info)
                        ),
                    };
                }

                if (this.isOperationEnabled(model, 'deleteByPk')) {
                    mutationFields[this.naming.deleteByPk(model)] = {
                        type: this.getModelObjectType(model),
                        args: this.getPrimaryKeyArgs(model),
                        resolve: this.createResolver(
                            'deleteByPk',
                            model,
                            async ({ client, args, info }) =>
                                this.resolveDeleteByPk(model, client, args, info)
                        ),
                    };
                }
            }

            if (this.isOperationEnabled(model, 'deleteMany')) {
                mutationFields[this.naming.deleteMany(model)] = {
                    type: new GraphQLNonNull(this.getMutationResponseType(model)),
                    args: {
                        where: { type: new GraphQLNonNull(this.getWhereInput(model)) },
                    },
                    resolve: this.createResolver(
                        'deleteMany',
                        model,
                        async ({ client, args, info }) =>
                            this.resolveDeleteMany(model, client, args, info)
                    ),
                };
            }
        }

        for (const procedure of this.normalizedSchema.procedures) {
            if (!this.isProcedureIncluded(procedure)) {
                continue;
            }
            const target = procedure.mutation ? mutationFields : queryFields;
            if (target[procedure.name]) {
                throw new Error(
                    `Duplicate ${procedure.mutation ? 'mutation' : 'query'} root field "${procedure.name}"`
                );
            }
            target[procedure.name] = this.getProcedureFieldConfig(procedure);
        }

        this.assignRootFields(queryFields, this.options.extensions?.query, 'query');
        this.assignRootFields(mutationFields, this.options.extensions?.mutation, 'mutation');

        if (Object.keys(queryFields).length === 0) {
            throw new Error('Schema pruning removed all query root fields');
        }

        const schema = new GraphQLSchema({
            query: new GraphQLObjectType({
                name: 'Query',
                fields: () => queryFields,
            }),
            mutation:
                Object.keys(mutationFields).length > 0
                    ? new GraphQLObjectType({
                          name: 'Mutation',
                          fields: () => mutationFields,
                      })
                    : undefined,
        });

        registerExecutionMetadata(schema, {
            getClient: this.options.getClient,
        });

        return schema;
    }

    private getProcedureOutputType(procedure: NormalizedProcedureDefinition): GraphQLOutputType {
        const baseType = this.getNamedOutputType(procedure.returnType);
        if (procedure.returnArray) {
            return new GraphQLList(new GraphQLNonNull(baseType));
        }
        return baseType;
    }

    private getProcedureArgumentType(param: NormalizedProcedureParamDefinition): GraphQLInputType {
        const baseType = this.getNamedInputType(param.type);
        return maybeWrapList(baseType, param.isList, param.isNullable) as GraphQLInputType;
    }

    private getProcedureArgs(
        procedure: NormalizedProcedureDefinition
    ): GraphQLFieldConfigArgumentMap {
        return Object.fromEntries(
            procedure.params.map((param) => [
                param.name,
                {
                    type: this.getProcedureArgumentType(param),
                },
            ])
        );
    }

    private getProcedureFieldConfig(
        procedure: NormalizedProcedureDefinition
    ): GraphQLFieldConfig<unknown, TContext> {
        return {
            type: this.getProcedureOutputType(procedure),
            description: procedure.description,
            args: this.getProcedureArgs(procedure),
            resolve: this.createResolver(
                procedure.mutation ? 'procedureMutation' : 'procedureQuery',
                undefined,
                async ({ client, args }) => {
                    const procedureMap = client.$procs;
                    const handler = procedureMap?.[procedure.name] as
                        | ((input?: { args?: Record<string, unknown> }) => Promise<unknown>)
                        | undefined;
                    if (typeof handler !== 'function') {
                        throw new Error(`Missing procedure implementation for "${procedure.name}"`);
                    }
                    return handler({ args });
                }
            ),
        };
    }

    private getModel(modelName: string) {
        const model = this.normalizedSchema.modelMap.get(modelName);
        if (!model) {
            throw new Error(`Unknown model "${modelName}"`);
        }
        return model;
    }

    private getTypeDef(typeDefName: string) {
        const typeDef = this.normalizedSchema.typeDefMap.get(typeDefName);
        if (!typeDef) {
            throw new Error(`Unknown type definition "${typeDefName}"`);
        }
        return typeDef;
    }

    private assignRootFields(
        target: GraphQLFieldConfigMap<unknown, TContext>,
        additions: Record<string, RootFieldConfig<TClient, TContext>> | undefined,
        rootKind: 'query' | 'mutation'
    ) {
        if (!additions) {
            return;
        }

        for (const [fieldName, config] of Object.entries(additions)) {
            if (target[fieldName]) {
                throw new Error(`Duplicate ${rootKind} root field "${fieldName}"`);
            }
            const { resolve, ...rest } = config;
            target[fieldName] = {
                ...rest,
                resolve: resolve
                    ? async (source, args, context, info) => {
                          const client =
                              getExecutionClient<TClient>() ??
                              ((await this.options.getClient(context)) as TClient);
                          return resolve(source, args, context, info, { client });
                      }
                    : undefined,
            };
        }
    }

    private getVisibleFields(model: NormalizedModelDefinition) {
        return model.fields.filter((field) => {
            if (!this.features.exposeInternalFields && field.isInternal) {
                return false;
            }
            if (!this.features.computedFields && field.isComputed) {
                return false;
            }
            if (!this.isFieldIncluded(model, field)) {
                return false;
            }
            return true;
        });
    }

    private getMutableFields(model: NormalizedModelDefinition) {
        return this.getVisibleFields(model).filter((field) =>
            isMutableField(field, this.features.exposeInternalFields)
        );
    }

    private getVisibleScalarFields(model: NormalizedModelDefinition) {
        return this.getVisibleFields(model).filter(
            (field) => field.kind === 'scalar' || field.kind === 'enum'
        );
    }

    private getEnumType(name: string) {
        const existing = this.enumTypes.get(name);
        if (existing) {
            return existing;
        }

        const enumDefinition = this.normalizedSchema.enumMap.get(name);
        if (!enumDefinition) {
            throw new Error(`Unknown enum "${name}"`);
        }

        const enumType = new GraphQLEnumType({
            name,
            description: enumDefinition.description,
            values: Object.fromEntries(
                enumDefinition.values.map((value) => [value, { value }])
            ),
        });
        this.enumTypes.set(name, enumType);
        return enumType;
    }

    private getSelectColumnEnum(model: NormalizedModelDefinition) {
        const existing = this.selectColumnEnums.get(model.name);
        if (existing) {
            return existing;
        }

        const enumType = new GraphQLEnumType({
            name: `${this.naming.typeName(model.name)}_select_column`,
            values: Object.fromEntries(
                this.getVisibleScalarFields(model).map((field) => [field.name, { value: field.name }])
            ),
        });

        this.selectColumnEnums.set(model.name, enumType);
        return enumType;
    }

    private getDistinctOnArg(model: NormalizedModelDefinition) {
        return {
            type: new GraphQLList(new GraphQLNonNull(this.getSelectColumnEnum(model))),
        };
    }

    private getCollectionArgs(model: NormalizedModelDefinition): GraphQLFieldConfigArgumentMap {
        return {
            where: { type: this.getWhereInput(model) },
            order_by: { type: new GraphQLList(this.getOrderByInput(model)) },
            ...(this.supportsDistinctOn()
                ? {
                      distinct_on: this.getDistinctOnArg(model),
                  }
                : {}),
            limit: { type: GraphQLInt },
            offset: { type: GraphQLInt },
        };
    }

    private getAggregateCountArgs(model: NormalizedModelDefinition): GraphQLFieldConfigArgumentMap {
        return {
            columns: {
                type: new GraphQLList(new GraphQLNonNull(this.getSelectColumnEnum(model))),
            },
            distinct: {
                type: GraphQLBoolean,
            },
        };
    }

    private getNamedOutputType(typeName: string): GraphQLOutputType {
        if (this.normalizedSchema.enumMap.has(typeName)) {
            return this.getEnumType(typeName);
        }
        if (this.normalizedSchema.modelMap.has(typeName)) {
            return this.getModelObjectType(this.getModel(typeName));
        }
        if (this.normalizedSchema.typeDefMap.has(typeName)) {
            return this.getTypeDefObjectType(this.getTypeDef(typeName));
        }
        return getScalarType(typeName as ScalarType, this.options.scalars);
    }

    private getNamedInputType(typeName: string): GraphQLInputType {
        if (this.normalizedSchema.enumMap.has(typeName)) {
            return this.getEnumType(typeName);
        }
        if (this.normalizedSchema.modelMap.has(typeName)) {
            return this.getInsertInput(this.getModel(typeName));
        }
        if (this.normalizedSchema.typeDefMap.has(typeName)) {
            return this.getTypeDefInputType(this.getTypeDef(typeName));
        }
        return getScalarType(typeName as ScalarType, this.options.scalars);
    }

    private getFieldOutputType(field: NormalizedFieldDefinition): GraphQLOutputType {
        if (field.kind === 'relation') {
            const relatedModel = this.getModel(field.type);
            return maybeWrapList(
                this.getModelObjectType(relatedModel),
                field.isList,
                field.isNullable
            ) as GraphQLOutputType;
        }

        if (field.kind === 'typeDef') {
            return maybeWrapList(
                this.getTypeDefObjectType(this.getTypeDef(field.type)),
                field.isList,
                field.isNullable
            ) as GraphQLOutputType;
        }

        if (field.kind === 'enum') {
            return maybeWrapList(
                this.getEnumType(field.type),
                field.isList,
                field.isNullable
            ) as GraphQLOutputType;
        }

        return maybeWrapList(
            getScalarType(field.type as ScalarType, this.options.scalars),
            field.isList,
            field.isNullable
        ) as GraphQLOutputType;
    }

    private getFieldInputType(
        field: NormalizedFieldDefinition,
        forceNullable = false
    ): GraphQLInputType {
        if (field.kind === 'relation') {
            return maybeWrapList(
                this.getInsertInput(this.getModel(field.type)),
                field.isList,
                forceNullable ? true : field.isNullable
            ) as GraphQLInputType;
        }

        if (field.kind === 'typeDef') {
            return maybeWrapList(
                this.getTypeDefInputType(this.getTypeDef(field.type)),
                field.isList,
                forceNullable ? true : field.isNullable
            ) as GraphQLInputType;
        }

        const baseType =
            field.kind === 'enum'
                ? this.getEnumType(field.type)
                : getScalarType(field.type as ScalarType, this.options.scalars);
        return maybeWrapList(
            baseType as GraphQLInputType,
            field.isList,
            forceNullable ? true : field.isNullable
        ) as GraphQLInputType;
    }

    private getComparatorInput(
        model: NormalizedModelDefinition,
        field: NormalizedFieldDefinition
    ) {
        const filterKinds = this.getFieldFilterKinds(model, field);
        const typeName = this.getFieldFilterKindsKey(model, field);
        const key = `${typeName}:${field.kind}:${field.type}:${field.isList ? 'list' : 'single'}:${filterKinds.join(',')}`;
        const existing = this.comparisonInputs.get(key);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: typeName,
            fields: () => {
                const scalarType =
                    field.kind === 'enum'
                        ? this.getEnumType(field.type)
                        : getScalarType(field.type as ScalarType, this.options.scalars);
                const baseType =
                    field.isList
                        ? new GraphQLList(new GraphQLNonNull(scalarType))
                        : scalarType;
                const fields: GraphQLInputFieldConfigMap = {
                    ...(filterKinds.includes('Equality')
                        ? {
                              _eq: { type: baseType },
                              _neq: { type: baseType },
                              _in: { type: new GraphQLList(new GraphQLNonNull(baseType)) },
                              _nin: { type: new GraphQLList(new GraphQLNonNull(baseType)) },
                              _is_null: { type: getScalarType('Boolean', this.options.scalars) },
                              ...(field.kind === 'scalar' && field.type === 'Json'
                                  ? {
                                        equals: {
                                            type: getScalarType('Json', this.options.scalars),
                                        },
                                        not: {
                                            type: getScalarType('Json', this.options.scalars),
                                        },
                                    }
                                  : {}),
                          }
                        : {}),
                };

                if (
                    filterKinds.includes('Range') &&
                    !field.isList &&
                    field.kind === 'scalar' &&
                    isComparableScalar(field.type)
                ) {
                    fields._gt = { type: baseType };
                    fields._gte = { type: baseType };
                    fields._lt = { type: baseType };
                    fields._lte = { type: baseType };
                    fields._between = {
                        type: new GraphQLList(new GraphQLNonNull(baseType)),
                    };
                }

                if (
                    filterKinds.includes('Json') &&
                    field.kind === 'scalar' &&
                    field.type === 'Json' &&
                    this.supportsJsonFilters()
                ) {
                    fields.path = { type: GraphQLString };
                    fields.string_contains = { type: GraphQLString };
                    fields.string_starts_with = { type: GraphQLString };
                    fields.string_ends_with = { type: GraphQLString };
                    fields.array_contains = { type: getScalarType('Json', this.options.scalars) };
                    fields.array_starts_with = { type: getScalarType('Json', this.options.scalars) };
                    fields.array_ends_with = { type: getScalarType('Json', this.options.scalars) };
                    if (this.supportsJsonFilterMode()) {
                        fields.mode = { type: QUERY_MODE_ENUM };
                    }
                }

                if (filterKinds.includes('List') && field.isList && this.supportsScalarListFilters()) {
                    fields.has = { type: scalarType };
                    fields.hasEvery = {
                        type: new GraphQLList(new GraphQLNonNull(scalarType)),
                    };
                    fields.hasSome = {
                        type: new GraphQLList(new GraphQLNonNull(scalarType)),
                    };
                    fields.isEmpty = { type: getScalarType('Boolean', this.options.scalars) };
                }

                if (
                    filterKinds.includes('Like') &&
                    !field.isList &&
                    field.kind === 'scalar' &&
                    field.type === 'String'
                ) {
                    fields._contains = { type: GraphQLString };
                    fields._ncontains = { type: GraphQLString };
                    fields._icontains = { type: GraphQLString };
                    fields._nicontains = { type: GraphQLString };
                    fields._starts_with = { type: GraphQLString };
                    fields._nstarts_with = { type: GraphQLString };
                    fields._istarts_with = { type: GraphQLString };
                    fields._nistarts_with = { type: GraphQLString };
                    fields._ends_with = { type: GraphQLString };
                    fields._nends_with = { type: GraphQLString };
                    fields._iends_with = { type: GraphQLString };
                    fields._niends_with = { type: GraphQLString };
                    fields._like = { type: GraphQLString };
                    fields._nlike = { type: GraphQLString };
                    fields._ilike = { type: GraphQLString };
                    fields._nilike = { type: GraphQLString };
                }

                return fields;
            },
        });

        this.comparisonInputs.set(key, input);
        return input;
    }

    private getTypeDefComparatorInput(
        typeDef: NormalizedTypeDefDefinition,
        field: NormalizedFieldDefinition
    ) {
        const filterKinds = this.getDefaultFieldFilterKinds(field);
        const typeName = `${typeDef.name}_${field.name}_comparison_exp`;
        const key = `${typeName}:${field.kind}:${field.type}:${field.isList ? 'list' : 'single'}:${filterKinds.join(',')}`;
        const existing = this.comparisonInputs.get(key);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: typeName,
            fields: () => {
                const scalarType =
                    field.kind === 'enum'
                        ? this.getEnumType(field.type)
                        : getScalarType(field.type as ScalarType, this.options.scalars);
                const baseType = field.isList
                    ? new GraphQLList(new GraphQLNonNull(scalarType))
                    : scalarType;
                const fields: GraphQLInputFieldConfigMap = {
                    _eq: { type: baseType },
                    _neq: { type: baseType },
                    _in: { type: new GraphQLList(new GraphQLNonNull(baseType)) },
                    _nin: { type: new GraphQLList(new GraphQLNonNull(baseType)) },
                    _is_null: { type: getScalarType('Boolean', this.options.scalars) },
                };

                if (!field.isList && field.kind === 'scalar' && isComparableScalar(field.type)) {
                    fields._gt = { type: baseType };
                    fields._gte = { type: baseType };
                    fields._lt = { type: baseType };
                    fields._lte = { type: baseType };
                    fields._between = {
                        type: new GraphQLList(new GraphQLNonNull(baseType)),
                    };
                }

                if (!field.isList && field.kind === 'scalar' && field.type === 'String') {
                    fields._contains = { type: GraphQLString };
                    fields._ncontains = { type: GraphQLString };
                    fields._icontains = { type: GraphQLString };
                    fields._nicontains = { type: GraphQLString };
                    fields._starts_with = { type: GraphQLString };
                    fields._nstarts_with = { type: GraphQLString };
                    fields._istarts_with = { type: GraphQLString };
                    fields._nistarts_with = { type: GraphQLString };
                    fields._ends_with = { type: GraphQLString };
                    fields._nends_with = { type: GraphQLString };
                    fields._iends_with = { type: GraphQLString };
                    fields._niends_with = { type: GraphQLString };
                    fields._like = { type: GraphQLString };
                    fields._nlike = { type: GraphQLString };
                    fields._ilike = { type: GraphQLString };
                    fields._nilike = { type: GraphQLString };
                }

                return fields;
            },
        });

        this.comparisonInputs.set(key, input);
        return input;
    }

    private getWhereInput(model: NormalizedModelDefinition) {
        const existing = this.whereInputs.get(model.name);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: `${this.naming.typeName(model.name)}_bool_exp`,
            fields: () => {
                const fields: GraphQLInputFieldConfigMap = {
                    _and: { type: new GraphQLList(new GraphQLNonNull(input)) },
                    _or: { type: new GraphQLList(new GraphQLNonNull(input)) },
                    _not: { type: input },
                };

                for (const field of this.getVisibleFields(model)) {
                    if (field.kind === 'relation') {
                        if (!this.getFieldFilterKinds(model, field).includes('Relation')) {
                            continue;
                        }
                        fields[field.name] = { type: this.getWhereInput(this.getModel(field.type)) };
                        if (field.isList) {
                            fields[`${field.name}_some`] = {
                                type: this.getWhereInput(this.getModel(field.type)),
                            };
                            fields[`${field.name}_every`] = {
                                type: this.getWhereInput(this.getModel(field.type)),
                            };
                            fields[`${field.name}_none`] = {
                                type: this.getWhereInput(this.getModel(field.type)),
                            };
                        }
                    } else if (field.kind === 'typeDef') {
                        fields[field.name] = {
                            type: field.isList
                                ? this.getTypeDefListWhereInput(this.getTypeDef(field.type))
                                : this.getTypeDefWhereInput(this.getTypeDef(field.type)),
                        };
                    } else {
                        const filterKinds = this.getFieldFilterKinds(model, field);
                        if (filterKinds.length === 0) {
                            continue;
                        }
                        fields[field.name] = { type: this.getComparatorInput(model, field) };
                    }
                }

                return fields;
            },
        });

        this.whereInputs.set(model.name, input);
        return input;
    }

    private getTypeDefListWhereInput(typeDef: NormalizedTypeDefDefinition) {
        const existing = this.typeDefListWhereInputs.get(typeDef.name);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: `${typeDef.name}_list_bool_exp`,
            fields: () => ({
                some: { type: this.getTypeDefWhereInput(typeDef) },
                every: { type: this.getTypeDefWhereInput(typeDef) },
                none: { type: this.getTypeDefWhereInput(typeDef) },
            }),
        });

        this.typeDefListWhereInputs.set(typeDef.name, input);
        return input;
    }

    private getTypeDefWhereInput(typeDef: NormalizedTypeDefDefinition) {
        const existing = this.typeDefWhereInputs.get(typeDef.name);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: `${typeDef.name}_bool_exp`,
            fields: () => {
                const fields: GraphQLInputFieldConfigMap = {
                    _and: { type: new GraphQLList(new GraphQLNonNull(input)) },
                    _or: { type: new GraphQLList(new GraphQLNonNull(input)) },
                    _not: { type: input },
                };

                for (const field of typeDef.fields) {
                    if (field.kind === 'typeDef') {
                        fields[field.name] = {
                            type: field.isList
                                ? this.getTypeDefListWhereInput(this.getTypeDef(field.type))
                                : this.getTypeDefWhereInput(this.getTypeDef(field.type)),
                        };
                        continue;
                    }

                    if (field.kind === 'relation') {
                        continue;
                    }

                    fields[field.name] = {
                        type: this.getTypeDefComparatorInput(typeDef, field),
                    };
                }

                return fields;
            },
        });

        this.typeDefWhereInputs.set(typeDef.name, input);
        return input;
    }

    private getOrderByInput(model: NormalizedModelDefinition) {
        const existing = this.orderInputs.get(model.name);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: `${this.naming.typeName(model.name)}_order_by`,
            fields: () => {
                const fields: GraphQLInputFieldConfigMap = {};
                for (const field of this.getVisibleFields(model)) {
                    if (field.kind === 'relation') {
                        if (field.isList) {
                            fields[`${field.name}_aggregate`] = {
                                type: this.getAggregateCountOrderByInput(model, field),
                            };
                        } else {
                            fields[field.name] = {
                                type: this.getOrderByInput(this.getModel(field.type)),
                            };
                        }
                    } else {
                        fields[field.name] = { type: ORDER_BY_ENUM };
                    }
                }
                return fields;
            },
        });

        this.orderInputs.set(model.name, input);
        return input;
    }

    private getAggregateCountOrderByInput(
        model: NormalizedModelDefinition,
        relationField: NormalizedFieldDefinition
    ) {
        const key = `${model.name}:${relationField.name}`;
        const existing = this.aggregateCountOrderInputs.get(key);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: `${this.naming.typeName(model.name)}_${relationField.name}_aggregate_order_by`,
            fields: () => ({
                count: { type: ORDER_BY_ENUM },
            }),
        });

        this.aggregateCountOrderInputs.set(key, input);
        return input;
    }

    private getInsertInput(model: NormalizedModelDefinition) {
        const existing = this.insertInputs.get(model.name);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: `${this.naming.typeName(model.name)}_insert_input`,
            fields: () => this.getInsertInputFields(model),
        });

        this.insertInputs.set(model.name, input);
        return input;
    }

    private getSetInput(model: NormalizedModelDefinition) {
        const existing = this.setInputs.get(model.name);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: `${this.naming.typeName(model.name)}_set_input`,
            fields: () => this.getUpdateInputFields(model),
        });

        this.setInputs.set(model.name, input);
        return input;
    }

    private getIncInput(model: NormalizedModelDefinition) {
        const existing = this.incInputs.get(model.name);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: `${this.naming.typeName(model.name)}_inc_input`,
            fields: () => {
                const fields: GraphQLInputFieldConfigMap = {};
                for (const field of this.getMutableFields(model)) {
                    if (field.kind === 'scalar' && isNumericScalar(field.type)) {
                        fields[field.name] = {
                            type: getScalarType(field.type as ScalarType, this.options.scalars),
                        };
                    }
                }
                return fields;
            },
        });

        this.incInputs.set(model.name, input);
        return input;
    }

    private getConflictConstraints(model: NormalizedModelDefinition) {
        const constraints: Array<{ name: string; fields: string[] }> = [];

        if (model.primaryKey.length > 0) {
            constraints.push({
                name: `${this.naming.typeName(model.name)}_pkey`,
                fields: model.primaryKey,
            });
        }

        for (const constraint of model.uniqueConstraints) {
            const name =
                constraint.name ??
                `${this.naming.typeName(model.name)}_${constraint.fields.join('_')}_key`;
            constraints.push({
                name,
                fields: constraint.fields,
            });
        }

        const seen = new Set<string>();
        return constraints.filter((constraint) => {
            const key = `${constraint.name}:${constraint.fields.join('|')}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    private getConstraintEnum(model: NormalizedModelDefinition) {
        const existing = this.constraintEnums.get(model.name);
        if (existing) {
            return existing;
        }

        const enumType = new GraphQLEnumType({
            name: `${this.naming.typeName(model.name)}_constraint`,
            values: Object.fromEntries(
                this.getConflictConstraints(model).map((constraint) => [
                    constraint.name,
                    { value: constraint.name },
                ])
            ),
        });

        this.constraintEnums.set(model.name, enumType);
        return enumType;
    }

    private getUpdateColumnEnum(model: NormalizedModelDefinition) {
        const existing = this.updateColumnEnums.get(model.name);
        if (existing) {
            return existing;
        }

        const enumType = new GraphQLEnumType({
            name: `${this.naming.typeName(model.name)}_update_column`,
            values: Object.fromEntries(
                this.getMutableFields(model)
                    .filter((field) => field.kind !== 'relation' && !field.isId)
                    .map((field) => [field.name, { value: field.name }])
            ),
        });

        this.updateColumnEnums.set(model.name, enumType);
        return enumType;
    }

    private getOnConflictInput(model: NormalizedModelDefinition) {
        const existing = this.onConflictInputs.get(model.name);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: `${this.naming.typeName(model.name)}_on_conflict`,
            fields: () => ({
                constraint: {
                    type: new GraphQLNonNull(this.getConstraintEnum(model)),
                },
                update_columns: {
                    type: new GraphQLNonNull(
                        new GraphQLList(new GraphQLNonNull(this.getUpdateColumnEnum(model)))
                    ),
                },
            }),
        });

        this.onConflictInputs.set(model.name, input);
        return input;
    }

    private getRelationInsertInput(
        model: NormalizedModelDefinition,
        relationField: NormalizedFieldDefinition
    ) {
        const relatedModel = this.getModel(relationField.type);
        if (!this.isOperationEnabled(relatedModel, 'insertOne')) {
            return undefined;
        }

        const key = `${model.name}:${relationField.name}`;
        const existing = this.relationInsertInputs.get(key);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: `${this.naming.typeName(model.name)}_${relationField.name}_rel_insert_input`,
            fields: () => ({
                data: {
                    type: relationField.isList
                        ? new GraphQLNonNull(
                              new GraphQLList(new GraphQLNonNull(this.getInsertInput(relatedModel)))
                          )
                        : new GraphQLNonNull(this.getInsertInput(relatedModel)),
                },
            }),
        });

        this.relationInsertInputs.set(key, input);
        return input;
    }

    private getNestedPatchInput(model: NormalizedModelDefinition) {
        const existing = this.nestedPatchInputs.get(model.name);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: `${this.naming.typeName(model.name)}_nested_update_input`,
            fields: () => ({
                _set: { type: this.getScalarSetInputObject(model) },
                _inc: { type: this.getIncInput(model) },
            }),
        });

        this.nestedPatchInputs.set(model.name, input);
        return input;
    }

    private getRelationUpdateManyInput(relatedModel: NormalizedModelDefinition) {
        const existing = this.relationUpdateManyInputs.get(relatedModel.name);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: `${this.naming.typeName(relatedModel.name)}_rel_update_many_input`,
            fields: () => ({
                where: { type: new GraphQLNonNull(this.getWhereInput(relatedModel)) },
                _set: { type: this.getScalarSetInputObject(relatedModel) },
                _inc: { type: this.getIncInput(relatedModel) },
            }),
        });

        this.relationUpdateManyInputs.set(relatedModel.name, input);
        return input;
    }

    private getRelationUpdateInput(
        model: NormalizedModelDefinition,
        relationField: NormalizedFieldDefinition
    ) {
        const relatedModel = this.getModel(relationField.type);
        const supportsCreate = this.isOperationEnabled(relatedModel, 'insertOne');
        const supportsUpdateMany = relationField.isList
            ? this.isOperationEnabled(relatedModel, 'updateMany')
            : false;
        const supportsUpdateOne = !relationField.isList
            ? this.isOperationEnabled(relatedModel, 'updateByPk')
            : false;
        if (!supportsCreate && !supportsUpdateMany && !supportsUpdateOne) {
            return undefined;
        }

        const key = `${model.name}:${relationField.name}`;
        const existing = this.relationUpdateInputs.get(key);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: `${this.naming.typeName(model.name)}_${relationField.name}_rel_update_input`,
            fields: () => {
                const fields: GraphQLInputFieldConfigMap = {};

                if (supportsCreate) {
                    fields.create = {
                        type: relationField.isList
                            ? new GraphQLList(new GraphQLNonNull(this.getInsertInput(relatedModel)))
                            : this.getInsertInput(relatedModel),
                    };
                }

                if (relationField.isList && supportsUpdateMany) {
                    fields.update_many = {
                        type: new GraphQLList(
                            new GraphQLNonNull(this.getRelationUpdateManyInput(relatedModel))
                        ),
                    };
                } else if (!relationField.isList && supportsUpdateOne) {
                    fields.update = {
                        type: this.getNestedPatchInput(relatedModel),
                    };
                }

                return fields;
            },
        });

        this.relationUpdateInputs.set(key, input);
        return input;
    }

    private getInsertInputFields(model: NormalizedModelDefinition) {
        const fields = this.getMutableInputFields(model);
        for (const field of this.getVisibleFields(model)) {
            if (field.kind !== 'relation') {
                continue;
            }

            const relationInput = this.getRelationInsertInput(model, field);
            if (!relationInput) {
                continue;
            }
            fields[field.name] = {
                type: relationInput,
                description: field.description,
            };
        }
        return fields;
    }

    private getScalarSetInputFields(model: NormalizedModelDefinition) {
        const fields: GraphQLInputFieldConfigMap = {};
        for (const field of this.getMutableFields(model)) {
            fields[field.name] = {
                type: this.getFieldInputType(field, true),
                description: field.description,
            };
        }
        return fields;
    }

    private getScalarSetInputObject(model: NormalizedModelDefinition) {
        const existing = this.scalarSetInputs.get(model.name);
        if (existing) {
            return existing;
        }

        const input = new GraphQLInputObjectType({
            name: `${this.naming.typeName(model.name)}_scalar_set_input`,
            fields: () => this.getScalarSetInputFields(model),
        });

        this.scalarSetInputs.set(model.name, input);
        return input;
    }

    private getUpdateInputFields(model: NormalizedModelDefinition) {
        const fields = this.getScalarSetInputFields(model);
        for (const field of this.getVisibleFields(model)) {
            if (field.kind !== 'relation') {
                continue;
            }

            const relationInput = this.getRelationUpdateInput(model, field);
            if (!relationInput) {
                continue;
            }
            fields[field.name] = {
                type: relationInput,
                description: field.description,
            };
        }
        return fields;
    }

    private getMutableInputFields(model: NormalizedModelDefinition) {
        return this.getScalarSetInputFields(model);
    }

    private getPrimaryKeyArgs(model: NormalizedModelDefinition): GraphQLFieldConfigArgumentMap {
        const args: GraphQLFieldConfigArgumentMap = {};
        for (const fieldName of getPrimaryKeyFields(model)) {
            const field = model.fieldMap.get(fieldName);
            if (!field) {
                continue;
            }
            const baseType =
                field.kind === 'enum'
                    ? this.getEnumType(field.type)
                    : getScalarType(field.type as ScalarType, this.options.scalars);
            args[fieldName] = {
                type: new GraphQLNonNull(baseType),
            };
        }
        return args;
    }

    private getIdentitySelection(model: NormalizedModelDefinition) {
        return Object.fromEntries(
            Array.from(new Set(getUniqueFieldSets(model).flat())).map((fieldName) => [fieldName, true])
        );
    }

    private getModelObjectType(model: NormalizedModelDefinition) {
        const existing = this.objectTypes.get(model.name);
        if (existing) {
            return existing;
        }

        const objectType = new GraphQLObjectType({
            name: this.naming.typeName(model.name),
            description: model.description,
            fields: () => {
                const fields: GraphQLFieldConfigMap<Record<string, unknown>, TContext> = {};
                for (const field of this.getVisibleFields(model)) {
                    const config: GraphQLFieldConfig<Record<string, unknown>, TContext> = {
                        type: this.getFieldOutputType(field),
                        description: field.description,
                    };

                    if (field.kind === 'relation') {
                        const relatedModel = this.getModel(field.type);
                        if (this.features.nestedArgs && field.isList) {
                            config.args = this.getCollectionArgs(relatedModel);
                        }
                        config.resolve = this.createRelationResolver(model, field);

                        if (
                            field.isList &&
                            this.features.aggregates &&
                            this.isOperationEnabled(relatedModel, 'aggregate')
                        ) {
                            fields[`${field.name}_aggregate`] = {
                                type: new GraphQLNonNull(this.getAggregateType(relatedModel)),
                                args: this.getCollectionArgs(relatedModel),
                                resolve: this.createRelationAggregateResolver(model, field),
                            };
                        }
                    }

                    fields[field.name] = config;
                }
                return fields;
            },
        });

        this.objectTypes.set(model.name, objectType);
        return objectType;
    }

    private getTypeDefObjectType(typeDef: NormalizedTypeDefDefinition) {
        const existing = this.typeDefObjectTypes.get(typeDef.name);
        if (existing) {
            return existing;
        }

        const objectType = new GraphQLObjectType({
            name: typeDef.name,
            description: typeDef.description,
            fields: () => {
                const fields: GraphQLFieldConfigMap<unknown, TContext> = {};
                for (const field of typeDef.fields) {
                    if (field.kind === 'relation') {
                        const relatedModel = this.normalizedSchema.modelMap.get(field.type);
                        if (relatedModel && !this.isModelIncluded(relatedModel)) {
                            continue;
                        }
                    }
                    fields[field.name] = {
                        type: this.getFieldOutputType(field),
                        description: field.description,
                    };
                }
                return fields;
            },
        });

        this.typeDefObjectTypes.set(typeDef.name, objectType);
        return objectType;
    }

    private getTypeDefInputType(typeDef: NormalizedTypeDefDefinition) {
        const existing = this.typeDefInputTypes.get(typeDef.name);
        if (existing) {
            return existing;
        }

        const inputType = new GraphQLInputObjectType({
            name: `${typeDef.name}_input`,
            description: typeDef.description,
            fields: () => {
                const fields: GraphQLInputFieldConfigMap = {};
                for (const field of typeDef.fields) {
                    if (field.kind === 'relation') {
                        const relatedModel = this.normalizedSchema.modelMap.get(field.type);
                        if (relatedModel && !this.isModelIncluded(relatedModel)) {
                            continue;
                        }
                    }
                    fields[field.name] = {
                        type: this.getFieldInputType(field),
                        description: field.description,
                    };
                }
                return fields;
            },
        });

        this.typeDefInputTypes.set(typeDef.name, inputType);
        return inputType;
    }

    private getMutationResponseType(model: NormalizedModelDefinition) {
        const existing = this.mutationResponseTypes.get(model.name);
        if (existing) {
            return existing;
        }

        const responseType = new GraphQLObjectType({
            name: `${this.naming.typeName(model.name)}_mutation_response`,
            fields: () => ({
                affected_rows: {
                    type: new GraphQLNonNull(GraphQLInt),
                },
                returning: {
                    type: new GraphQLNonNull(
                        new GraphQLList(new GraphQLNonNull(this.getModelObjectType(model)))
                    ),
                },
            }),
        });

        this.mutationResponseTypes.set(model.name, responseType);
        return responseType;
    }

    private getAggregateLeafType(
        model: NormalizedModelDefinition,
        suffix: 'avg' | 'sum' | 'min' | 'max'
    ) {
        const key = `${model.name}:${suffix}`;
        const existing = this.aggregateLeafTypes.get(key);
        if (existing) {
            return existing;
        }

        const leafType = new GraphQLObjectType({
            name: `${this.naming.typeName(model.name)}_${suffix}_fields`,
            fields: () => {
                const fields: GraphQLFieldConfigMap<unknown, TContext> = {};
                for (const field of this.getVisibleScalarFields(model)) {
                    if (field.kind !== 'scalar') {
                        continue;
                    }

                    if (suffix === 'avg' || suffix === 'sum') {
                        if (!isNumericScalar(field.type)) {
                            continue;
                        }
                    }

                    if ((suffix === 'min' || suffix === 'max') && !isComparableScalar(field.type)) {
                        continue;
                    }

                    fields[field.name] = {
                        type: getScalarType(field.type as ScalarType, this.options.scalars),
                    };
                }
                return fields;
            },
        });

        this.aggregateLeafTypes.set(key, leafType);
        return leafType;
    }

    private getAggregateFieldsType(model: NormalizedModelDefinition) {
        const existing = this.aggregateFieldsTypes.get(model.name);
        if (existing) {
            return existing;
        }

        const aggregateFieldsType = new GraphQLObjectType({
            name: `${this.naming.typeName(model.name)}_aggregate_fields`,
            fields: () => ({
                count: {
                    type: new GraphQLNonNull(GraphQLInt),
                    args: this.getAggregateCountArgs(model),
                    resolve: (source, args) =>
                        this.resolveAggregateCount(
                            source as Record<string, unknown> | null | undefined,
                            args
                        ),
                },
                avg: {
                    type: this.getAggregateLeafType(model, 'avg'),
                },
                sum: {
                    type: this.getAggregateLeafType(model, 'sum'),
                },
                min: {
                    type: this.getAggregateLeafType(model, 'min'),
                },
                max: {
                    type: this.getAggregateLeafType(model, 'max'),
                },
            }),
        });

        this.aggregateFieldsTypes.set(model.name, aggregateFieldsType);
        return aggregateFieldsType;
    }

    private getAggregateType(model: NormalizedModelDefinition) {
        const existing = this.aggregateTypes.get(model.name);
        if (existing) {
            return existing;
        }

        const aggregateType = new GraphQLObjectType({
            name: `${this.naming.typeName(model.name)}_aggregate`,
            fields: () => ({
                aggregate: {
                    type: this.getAggregateFieldsType(model),
                },
                nodes: {
                    type: new GraphQLNonNull(
                        new GraphQLList(new GraphQLNonNull(this.getModelObjectType(model)))
                    ),
                },
            }),
        });

        this.aggregateTypes.set(model.name, aggregateType);
        return aggregateType;
    }

    private createResolver<TArgs extends Record<string, unknown>, TResult>(
        operation: ResolverInvocation<TContext>['operation'],
        model: NormalizedModelDefinition | undefined,
        handler: (input: {
            client: TClient;
            args: TArgs;
            context: TContext;
            info: GraphQLResolveInfo;
        }) => Promise<TResult>
    ): GraphQLFieldResolver<unknown, TContext, TArgs> {
        return async (_source, args, context, info) => {
            const invocation: ResolverInvocation<TContext> = {
                operation,
                model,
                fieldName: info.fieldName,
                args,
                context,
                info,
            };

            await this.options.hooks?.beforeResolve?.(invocation);

            try {
                const client =
                    getExecutionClient<TClient>() ??
                    ((await this.options.getClient(context)) as TClient);
                const result = await handler({ client, args, context, info });
                await this.options.hooks?.afterResolve?.(result, invocation);
                return result;
            } catch (error) {
                const normalized = normalizeError(error);
                const formatted =
                    (await this.options.hooks?.formatError?.(normalized, invocation)) ?? normalized;
                throw formatted;
            }
        };
    }

    private createRelationResolver(
        model: NormalizedModelDefinition,
        relationField: NormalizedFieldDefinition
    ): GraphQLFieldResolver<Record<string, unknown>, TContext, Record<string, unknown>> {
        const relatedModel = this.getModel(relationField.type);
        return async (source, args, context, info) => {
            if (source[relationField.name] !== undefined) {
                return source[relationField.name];
            }

            const parentWhere = this.buildUniqueWhereFromRecord(model, source);
            if (!parentWhere) {
                return relationField.isList ? [] : null;
            }

            const client =
                getExecutionClient<TClient>() ??
                ((await this.options.getClient(context)) as TClient);
            const delegate = this.getRequiredDelegate(client, model);
            if (!delegate.findUnique) {
                return relationField.isList ? [] : null;
            }

            const relationSelect =
                relationField.isList && this.features.nestedArgs
                    ? {
                          where: this.toWhere(relatedModel, args.where),
                          orderBy: this.toOrderBy(relatedModel, args.order_by),
                          distinct: this.toDistinctOn(args.distinct_on),
                          take: typeof args.limit === 'number' ? args.limit : undefined,
                          skip: typeof args.offset === 'number' ? args.offset : undefined,
                          select: this.buildSelection(relatedModel, info.fieldNodes, info),
                      }
                    : {
                          select: this.buildSelection(relatedModel, info.fieldNodes, info),
                      };

            const result = (await delegate.findUnique({
                where: parentWhere,
                select: {
                    [relationField.name]: relationSelect,
                },
            })) as Record<string, unknown> | null;

            return result?.[relationField.name] ?? (relationField.isList ? [] : null);
        };
    }

    private createRelationAggregateResolver(
        model: NormalizedModelDefinition,
        relationField: NormalizedFieldDefinition
    ): GraphQLFieldResolver<Record<string, unknown>, TContext, Record<string, unknown>> {
        const relatedModel = this.getModel(relationField.type);
        return async (source, args, context, info) => {
            const parentWhere = this.buildUniqueWhereFromRecord(model, source);
            if (!parentWhere) {
                return this.createAggregateResponseFromRows([], this.getAggregatePlan(relatedModel, info));
            }

            const client =
                getExecutionClient<TClient>() ??
                ((await this.options.getClient(context)) as TClient);
            const delegate = this.getRequiredDelegate(client, model);
            if (!delegate.findUnique) {
                return this.createAggregateResponseFromRows([], this.getAggregatePlan(relatedModel, info));
            }

            const plan = this.getAggregatePlan(relatedModel, info);
            const relationSelection = this.getAggregateDataSelection(relatedModel, plan);
            const result = (await delegate.findUnique({
                where: parentWhere,
                select: {
                    [relationField.name]: {
                        where: this.toWhere(relatedModel, args.where),
                        orderBy: this.toOrderBy(relatedModel, args.order_by),
                        distinct: this.toDistinctOn(args.distinct_on),
                        take: typeof args.limit === 'number' ? args.limit : undefined,
                        skip: typeof args.offset === 'number' ? args.offset : undefined,
                        select: relationSelection,
                    },
                },
            })) as Record<string, unknown> | null;

            const rows = Array.isArray(result?.[relationField.name])
                ? (result?.[relationField.name] as Record<string, unknown>[])
                : [];

            return this.createAggregateResponseFromRows(rows, plan);
        };
    }

    private mergeSelections(
        left: Record<string, unknown> | undefined,
        right: Record<string, unknown> | undefined
    ): Record<string, unknown> {
        if (!left) {
            return { ...(right ?? {}) };
        }
        if (!right) {
            return { ...left };
        }

        const merged: Record<string, unknown> = { ...left };
        for (const [key, value] of Object.entries(right)) {
            const existing = merged[key];
            if (existing === true || value === true) {
                merged[key] = true;
                continue;
            }

            if (isPlainObject(existing) && isPlainObject(value)) {
                const existingSelect = isPlainObject(existing.select)
                    ? (existing.select as Record<string, unknown>)
                    : undefined;
                const valueSelect = isPlainObject(value.select)
                    ? (value.select as Record<string, unknown>)
                    : undefined;

                if (existingSelect || valueSelect) {
                    merged[key] = {
                        ...existing,
                        ...value,
                        select: this.mergeSelections(existingSelect, valueSelect),
                    };
                } else {
                    merged[key] = {
                        ...existing,
                        ...value,
                    };
                }
                continue;
            }

            merged[key] = value;
        }

        return merged;
    }

    private getDefaultSelection(model: NormalizedModelDefinition) {
        const identifiers = getIdentifierFields(model);
        if (identifiers.length > 0) {
            return Object.fromEntries(identifiers.map((fieldName) => [fieldName, true]));
        }

        const firstScalar = this.getVisibleScalarFields(model)[0];
        return firstScalar ? { [firstScalar.name]: true } : {};
    }

    private needsDistinctRows(plan: AggregatePlan) {
        return plan.countRequests.some(
            (request) => request.distinct || (request.columns?.length ?? 0) > 0
        );
    }

    private getAggregateDataSelection(model: NormalizedModelDefinition, plan: AggregatePlan) {
        let selection = plan.wantsNodes ? this.mergeSelections(undefined, plan.nodeSelection) : {};
        const fields = new Set<string>();

        for (const fieldName of plan.aggregate.avg) {
            fields.add(fieldName);
        }
        for (const fieldName of plan.aggregate.sum) {
            fields.add(fieldName);
        }
        for (const fieldName of plan.aggregate.min) {
            fields.add(fieldName);
        }
        for (const fieldName of plan.aggregate.max) {
            fields.add(fieldName);
        }
        for (const request of plan.countRequests) {
            for (const fieldName of request.columns ?? []) {
                fields.add(fieldName);
            }
        }

        if (this.needsDistinctRows(plan) && plan.countRequests.some((request) => request.distinct && !request.columns?.length)) {
            for (const field of this.getVisibleScalarFields(model)) {
                fields.add(field.name);
            }
        }

        for (const fieldName of fields) {
            selection[fieldName] = true;
        }

        if (Object.keys(selection).length === 0) {
            selection = this.getDefaultSelection(model);
        }

        return selection;
    }

    private projectSelectedValue(
        value: unknown,
        selection: Record<string, unknown> | undefined
    ): unknown {
        if (!selection || !isPlainObject(value)) {
            return value;
        }

        const result: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(selection)) {
            const current = value[key];
            if (entry === true) {
                result[key] = current;
                continue;
            }

            if (!isPlainObject(entry)) {
                continue;
            }

            const nestedSelection = isPlainObject(entry.select)
                ? (entry.select as Record<string, unknown>)
                : entry;

            if (Array.isArray(current)) {
                result[key] = current.map((item) => this.projectSelectedValue(item, nestedSelection));
                continue;
            }

            result[key] = current == null ? current : this.projectSelectedValue(current, nestedSelection);
        }

        return result;
    }

    private resolveAggregateCount(
        source: Record<string, unknown> | null | undefined,
        args: Record<string, unknown>
    ) {
        const rows = Array.isArray(source?.__rows)
            ? (source?.__rows as Record<string, unknown>[])
            : undefined;
        const columns = Array.isArray(args.columns)
            ? args.columns.filter((entry): entry is string => typeof entry === 'string')
            : undefined;
        const distinct = args.distinct === true;

        if (rows && (distinct || (columns?.length ?? 0) > 0)) {
            return this.countDistinctRows(rows, columns, distinct);
        }

        if (rows && distinct) {
            return this.countDistinctRows(rows, undefined, true);
        }

        if (typeof source?.count === 'number') {
            return source.count;
        }

        if (rows) {
            return rows.length;
        }

        return 0;
    }

    private countDistinctRows(
        rows: Record<string, unknown>[],
        columns?: string[],
        distinct = false
    ) {
        if (!distinct && (!columns || columns.length === 0)) {
            return rows.length;
        }

        const targetColumns =
            columns && columns.length > 0 ? columns : Object.keys(rows[0] ?? {}).sort();
        const keys = new Set(
            rows.map((row) =>
                JSON.stringify(targetColumns.map((column) => row[column] ?? null))
            )
        );
        return keys.size;
    }

    private computeAggregateLeafFromRows(
        rows: Record<string, unknown>[],
        fields: string[],
        operation: 'avg' | 'sum' | 'min' | 'max'
    ) {
        if (fields.length === 0) {
            return null;
        }

        return Object.fromEntries(
            fields.map((fieldName) => {
                const values = rows
                    .map((row) => row[fieldName])
                    .filter((value) => value !== null && value !== undefined);

                if (values.length === 0) {
                    return [fieldName, null];
                }

                if (operation === 'avg' || operation === 'sum') {
                    const numericValues = values
                        .map((value) => Number(value))
                        .filter((value) => !Number.isNaN(value));
                    if (numericValues.length === 0) {
                        return [fieldName, null];
                    }
                    if (operation === 'avg') {
                        return [
                            fieldName,
                            numericValues.reduce((sum, value) => sum + value, 0) /
                                numericValues.length,
                        ];
                    }
                    return [fieldName, numericValues.reduce((sum, value) => sum + value, 0)];
                }

                const ordered = [...values].sort(compareAggregateValues);
                return [fieldName, operation === 'min' ? ordered[0] : ordered[ordered.length - 1]];
            })
        );
    }

    private createAggregateResponseFromRows(
        rows: Record<string, unknown>[],
        plan: AggregatePlan
    ) {
        return {
            aggregate: plan.wantsAggregate
                ? {
                      __rows: rows,
                      count: rows.length,
                      avg: this.computeAggregateLeafFromRows(rows, plan.aggregate.avg, 'avg'),
                      sum: this.computeAggregateLeafFromRows(rows, plan.aggregate.sum, 'sum'),
                      min: this.computeAggregateLeafFromRows(rows, plan.aggregate.min, 'min'),
                      max: this.computeAggregateLeafFromRows(rows, plan.aggregate.max, 'max'),
                  }
                : null,
            nodes: plan.wantsNodes
                ? rows.map((row) =>
                      this.projectSelectedValue(row, plan.nodeSelection) as Record<string, unknown>
                  )
                : [],
        };
    }

    private getRequiredDelegate(client: TClient, model: NormalizedModelDefinition) {
        const candidates = [
            model.name,
            lowerCamelCase(model.name),
            toHasuraCollectionName(model),
        ];

        for (const key of candidates) {
            const value = (client as Record<string, unknown>)[key];
            if (value) {
                return value as ModelDelegate;
            }
        }

        throw new Error(`Unable to locate a delegate for model "${model.name}" on the ZenStack client`);
    }

    private assertMethod(
        delegate: ModelDelegate,
        method: keyof ModelDelegate,
        model: NormalizedModelDefinition
    ) {
        if (typeof delegate[method] !== 'function') {
            throw new Error(`Delegate for model "${model.name}" does not implement "${String(method)}"`);
        }
    }

    private compileFindManyArgs(
        model: NormalizedModelDefinition,
        args: Record<string, unknown>,
        info: GraphQLResolveInfo
    ) {
        return {
            where: this.toWhere(model, args.where),
            orderBy: this.toOrderBy(model, args.order_by),
            distinct: this.toDistinctOn(args.distinct_on),
            take: typeof args.limit === 'number' ? args.limit : undefined,
            skip: typeof args.offset === 'number' ? args.offset : undefined,
            select: this.buildSelection(model, info.fieldNodes, info),
        };
    }

    private buildSelection(
        model: NormalizedModelDefinition,
        fieldNodes: readonly FieldNode[],
        info: Pick<GraphQLResolveInfo, 'fragments' | 'variableValues'>
    ): Record<string, unknown> {
        const selections = this.collectFields(fieldNodes, info);
        return this.buildSelectionFromFields(model, selections, info);
    }

    private buildSelectionFromFields(
        model: NormalizedModelDefinition,
        fieldNodes: FieldNode[],
        info: Pick<GraphQLResolveInfo, 'fragments' | 'variableValues'>
    ): Record<string, unknown> {
        const select: Record<string, unknown> = {};
        for (const fieldNode of fieldNodes) {
            const fieldName = fieldNode.name.value;
            if (fieldName === '__typename') {
                continue;
            }

            const field = model.fieldMap.get(fieldName);
            if (!field) {
                continue;
            }

            if (field.kind !== 'relation') {
                select[fieldName] = true;
                continue;
            }

            const relatedModel = this.getModel(field.type);
            const nestedFields = this.collectSelectionNodes(fieldNode.selectionSet, info).filter(
                (node): node is FieldNode => node.kind === 'Field'
            );
            const nestedSelect = this.buildSelectionFromFields(relatedModel, nestedFields, info);
            if (field.isList) {
                const relationArgs = this.argumentsFromFieldNode(fieldNode, info);
                select[fieldName] = {
                    where: this.toWhere(relatedModel, relationArgs.where),
                    orderBy: this.toOrderBy(relatedModel, relationArgs.order_by),
                    distinct: this.toDistinctOn(relationArgs.distinct_on),
                    take: typeof relationArgs.limit === 'number' ? relationArgs.limit : undefined,
                    skip: typeof relationArgs.offset === 'number' ? relationArgs.offset : undefined,
                    select: nestedSelect,
                };
            } else {
                select[fieldName] = {
                    select: nestedSelect,
                };
            }
        }

        return select;
    }

    private collectFields(
        fieldNodes: readonly FieldNode[],
        info: Pick<GraphQLResolveInfo, 'fragments' | 'variableValues'>
    ) {
        const collected: FieldNode[] = [];
        for (const fieldNode of fieldNodes) {
            if (!fieldNode.selectionSet) {
                continue;
            }
            collected.push(
                ...this.collectSelectionNodes(fieldNode.selectionSet, info).filter(
                    (node): node is FieldNode => node.kind === 'Field'
                )
            );
        }
        return collected;
    }

    private collectSelectionNodes(
        selectionSet: SelectionSetNode | undefined,
        info: Pick<GraphQLResolveInfo, 'fragments' | 'variableValues'>
    ): SelectionNode[] {
        if (!selectionSet) {
            return [];
        }

        const nodes: SelectionNode[] = [];
        for (const selection of selectionSet.selections) {
            if (selection.kind === 'Field') {
                nodes.push(selection);
                continue;
            }

            if (selection.kind === 'InlineFragment') {
                nodes.push(...this.collectSelectionNodes(selection.selectionSet, info));
                continue;
            }

            const fragment = info.fragments[selection.name.value];
            if (fragment) {
                nodes.push(...this.collectSelectionNodes(fragment.selectionSet, info));
            }
        }

        return nodes;
    }

    private argumentsFromFieldNode(
        fieldNode: FieldNode,
        info: Pick<GraphQLResolveInfo, 'variableValues'>
    ) {
        const args: Record<string, unknown> = {};
        for (const arg of fieldNode.arguments ?? []) {
            args[arg.name.value] = valueFromASTUntyped(arg.value, info.variableValues);
        }
        return args;
    }

    private toWhere(model: NormalizedModelDefinition, input: unknown): Record<string, unknown> | undefined {
        if (!isPlainObject(input)) {
            return undefined;
        }

        const result: Record<string, unknown> = {};
        const mergeRelationFilter = (
            relationName: string,
            operator: 'some' | 'every' | 'none' | 'is',
            relatedWhere: Record<string, unknown> | null
        ) => {
            if (operator === 'is') {
                result[relationName] = relatedWhere;
                return;
            }

            const existing = isPlainObject(result[relationName])
                ? (result[relationName] as Record<string, unknown>)
                : {};
            result[relationName] = {
                ...existing,
                [operator]: relatedWhere,
            };
        };

        for (const [key, value] of Object.entries(input)) {
            if (value === undefined) {
                continue;
            }

            if (key === '_and' && Array.isArray(value)) {
                result.AND = value
                    .map((entry) => this.toWhere(model, entry))
                    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
                continue;
            }

            if (key === '_or' && Array.isArray(value)) {
                result.OR = value
                    .map((entry) => this.toWhere(model, entry))
                    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
                continue;
            }

            if (key === '_not') {
                result.NOT = this.toWhere(model, value);
                continue;
            }

            const field = model.fieldMap.get(key);
            const relationSuffixMatch = key.match(/^(.*)_(some|every|none)$/);
            if (!field && relationSuffixMatch) {
                const [, relationName, operator] = relationSuffixMatch;
                const relationField = model.fieldMap.get(relationName);
                if (!relationField || relationField.kind !== 'relation' || !relationField.isList) {
                    continue;
                }

                const relatedWhere = this.toWhere(this.getModel(relationField.type), value);
                if (!relatedWhere) {
                    continue;
                }
                mergeRelationFilter(
                    relationName,
                    operator as 'some' | 'every' | 'none',
                    relatedWhere
                );
                continue;
            }

            if (!field) {
                continue;
            }

            if (field.kind === 'relation') {
                if (!field.isList && value === null) {
                    mergeRelationFilter(key, 'is', null);
                    continue;
                }

                const relatedWhere = this.toWhere(this.getModel(field.type), value);
                if (!relatedWhere) {
                    continue;
                }
                mergeRelationFilter(
                    key,
                    field.isList ? 'some' : 'is',
                    relatedWhere
                );
                continue;
            }

            if (field.kind === 'typeDef') {
                if (field.isList) {
                    const relatedWhere = this.toTypeDefListWhere(this.getTypeDef(field.type), value);
                    if (!relatedWhere) {
                        continue;
                    }
                    result[key] = relatedWhere;
                } else {
                    const relatedWhere = this.toTypeDefWhere(this.getTypeDef(field.type), value);
                    if (!relatedWhere) {
                        continue;
                    }
                    result[key] = relatedWhere;
                }
                continue;
            }

            result[key] = this.toScalarWhere(field, value);
        }

        return Object.keys(result).length > 0 ? result : undefined;
    }

    private toTypeDefListWhere(
        typeDef: NormalizedTypeDefDefinition,
        input: unknown
    ): Record<string, unknown> | undefined {
        if (!isPlainObject(input)) {
            return undefined;
        }

        const result: Record<string, unknown> = {};
        if (isPlainObject(input.some)) {
            result.some = this.toTypeDefWhere(typeDef, input.some);
        }
        if (isPlainObject(input.every)) {
            result.every = this.toTypeDefWhere(typeDef, input.every);
        }
        if (isPlainObject(input.none)) {
            result.none = this.toTypeDefWhere(typeDef, input.none);
        }
        return Object.keys(result).length > 0 ? result : undefined;
    }

    private toTypeDefWhere(
        typeDef: NormalizedTypeDefDefinition,
        input: unknown
    ): Record<string, unknown> | undefined {
        if (!isPlainObject(input)) {
            return undefined;
        }

        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(input)) {
            if (value === undefined) {
                continue;
            }

            if (key === '_and' && Array.isArray(value)) {
                result.AND = value
                    .map((entry) => this.toTypeDefWhere(typeDef, entry))
                    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
                continue;
            }

            if (key === '_or' && Array.isArray(value)) {
                result.OR = value
                    .map((entry) => this.toTypeDefWhere(typeDef, entry))
                    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
                continue;
            }

            if (key === '_not') {
                result.NOT = this.toTypeDefWhere(typeDef, value);
                continue;
            }

            const field = typeDef.fieldMap.get(key);
            if (!field) {
                continue;
            }

            if (field.kind === 'typeDef') {
                const nested = field.isList
                    ? this.toTypeDefListWhere(this.getTypeDef(field.type), value)
                    : this.toTypeDefWhere(this.getTypeDef(field.type), value);
                if (nested) {
                    result[key] = nested;
                }
                continue;
            }

            if (field.kind === 'relation') {
                continue;
            }

            result[key] = this.toScalarWhere(field, value);
        }

        return Object.keys(result).length > 0 ? result : undefined;
    }

    private toScalarWhere(field: NormalizedFieldDefinition, input: unknown) {
        if (!isPlainObject(input)) {
            return input;
        }

        const result: Record<string, unknown> = {};
        const addNegatedFilter = (filter: unknown) => {
            if (isPlainObject(filter)) {
                if (isPlainObject(result.not)) {
                    Object.assign(result.not, filter);
                } else if (result.not !== undefined) {
                    result.not = { equals: result.not, ...filter };
                } else {
                    result.not = filter;
                }
                return;
            }

            if (result.not === undefined) {
                result.not = filter;
                return;
            }

            if (isPlainObject(result.not)) {
                result.not.equals = filter;
                return;
            }

            result.not = filter;
        };

        for (const [key, value] of Object.entries(input)) {
            switch (key) {
                case '_eq':
                    result.equals = value;
                    break;
                case '_neq':
                    addNegatedFilter({ equals: value });
                    break;
                case '_gt':
                    result.gt = value;
                    break;
                case '_gte':
                    result.gte = value;
                    break;
                case '_lt':
                    result.lt = value;
                    break;
                case '_lte':
                    result.lte = value;
                    break;
                case '_between':
                    result.between = value;
                    break;
                case '_in':
                    result.in = value;
                    break;
                case '_nin':
                    result.notIn = value;
                    break;
                case 'has':
                    result.has = value;
                    break;
                case 'hasEvery':
                    result.hasEvery = value;
                    break;
                case 'hasSome':
                    result.hasSome = value;
                    break;
                case 'isEmpty':
                    result.isEmpty = value;
                    break;
                case '_is_null':
                    if (value === true) {
                        result.equals = null;
                    } else if (value === false) {
                        addNegatedFilter({ equals: null });
                    }
                    break;
                case '_contains':
                    result.contains = value;
                    break;
                case '_ncontains':
                    addNegatedFilter({ contains: value });
                    break;
                case '_icontains':
                    result.contains = value;
                    if (this.supportsInsensitiveMode()) {
                        result.mode = 'insensitive';
                    }
                    break;
                case '_nicontains':
                    addNegatedFilter(
                        this.supportsInsensitiveMode()
                            ? { contains: value, mode: 'insensitive' }
                            : { contains: value }
                    );
                    break;
                case '_starts_with':
                    result.startsWith = value;
                    break;
                case '_nstarts_with':
                    addNegatedFilter({ startsWith: value });
                    break;
                case '_istarts_with':
                    result.startsWith = value;
                    if (this.supportsInsensitiveMode()) {
                        result.mode = 'insensitive';
                    }
                    break;
                case '_nistarts_with':
                    addNegatedFilter(
                        this.supportsInsensitiveMode()
                            ? { startsWith: value, mode: 'insensitive' }
                            : { startsWith: value }
                    );
                    break;
                case '_ends_with':
                    result.endsWith = value;
                    break;
                case '_nends_with':
                    addNegatedFilter({ endsWith: value });
                    break;
                case '_iends_with':
                    result.endsWith = value;
                    if (this.supportsInsensitiveMode()) {
                        result.mode = 'insensitive';
                    }
                    break;
                case '_niends_with':
                    addNegatedFilter(
                        this.supportsInsensitiveMode()
                            ? { endsWith: value, mode: 'insensitive' }
                            : { endsWith: value }
                    );
                    break;
                case '_like':
                    Object.assign(result, likePatternToFilter(String(value)));
                    break;
                case '_nlike':
                    addNegatedFilter(likePatternToFilter(String(value)));
                    break;
                case '_ilike':
                    Object.assign(
                        result,
                        likePatternToFilter(String(value), this.supportsInsensitiveMode())
                    );
                    break;
                case '_nilike':
                    addNegatedFilter(
                        likePatternToFilter(String(value), this.supportsInsensitiveMode())
                    );
                    break;
                case 'path':
                case 'equals':
                case 'string_contains':
                case 'string_starts_with':
                case 'string_ends_with':
                case 'array_contains':
                case 'array_starts_with':
                case 'array_ends_with':
                    result[key] = value;
                    break;
                case 'mode':
                    if (this.supportsJsonFilterMode()) {
                        result.mode = value;
                    }
                    break;
                case 'not':
                    addNegatedFilter(value);
                    break;
                default:
                    if (field.kind === 'enum') {
                        result[key] = value;
                    }
                    break;
            }
        }
        return result;
    }

    private toOrderBy(model: NormalizedModelDefinition, input: unknown) {
        if (!input) {
            return undefined;
        }

        const values = Array.isArray(input) ? input : [input];
        const result = values
            .map((entry) => this.toSingleOrderBy(model, entry))
            .filter((entry): entry is Record<string, unknown> => Boolean(entry));
        if (result.length === 0) {
            return undefined;
        }
        return result.length === 1 ? result[0] : result;
    }

    private toSingleOrderBy(model: NormalizedModelDefinition, input: unknown) {
        if (!isPlainObject(input)) {
            return undefined;
        }

        const orderBy: Record<string, unknown> = {};
        for (const [fieldName, value] of Object.entries(input)) {
            const field = model.fieldMap.get(fieldName);
            if (field?.kind === 'relation') {
                if (field.isList) {
                    continue;
                }
                const nested = this.toSingleOrderBy(this.getModel(field.type), value);
                if (nested) {
                    orderBy[fieldName] = nested;
                }
                continue;
            }

            if (field) {
                if (typeof value === 'string') {
                    orderBy[fieldName] = compileOrderDirection(value as OrderByDirection);
                }
                continue;
            }

            if (!fieldName.endsWith('_aggregate') || !isPlainObject(value)) {
                continue;
            }

            const relationField = model.fieldMap.get(fieldName.slice(0, -'_aggregate'.length));
            if (
                !relationField ||
                relationField.kind !== 'relation' ||
                !relationField.isList ||
                typeof value.count !== 'string'
            ) {
                continue;
            }

            orderBy[relationField.name] = {
                _count: normalizeOrderDirection(value.count as OrderByDirection),
            };
        }

        return Object.keys(orderBy).length > 0 ? orderBy : undefined;
    }

    private toDistinctOn(input: unknown) {
        if (!Array.isArray(input)) {
            return undefined;
        }

        const result = input.filter((entry): entry is string => typeof entry === 'string');
        return result.length > 0 ? result : undefined;
    }

    private buildUniqueWhere(model: NormalizedModelDefinition, args: Record<string, unknown>) {
        const fields = getPrimaryKeyFields(model);
        return Object.fromEntries(fields.map((fieldName) => [fieldName, args[fieldName]]));
    }

    private buildUniqueWhereFromRecord(
        model: NormalizedModelDefinition,
        record: Record<string, unknown>
    ) {
        for (const fields of getUniqueFieldSets(model)) {
            const values = fields.map((field) => record[field]);
            if (values.some((value) => value === undefined)) {
                continue;
            }

            return Object.fromEntries(fields.map((field) => [field, record[field]]));
        }

        return undefined;
    }

    private buildMutationData(args: Record<string, unknown>) {
        return args;
    }

    private compileInsertData(
        model: NormalizedModelDefinition,
        input: Record<string, unknown>
    ): Record<string, unknown> {
        const data: Record<string, unknown> = {};

        for (const [fieldName, value] of Object.entries(input)) {
            const field = model.fieldMap.get(fieldName);
            if (!field || value === undefined) {
                continue;
            }

            if (field.kind !== 'relation') {
                data[fieldName] = value;
                continue;
            }

            if (!isPlainObject(value) || !('data' in value)) {
                continue;
            }

            const relatedModel = this.getModel(field.type);
            const nestedData = value.data;
            if (field.isList) {
                const items = Array.isArray(nestedData)
                    ? nestedData
                          .filter((entry): entry is Record<string, unknown> => isPlainObject(entry))
                          .map((entry) => this.compileInsertData(relatedModel, entry))
                    : [];
                data[fieldName] = { create: items };
                continue;
            }

            if (isPlainObject(nestedData)) {
                data[fieldName] = {
                    create: this.compileInsertData(relatedModel, nestedData),
                };
            }
        }

        return data;
    }

    private hasNestedInsertData(model: NormalizedModelDefinition, input: Record<string, unknown>) {
        return Object.keys(input).some((fieldName) => {
            const field = model.fieldMap.get(fieldName);
            return field?.kind === 'relation' && isPlainObject(input[fieldName]);
        });
    }

    private compileUpdateData(
        model: NormalizedModelDefinition,
        args: Record<string, unknown>
    ): Record<string, unknown> {
        const data: Record<string, unknown> = {};
        const setInput = isPlainObject(args._set) ? args._set : undefined;
        if (setInput) {
            for (const [fieldName, value] of Object.entries(setInput)) {
                const field = model.fieldMap.get(fieldName);
                if (!field || value === undefined) {
                    continue;
                }

                if (field.kind !== 'relation') {
                    data[fieldName] = value;
                    continue;
                }

                if (!isPlainObject(value)) {
                    continue;
                }

                const relatedModel = this.getModel(field.type);
                if (field.isList) {
                    const nestedCreate = Array.isArray(value.create)
                        ? value.create
                              .filter((entry): entry is Record<string, unknown> => isPlainObject(entry))
                              .map((entry) => this.compileInsertData(relatedModel, entry))
                        : [];
                    const nestedUpdateMany = Array.isArray(value.update_many)
                        ? value.update_many
                              .filter((entry): entry is Record<string, unknown> => isPlainObject(entry))
                              .map((entry) => ({
                                  where: this.toWhere(relatedModel, entry.where),
                                  data: this.compileUpdateData(relatedModel, entry),
                              }))
                        : [];

                    if (nestedCreate.length > 0 || nestedUpdateMany.length > 0) {
                        data[fieldName] = {
                            ...(nestedCreate.length > 0 ? { create: nestedCreate } : {}),
                            ...(nestedUpdateMany.length > 0
                                ? { updateMany: nestedUpdateMany }
                                : {}),
                        };
                    }
                    continue;
                }

                const nested: Record<string, unknown> = {};
                if (isPlainObject(value.create)) {
                    nested.create = this.compileInsertData(relatedModel, value.create);
                }
                if (isPlainObject(value.update)) {
                    nested.update = this.compileUpdateData(relatedModel, value.update);
                }
                if (Object.keys(nested).length > 0) {
                    data[fieldName] = nested;
                }
            }
        }

        if (isPlainObject(args._inc)) {
            for (const [field, value] of Object.entries(args._inc)) {
                data[field] = { increment: value };
            }
        }

        if (Object.keys(data).length === 0) {
            throw new Error('At least one of "_set" or "_inc" must be provided');
        }

        return data;
    }

    private hasNestedUpdateData(
        model: NormalizedModelDefinition,
        args: Record<string, unknown>
    ) {
        const setInput = isPlainObject(args._set) ? args._set : undefined;
        if (!setInput) {
            return false;
        }

        return Object.keys(setInput).some((fieldName) => {
            const field = model.fieldMap.get(fieldName);
            return field?.kind === 'relation' && isPlainObject(setInput[fieldName]);
        });
    }

    private buildConflictWhere(
        model: NormalizedModelDefinition,
        object: Record<string, unknown>,
        conflict: Record<string, unknown>
    ) {
        const constraintName = conflict.constraint;
        const constraint = this.getConflictConstraints(model).find(
            (entry) => entry.name === constraintName
        );
        if (!constraint) {
            throw new Error(`Unknown conflict constraint "${String(constraintName)}" for model "${model.name}"`);
        }

        const where: Record<string, unknown> = {};
        for (const fieldName of constraint.fields) {
            if (!(fieldName in object)) {
                throw new Error(
                    `Conflict target field "${fieldName}" is missing from insert object for model "${model.name}"`
                );
            }
            where[fieldName] = object[fieldName];
        }
        return where;
    }

    private buildConflictUpdateData(
        model: NormalizedModelDefinition,
        object: Record<string, unknown>,
        updateColumns: unknown
    ) {
        const allowedFields = new Set(
            this.getMutableFields(model)
                .filter((field) => field.kind !== 'relation' && !field.isId)
                .map((field) => field.name)
        );
        const columns = Array.isArray(updateColumns)
            ? updateColumns.filter(
                  (entry): entry is string =>
                      typeof entry === 'string' && allowedFields.has(entry)
              )
            : [];

        return Object.fromEntries(
            columns
                .filter((fieldName) => fieldName in object)
                .map((fieldName) => [fieldName, object[fieldName]])
        );
    }

    private async findExistingByWhere(
        delegate: ModelDelegate,
        model: NormalizedModelDefinition,
        where: Record<string, unknown>,
        select: Record<string, unknown> | undefined
    ) {
        if (delegate.findUnique) {
            return delegate.findUnique({ where, select });
        }

        this.assertMethod(delegate, 'findMany', model);
        const rows = await delegate.findMany!({
            where,
            take: 1,
            select,
        });
        return rows[0] ?? null;
    }

    private getReturningSelection(
        model: NormalizedModelDefinition,
        info: GraphQLResolveInfo
    ): Record<string, unknown> | undefined {
        const returningField = this.collectFields(info.fieldNodes, info).find(
            (field) => field.name.value === 'returning'
        );
        if (!returningField?.selectionSet) {
            return undefined;
        }

        const fields = this.collectSelectionNodes(returningField.selectionSet, info).filter(
            (node): node is FieldNode => node.kind === 'Field'
        );
        return this.buildSelectionFromFields(model, fields, info);
    }

    private getAggregatePlan(model: NormalizedModelDefinition, info: GraphQLResolveInfo) {
        const aggregateField = this.collectFields(info.fieldNodes, info).find(
            (field) => field.name.value === 'aggregate'
        );
        const nodesField = this.collectFields(info.fieldNodes, info).find(
            (field) => field.name.value === 'nodes'
        );

        const plan: AggregatePlan = {
            wantsAggregate: Boolean(aggregateField),
            wantsNodes: Boolean(nodesField),
            countRequests: [],
            aggregate: {
                avg: [] as string[],
                sum: [] as string[],
                min: [] as string[],
                max: [] as string[],
            },
            nodeSelection: undefined as Record<string, unknown> | undefined,
        };

        if (aggregateField?.selectionSet) {
            const innerAggregate = this.collectSelectionNodes(aggregateField.selectionSet, info).filter(
                (node): node is FieldNode => node.kind === 'Field'
            );
            for (const node of innerAggregate) {
                const name = node.name.value;
                if (name === 'count') {
                    const countArgs = this.argumentsFromFieldNode(node, info);
                    plan.countRequests.push({
                        columns: Array.isArray(countArgs.columns)
                            ? countArgs.columns.filter(
                                  (entry): entry is string => typeof entry === 'string'
                              )
                            : undefined,
                        distinct: countArgs.distinct === true,
                    });
                    continue;
                }

                if (!node.selectionSet) {
                    continue;
                }

                const target = plan.aggregate[name as keyof typeof plan.aggregate];
                if (!Array.isArray(target)) {
                    continue;
                }

                const fields = this.collectSelectionNodes(node.selectionSet, info)
                    .filter((child): child is FieldNode => child.kind === 'Field')
                    .map((child) => child.name.value)
                    .filter((fieldName) => Boolean(model.fieldMap.get(fieldName)));
                target.push(...fields);
            }
        }

        if (nodesField?.selectionSet) {
            const fields = this.collectSelectionNodes(nodesField.selectionSet, info).filter(
                (node): node is FieldNode => node.kind === 'Field'
            );
            plan.nodeSelection = this.buildSelectionFromFields(model, fields, info);
        }

        return plan;
    }

    private async resolveAggregate(
        model: NormalizedModelDefinition,
        client: TClient,
        args: Record<string, unknown>,
        info: GraphQLResolveInfo
    ) {
        const delegate = this.getRequiredDelegate(client, model);
        const plan = this.getAggregatePlan(model, info);
        const where = this.toWhere(model, args.where);
        const orderBy = this.toOrderBy(model, args.order_by);
        const distinct = this.toDistinctOn(args.distinct_on);
        const take = typeof args.limit === 'number' ? args.limit : undefined;
        const skip = typeof args.offset === 'number' ? args.offset : undefined;

        const needsRows =
            plan.wantsNodes ||
            this.needsDistinctRows(plan) ||
            !delegate.aggregate;
        let aggregateRows: Record<string, unknown>[] | undefined;
        if (needsRows) {
            this.assertMethod(delegate, 'findMany', model);
            aggregateRows = (await delegate.findMany!({
                where,
                orderBy,
                distinct,
                take,
                skip,
                select: this.getAggregateDataSelection(model, plan),
            })) as Record<string, unknown>[];
        }

        let rawAggregate: Record<string, unknown> | undefined;
        if (
            plan.wantsAggregate &&
            delegate.aggregate &&
            (plan.aggregate.avg.length > 0 ||
                plan.aggregate.sum.length > 0 ||
                plan.aggregate.min.length > 0 ||
                plan.aggregate.max.length > 0 ||
                plan.countRequests.some(
                    (request) => !request.distinct && (request.columns?.length ?? 0) === 0
                ))
        ) {
            this.assertMethod(delegate, 'aggregate', model);
            rawAggregate = await delegate.aggregate!({
                where,
                orderBy,
                distinct,
                take,
                skip,
                _count: plan.countRequests.length > 0 ? { _all: true } : undefined,
                _avg:
                    plan.aggregate.avg.length > 0
                        ? Object.fromEntries(plan.aggregate.avg.map((field) => [field, true]))
                        : undefined,
                _sum:
                    plan.aggregate.sum.length > 0
                        ? Object.fromEntries(plan.aggregate.sum.map((field) => [field, true]))
                        : undefined,
                _min:
                    plan.aggregate.min.length > 0
                        ? Object.fromEntries(plan.aggregate.min.map((field) => [field, true]))
                        : undefined,
                _max:
                    plan.aggregate.max.length > 0
                        ? Object.fromEntries(plan.aggregate.max.map((field) => [field, true]))
                        : undefined,
            });
        }

        const rows = aggregateRows ?? [];
        const aggregateFromRows =
            plan.wantsAggregate && rows.length > 0
                ? {
                      __rows: rows,
                      count: rows.length,
                      avg: this.computeAggregateLeafFromRows(rows, plan.aggregate.avg, 'avg'),
                      sum: this.computeAggregateLeafFromRows(rows, plan.aggregate.sum, 'sum'),
                      min: this.computeAggregateLeafFromRows(rows, plan.aggregate.min, 'min'),
                      max: this.computeAggregateLeafFromRows(rows, plan.aggregate.max, 'max'),
                  }
                : undefined;

        return {
            aggregate: plan.wantsAggregate
                ? {
                      __rows: rows.length > 0 ? rows : undefined,
                      count:
                          aggregateFromRows?.count ??
                          this.extractAggregateCount(rawAggregate),
                      avg:
                          aggregateFromRows?.avg ??
                          ((rawAggregate?._avg as Record<string, unknown> | undefined) ?? null),
                      sum:
                          aggregateFromRows?.sum ??
                          ((rawAggregate?._sum as Record<string, unknown> | undefined) ?? null),
                      min:
                          aggregateFromRows?.min ??
                          ((rawAggregate?._min as Record<string, unknown> | undefined) ?? null),
                      max:
                          aggregateFromRows?.max ??
                          ((rawAggregate?._max as Record<string, unknown> | undefined) ?? null),
                  }
                : null,
            nodes: plan.wantsNodes
                ? rows.map((row) =>
                      this.projectSelectedValue(row, plan.nodeSelection) as Record<string, unknown>
                  )
                : [],
        };
    }

    private extractAggregateCount(rawAggregate: Record<string, unknown> | undefined) {
        const count = rawAggregate?._count;
        if (typeof count === 'number') {
            return count;
        }
        if (isPlainObject(count) && typeof count._all === 'number') {
            return count._all;
        }
        return 0;
    }

    private async resolveInsertOne(
        model: NormalizedModelDefinition,
        client: TClient,
        args: Record<string, unknown>,
        info: GraphQLResolveInfo
    ) {
        const delegate = this.getRequiredDelegate(client, model);
        const object = isPlainObject(args.object) ? args.object : {};
        const selection = this.buildSelection(model, info.fieldNodes, info);
        const conflict = isPlainObject(args.on_conflict) ? args.on_conflict : undefined;

        return this.createOrUpsertObject(model, delegate, object, selection, conflict);
    }

    private async createOrUpsertObject(
        model: NormalizedModelDefinition,
        delegate: ModelDelegate,
        object: Record<string, unknown>,
        selection: Record<string, unknown> | undefined,
        conflict?: Record<string, unknown>
    ) {
        const data = this.compileInsertData(model, object);

        if (!conflict) {
            this.assertMethod(delegate, 'create', model);
            return delegate.create!({
                data,
                select: selection,
            });
        }

        const where = this.buildConflictWhere(model, object, conflict);
        const update = this.buildConflictUpdateData(model, object, conflict.update_columns);

        if (delegate.upsert) {
            return delegate.upsert({
                where,
                create: data,
                update,
                select: selection,
            });
        }

        const existing = await this.findExistingByWhere(delegate, model, where, selection);
        if (existing) {
            if (Object.keys(update).length === 0) {
                return existing;
            }

            this.assertMethod(delegate, 'update', model);
            return delegate.update!({
                where,
                data: update,
                select: selection,
            });
        }

        this.assertMethod(delegate, 'create', model);
        return delegate.create!({
            data,
            select: selection,
        });
    }

    private async resolveInsertMany(
        model: NormalizedModelDefinition,
        client: TClient,
        args: Record<string, unknown>,
        info: GraphQLResolveInfo
    ) {
        const delegate = this.getRequiredDelegate(client, model);
        const objects = Array.isArray(args.objects) ? args.objects : [];
        const returningSelection = this.getReturningSelection(model, info);
        const wantsReturning = Boolean(returningSelection);
        const conflict = isPlainObject(args.on_conflict) ? args.on_conflict : undefined;

        if (objects.length === 0) {
            return { affected_rows: 0, returning: [] };
        }

        const compiledObjects = objects
            .filter((entry): entry is Record<string, unknown> => isPlainObject(entry))
            .map((entry) => this.compileInsertData(model, entry));
        const hasNestedObjects = objects.some(
            (entry) => isPlainObject(entry) && this.hasNestedInsertData(model, entry)
        );

        if (!conflict && !wantsReturning && delegate.createMany && !hasNestedObjects) {
            const result = await delegate.createMany({ data: compiledObjects });
            return { affected_rows: result.count, returning: [] };
        }

        if (!conflict && wantsReturning && delegate.createManyAndReturn && !hasNestedObjects) {
            const rows = await delegate.createManyAndReturn({
                data: compiledObjects,
                select: returningSelection,
            });
            return {
                affected_rows: rows.length,
                returning: rows,
            };
        }

        const returning = [];
        for (const object of objects) {
            if (!isPlainObject(object)) {
                continue;
            }
            const created = await this.createOrUpsertObject(
                model,
                delegate,
                object,
                returningSelection,
                conflict
            );
            if (wantsReturning) {
                returning.push(created);
            }
        }

        return {
            affected_rows: compiledObjects.length,
            returning,
        };
    }

    private async resolveUpdateMany(
        model: NormalizedModelDefinition,
        client: TClient,
        args: Record<string, unknown>,
        info: GraphQLResolveInfo
    ) {
        const delegate = this.getRequiredDelegate(client, model);
        const where = this.toWhere(model, args.where);
        const data = this.compileUpdateData(model, this.buildMutationData(args));
        const returningSelection = this.getReturningSelection(model, info);
        const wantsReturning = Boolean(returningSelection);
        const hasNestedData = this.hasNestedUpdateData(model, args);

        if (!wantsReturning && delegate.updateMany && !hasNestedData) {
            const result = await delegate.updateMany({ where, data });
            return { affected_rows: result.count, returning: [] };
        }

        this.assertMethod(delegate, 'findMany', model);
        this.assertMethod(delegate, 'update', model);
        const identitySelection = this.getIdentitySelection(model);
        if (Object.keys(identitySelection).length === 0) {
            throw new Error(`Model "${model.name}" requires a primary key or unique field for update returning`);
        }
        const rows = await delegate.findMany!({
            where,
            select: identitySelection,
        });

        const returning = [];
        for (const row of rows as Record<string, unknown>[]) {
            const updated = await delegate.update!({
                where: this.buildUniqueWhereFromRecord(model, row),
                data,
                select: returningSelection,
            });
            if (wantsReturning) {
                returning.push(updated);
            }
        }

        return {
            affected_rows: rows.length,
            returning,
        };
    }

    private async resolveUpdateByPk(
        model: NormalizedModelDefinition,
        client: TClient,
        args: Record<string, unknown>,
        info: GraphQLResolveInfo
    ) {
        const delegate = this.getRequiredDelegate(client, model);
        this.assertMethod(delegate, 'update', model);
        const where = this.buildUniqueWhere(model, args);
        const data = this.compileUpdateData(model, this.buildMutationData(args));

        if (delegate.findUnique) {
            const existing = await delegate.findUnique({ where, select: { ...where } });
            if (!existing) {
                return null;
            }
        }

        return delegate.update!({
            where,
            data,
            select: this.buildSelection(model, info.fieldNodes, info),
        });
    }

    private async resolveDeleteMany(
        model: NormalizedModelDefinition,
        client: TClient,
        args: Record<string, unknown>,
        info: GraphQLResolveInfo
    ) {
        const delegate = this.getRequiredDelegate(client, model);
        const where = this.toWhere(model, args.where);
        const returningSelection = this.getReturningSelection(model, info);
        const wantsReturning = Boolean(returningSelection);

        if (!wantsReturning && delegate.deleteMany) {
            const result = await delegate.deleteMany({ where });
            return { affected_rows: result.count, returning: [] };
        }

        this.assertMethod(delegate, 'findMany', model);
        this.assertMethod(delegate, 'delete', model);
        const identitySelection = this.getIdentitySelection(model);
        if (Object.keys(identitySelection).length === 0) {
            throw new Error(`Model "${model.name}" requires a primary key or unique field for delete returning`);
        }
        const rows = await delegate.findMany!({
            where,
            select: wantsReturning
                ? { ...identitySelection, ...(returningSelection ?? {}) }
                : identitySelection,
        });

        const returning = [];
        for (const row of rows as Record<string, unknown>[]) {
            const deleted = await delegate.delete!({
                where: this.buildUniqueWhereFromRecord(model, row),
                select: returningSelection,
            });
            if (wantsReturning) {
                returning.push(deleted ?? row);
            }
        }

        return {
            affected_rows: rows.length,
            returning,
        };
    }

    private async resolveDeleteByPk(
        model: NormalizedModelDefinition,
        client: TClient,
        args: Record<string, unknown>,
        info: GraphQLResolveInfo
    ) {
        const delegate = this.getRequiredDelegate(client, model);
        this.assertMethod(delegate, 'delete', model);
        const where = this.buildUniqueWhere(model, args);

        if (delegate.findUnique) {
            const existing = await delegate.findUnique({ where, select: { ...where } });
            if (!existing) {
                return null;
            }
        }

        return delegate.delete!({
            where,
            select: this.buildSelection(model, info.fieldNodes, info),
        });
    }
}

export function createZenStackGraphQLSchema<
    TClient extends ZenStackClientLike,
    TContext = unknown,
>(options: CreateZenStackGraphQLSchemaOptions<TClient, TContext>) {
    const builder = new SchemaBuilder(options);
    return builder.createSchema();
}
