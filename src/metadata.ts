import type {
    EnumDefinition,
    FieldDefinition,
    ModelDefinition,
    NormalizedEnumDefinition,
    NormalizedFieldDefinition,
    NormalizedModelDefinition,
    NormalizedSchema,
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

function normalizeField(
    fieldName: string,
    field: FieldDefinition | Record<string, unknown>,
    enumNames: Set<string>,
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
    uniqueFieldNames: Set<string>
): NormalizedFieldDefinition[] {
    if (Array.isArray(fields)) {
        return fields.map((field) => normalizeField(field.name, field, enumNames, uniqueFieldNames));
    }

    return Object.entries(fields).map(([fieldName, field]) =>
        normalizeField(fieldName, field, enumNames, uniqueFieldNames)
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
    enumNames: Set<string>
): NormalizedModelDefinition {
    const generatedUniqueFields = isPlainObject(model.uniqueFields) ? model.uniqueFields : undefined;
    const generatedUniqueConstraints = generatedUniqueFields
        ? Object.keys(generatedUniqueFields).map((fieldName) => ({ fields: [fieldName] }))
        : undefined;
    const uniqueFieldNames = new Set(Object.keys(generatedUniqueFields ?? {}));
    const fields = normalizeFields(model.fields, enumNames, uniqueFieldNames);
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

    const enums = Array.isArray(enumsRaw)
        ? enumsRaw.map((entry) => normalizeEnum(entry.name, entry as EnumDefinition))
        : Object.entries(enumsRaw ?? {}).map(([enumName, entry]) =>
              normalizeEnum(enumName, { ...(entry as EnumDefinition), name: enumName })
          );
    const enumNames = new Set(enums.map((entry) => entry.name));
    const models = Array.isArray(modelsRaw)
        ? modelsRaw.map((model) =>
              normalizeModel(model.name, model as ModelDefinition & Record<string, unknown>, enumNames)
          )
        : Object.entries(modelsRaw ?? {}).map(([modelName, model]) =>
              normalizeModel(
                  modelName,
                  { ...(model as ModelDefinition), name: modelName } as ModelDefinition & Record<string, unknown>,
                  enumNames
              )
          );

    return {
        provider: schemaInput.provider,
        models,
        modelMap: new Map(models.map((model) => [model.name, model])),
        enums,
        enumMap: new Map(enums.map((entry) => [entry.name, entry])),
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
