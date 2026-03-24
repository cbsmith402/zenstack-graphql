import type {
    EnumDefinition,
    FieldDefinition,
    ModelDefinition,
    NormalizedEnumDefinition,
    NormalizedFieldDefinition,
    NormalizedModelDefinition,
    NormalizedProcedureDefinition,
    NormalizedProcedureParamDefinition,
    NormalizedSchema,
    NormalizedTypeDefDefinition,
    ProcedureDefinition,
    ProviderCapabilities,
    ProcedureTypeKind,
    TypeDefDefinition,
    UniqueConstraintDefinition,
    ZenStackSchemaLike,
} from './types.js';

const BUILTIN_SCALARS = new Set([
    'String',
    'Boolean',
    'Int',
    'Float',
    'BigInt',
    'Decimal',
    'DateTime',
    'Bytes',
    'Json',
    'ID',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasFieldAttribute(
    field: Record<string, unknown>,
    attributeName: string
) {
    if (!Array.isArray(field.attributes)) {
        return false;
    }

    return field.attributes.some(
        (attribute) => isPlainObject(attribute) && attribute.name === attributeName
    );
}

function getFieldNativeType(field: Record<string, unknown>) {
    if (typeof field.nativeType === 'string' && field.nativeType.length > 0) {
        return field.nativeType;
    }

    if (!Array.isArray(field.attributes)) {
        return undefined;
    }

    for (const attribute of field.attributes) {
        if (!isPlainObject(attribute) || typeof attribute.name !== 'string') {
            continue;
        }
        if (attribute.name.startsWith('@db.')) {
            return attribute.name.slice(4);
        }
    }

    return undefined;
}

function normalizeField(
    fieldName: string,
    field: FieldDefinition | Record<string, unknown>,
    enumNames: Set<string>,
    typeDefNames: Set<string>,
    modelNames: Set<string>,
    uniqueFieldNames: Set<string>
): NormalizedFieldDefinition {
    const generatedField = field as Record<string, unknown>;
    const kind: NormalizedFieldDefinition['kind'] =
        'kind' in generatedField && typeof generatedField.kind === 'string'
            ? (generatedField.kind as NormalizedFieldDefinition['kind'])
            : generatedField.relation
              ? 'relation'
              : enumNames.has(String(generatedField.type))
                ? 'enum'
                : typeDefNames.has(String(generatedField.type))
                  ? 'typeDef'
                : modelNames.has(String(generatedField.type))
                  ? 'relation'
                : 'scalar';

    const relation = isPlainObject(generatedField.relation) ? generatedField.relation : undefined;

    return {
        ...(generatedField as unknown as Partial<NormalizedFieldDefinition>),
        name:
            ('name' in generatedField && typeof generatedField.name === 'string'
                ? generatedField.name
                : fieldName),
        kind,
        type: String(generatedField.type),
        isList:
            ('isList' in generatedField && typeof generatedField.isList === 'boolean'
                ? generatedField.isList
                : Boolean(generatedField.array)),
        isNullable:
            ('isNullable' in generatedField && typeof generatedField.isNullable === 'boolean'
                ? generatedField.isNullable
                : Boolean(generatedField.optional)),
        isId:
            ('isId' in generatedField && typeof generatedField.isId === 'boolean'
                ? generatedField.isId
                : Boolean(generatedField.id)),
        isUnique:
            ('isUnique' in generatedField && typeof generatedField.isUnique === 'boolean'
                ? generatedField.isUnique
                : uniqueFieldNames.has(fieldName)),
        isReadOnly:
            ('isReadOnly' in generatedField && typeof generatedField.isReadOnly === 'boolean'
                ? generatedField.isReadOnly
                : hasFieldAttribute(generatedField, '@computed')),
        isComputed:
            ('isComputed' in generatedField && typeof generatedField.isComputed === 'boolean'
                ? generatedField.isComputed
                : hasFieldAttribute(generatedField, '@computed')),
        nativeType:
            ('nativeType' in generatedField && typeof generatedField.nativeType === 'string'
                ? generatedField.nativeType
                : getFieldNativeType(generatedField)),
        foreignKeyFields:
            ('foreignKeyFields' in generatedField && Array.isArray(generatedField.foreignKeyFields)
                ? (generatedField.foreignKeyFields as string[])
                : Array.isArray(relation?.fields)
                  ? (relation.fields as string[])
                  : undefined),
        referenceFields:
            ('referenceFields' in generatedField && Array.isArray(generatedField.referenceFields)
                ? (generatedField.referenceFields as string[])
                : Array.isArray(relation?.references)
                  ? (relation.references as string[])
                  : undefined),
    };
}

function normalizeFields(
    fields: ModelDefinition['fields'],
    enumNames: Set<string>,
    typeDefNames: Set<string>,
    modelNames: Set<string>,
    uniqueFieldNames: Set<string>
): NormalizedFieldDefinition[] {
    if (Array.isArray(fields)) {
        return fields.map((field) =>
            normalizeField(field.name, field, enumNames, typeDefNames, modelNames, uniqueFieldNames)
        );
    }

    return Object.entries(fields).map(([fieldName, field]) =>
        normalizeField(fieldName, field, enumNames, typeDefNames, modelNames, uniqueFieldNames)
    );
}

function normalizeUniqueConstraints(
    fields: NormalizedFieldDefinition[],
    constraints: UniqueConstraintDefinition[] | undefined
): UniqueConstraintDefinition[] {
    const result = constraints ? [...constraints] : [];
    for (const field of fields) {
        if (field.isId || field.isUnique) {
            result.push({ fields: [field.name] });
        }
    }

    const seen = new Set<string>();
    return result.filter((constraint) => {
        const key = constraint.fields.join('|');
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function normalizeModel(
    modelName: string,
    model: ModelDefinition & Record<string, unknown>,
    enumNames: Set<string>,
    typeDefNames: Set<string>,
    modelNames: Set<string>
): NormalizedModelDefinition {
    const generatedUniqueFields = isPlainObject(model.uniqueFields) ? model.uniqueFields : undefined;
    const generatedUniqueConstraints = generatedUniqueFields
        ? Object.keys(generatedUniqueFields).map((fieldName) => ({ fields: [fieldName] }))
        : undefined;
    const uniqueFieldNames = new Set(Object.keys(generatedUniqueFields ?? {}));
    const fields = normalizeFields(model.fields, enumNames, typeDefNames, modelNames, uniqueFieldNames);
    const uniqueConstraints = normalizeUniqueConstraints(
        fields,
        model.uniqueConstraints ?? generatedUniqueConstraints
    );
    const primaryKey =
        model.primaryKey ??
        (Array.isArray(model.idFields) ? (model.idFields as string[]) : undefined) ??
        fields
            .filter((field) => field.isId)
            .map((field) => field.name);

    return {
        name: model.name ?? modelName,
        dbName: model.dbName,
        description: model.description,
        fields,
        fieldMap: new Map(fields.map((field) => [field.name, field])),
        primaryKey,
        uniqueConstraints,
    };
}

function normalizeTypeDef(
    typeDefName: string,
    typeDef: TypeDefDefinition & Record<string, unknown>,
    enumNames: Set<string>,
    typeDefNames: Set<string>,
    modelNames: Set<string>
): NormalizedTypeDefDefinition {
    const fields = normalizeFields(
        typeDef.fields,
        enumNames,
        typeDefNames,
        modelNames,
        new Set<string>()
    );
    return {
        name: typeDef.name ?? typeDefName,
        description: typeDef.description,
        fields,
        fieldMap: new Map(fields.map((field) => [field.name, field])),
    };
}

function resolveProcedureTypeKind(
    type: string,
    enumNames: Set<string>,
    typeDefNames: Set<string>,
    modelNames: Set<string>
): ProcedureTypeKind {
    if (enumNames.has(type)) {
        return 'enum';
    }
    if (typeDefNames.has(type)) {
        return 'typeDef';
    }
    if (modelNames.has(type)) {
        return 'model';
    }
    return 'scalar';
}

function normalizeProcedureParams(
    params: ProcedureDefinition['params'],
    enumNames: Set<string>,
    typeDefNames: Set<string>,
    modelNames: Set<string>
): NormalizedProcedureParamDefinition[] {
    const entries = Array.isArray(params)
        ? params
        : Object.entries(params ?? {}).map(([paramName, param]) => ({
              name: paramName,
              ...(param as Record<string, unknown>),
          }));

    return entries.map((param) => {
        const raw = param as Record<string, unknown>;
        const type = String(raw.type);
        return {
            name: String(raw.name),
            type,
            kind: resolveProcedureTypeKind(type, enumNames, typeDefNames, modelNames),
            isList:
                ('isList' in raw && typeof raw.isList === 'boolean'
                    ? raw.isList
                    : Boolean(raw.array)),
            isNullable:
                ('isNullable' in raw && typeof raw.isNullable === 'boolean'
                    ? raw.isNullable
                    : Boolean(raw.optional)),
            nativeType:
                ('nativeType' in raw && typeof raw.nativeType === 'string'
                    ? raw.nativeType
                    : getFieldNativeType(raw)),
        };
    });
}

function normalizeProcedure(
    procedureName: string,
    procedure: ProcedureDefinition & Record<string, unknown>,
    enumNames: Set<string>,
    typeDefNames: Set<string>,
    modelNames: Set<string>
): NormalizedProcedureDefinition {
    const returnType = String(procedure.returnType);
    return {
        name: procedure.name ?? procedureName,
        description: procedure.description,
        params: normalizeProcedureParams(procedure.params, enumNames, typeDefNames, modelNames),
        returnType,
        returnKind: resolveProcedureTypeKind(returnType, enumNames, typeDefNames, modelNames),
        returnArray: Boolean(procedure.returnArray),
        mutation: Boolean(procedure.mutation),
    };
}

function normalizeEnum(enumName: string, enumDefinition: EnumDefinition): NormalizedEnumDefinition {
    const values = Array.isArray(enumDefinition.values)
        ? enumDefinition.values
        : Object.keys(enumDefinition.values);
    return {
        name: enumDefinition.name ?? enumName,
        values,
        description: enumDefinition.description,
    };
}

export function normalizeSchema(schema: ZenStackSchemaLike | ModelDefinition[]): NormalizedSchema {
    const schemaInput: ZenStackSchemaLike = Array.isArray(schema)
        ? { models: schema }
        : schema;

    const modelsRaw = schemaInput.models ?? schemaInput.modelMeta;
    const enumsRaw = schemaInput.enums ?? schemaInput.enumMeta;
    const typeDefsRaw = schemaInput.typeDefs ?? schemaInput.typeDefMeta;
    const proceduresRaw = schemaInput.procedures ?? schemaInput.procedureMeta;

    const enums = Array.isArray(enumsRaw)
        ? enumsRaw.map((entry) => normalizeEnum(entry.name, entry as EnumDefinition))
        : Object.entries(enumsRaw ?? {}).map(([enumName, entry]) =>
              normalizeEnum(enumName, { ...(entry as EnumDefinition), name: enumName })
          );
    const enumNames = new Set(enums.map((entry) => entry.name));
    const rawModelNames = new Set(
        Array.isArray(modelsRaw)
            ? modelsRaw.map((entry) => entry.name)
            : Object.keys(modelsRaw ?? {})
    );
    const rawTypeDefNames = new Set(
        Array.isArray(typeDefsRaw)
            ? typeDefsRaw.map((entry) => entry.name)
            : Object.keys(typeDefsRaw ?? {})
    );
    const typeDefs = Array.isArray(typeDefsRaw)
        ? typeDefsRaw.map((entry) =>
              normalizeTypeDef(
                  entry.name,
                  entry as TypeDefDefinition & Record<string, unknown>,
                  enumNames,
                  rawTypeDefNames,
                  rawModelNames
              )
          )
        : Object.entries(typeDefsRaw ?? {}).map(([typeDefName, entry]) =>
              normalizeTypeDef(
                  typeDefName,
                  { ...(entry as TypeDefDefinition), name: typeDefName } as TypeDefDefinition & Record<string, unknown>,
                  enumNames,
                  rawTypeDefNames,
                  rawModelNames
              )
          );
    const typeDefNames = new Set(typeDefs.map((entry) => entry.name));
    const models = Array.isArray(modelsRaw)
        ? modelsRaw.map((model) =>
              normalizeModel(
                  model.name,
                  model as ModelDefinition & Record<string, unknown>,
                  enumNames,
                  typeDefNames,
                  rawModelNames
              )
          )
        : Object.entries(modelsRaw ?? {}).map(([modelName, model]) =>
              normalizeModel(
                  modelName,
                  { ...(model as ModelDefinition), name: modelName } as ModelDefinition & Record<string, unknown>,
                  enumNames,
                  typeDefNames,
                  rawModelNames
              )
          );
    const modelNames = new Set(models.map((model) => model.name));
    const procedures = Array.isArray(proceduresRaw)
        ? proceduresRaw.map((entry) =>
              normalizeProcedure(
                  entry.name ?? '',
                  entry as ProcedureDefinition & Record<string, unknown>,
                  enumNames,
                  typeDefNames,
                  modelNames
              )
          )
        : Object.entries(proceduresRaw ?? {}).map(([procedureName, entry]) =>
              normalizeProcedure(
                  procedureName,
                  { ...(entry as ProcedureDefinition), name: procedureName } as ProcedureDefinition & Record<string, unknown>,
                  enumNames,
                  typeDefNames,
                  modelNames
              )
          );

    return {
        provider: schemaInput.provider
            ? {
                  type:
                      typeof schemaInput.provider.type === 'string'
                          ? schemaInput.provider.type.toLowerCase()
                          : schemaInput.provider.type,
              }
            : undefined,
        models,
        modelMap: new Map(models.map((model) => [model.name, model])),
        enums,
        enumMap: new Map(enums.map((entry) => [entry.name, entry])),
        typeDefs,
        typeDefMap: new Map(typeDefs.map((typeDef) => [typeDef.name, typeDef])),
        procedures,
        procedureMap: new Map(procedures.map((procedure) => [procedure.name, procedure])),
    };
}

export function getProviderType(schema: NormalizedSchema) {
    return schema.provider?.type?.toLowerCase() ?? 'unknown';
}

export function getProviderCapabilities(schema: NormalizedSchema): ProviderCapabilities {
    const provider = getProviderType(schema);
    return {
        provider,
        supportsInsensitiveMode: provider !== 'sqlite',
        supportsDistinctOn: provider !== 'sqlite' && provider !== 'mysql',
        supportsJsonFilters: provider !== 'unknown',
        supportsJsonFilterMode: provider === 'postgresql',
        supportsScalarListFilters: provider === 'postgresql',
    };
}

export function getIdentifierFields(model: NormalizedModelDefinition): string[] {
    if (model.primaryKey.length > 0) {
        return model.primaryKey;
    }

    const firstUnique = model.uniqueConstraints[0];
    if (firstUnique) {
        return firstUnique.fields;
    }

    return model.fields.filter((field) => field.isId || field.isUnique).map((field) => field.name);
}

export function getPrimaryKeyFields(model: NormalizedModelDefinition): string[] {
    return model.primaryKey;
}

export function getUniqueFieldSets(model: NormalizedModelDefinition): string[][] {
    const result: string[][] = [];
    if (model.primaryKey.length > 0) {
        result.push(model.primaryKey);
    }

    for (const constraint of model.uniqueConstraints) {
        result.push(constraint.fields);
    }

    const seen = new Set<string>();
    return result.filter((fields) => {
        const key = fields.join('|');
        if (!key || seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

export function getScalarFields(model: NormalizedModelDefinition) {
    return model.fields.filter((field) => field.kind === 'scalar' || field.kind === 'enum');
}

export function getRelationFields(model: NormalizedModelDefinition) {
    return model.fields.filter((field) => field.kind === 'relation');
}

export function isNumericScalar(type: string) {
    return type === 'Int' || type === 'Float' || type === 'Decimal' || type === 'BigInt';
}

export function isComparableScalar(type: string) {
    return (
        type === 'String' ||
        type === 'Int' ||
        type === 'Float' ||
        type === 'Decimal' ||
        type === 'BigInt' ||
        type === 'DateTime' ||
        type === 'ID'
    );
}

export function isMutableField(field: NormalizedFieldDefinition, exposeInternalFields: boolean) {
    if (field.kind === 'relation') {
        return false;
    }
    if (field.isReadOnly || field.isComputed) {
        return false;
    }
    if (!exposeInternalFields && field.isInternal) {
        return false;
    }
    return true;
}
