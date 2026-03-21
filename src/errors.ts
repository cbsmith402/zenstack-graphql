import { GraphQLError } from 'graphql';

const AUTH_NAMES = new Set(['ZenStackAuthError', 'ForbiddenError', 'UnauthorizedError']);
const VALIDATION_NAMES = new Set(['ZenStackValidationError', 'ValidationError']);
const NOT_FOUND_NAMES = new Set(['NotFoundError', 'ZenStackNotFoundError']);

export function normalizeError(error: unknown): GraphQLError {
    if (error instanceof GraphQLError) {
        return error;
    }

    const candidate = error as { name?: string; message?: string; code?: string; details?: unknown };
    const message = candidate?.message ?? 'Unexpected GraphQL adapter failure';
    const code = getErrorCode(candidate);
    const extensions: Record<string, unknown> = { code };

    if (candidate?.details !== undefined) {
        extensions.details = candidate.details;
    }

    if (candidate?.code && typeof candidate.code === 'string') {
        extensions.originalCode = candidate.code;
    }

    return new GraphQLError(message, { extensions });
}

function getErrorCode(error: { name?: string; code?: string; message?: string } | undefined) {
    if (!error) {
        return 'INTERNAL_SERVER_ERROR';
    }

    if (AUTH_NAMES.has(error.name ?? '')) {
        return 'FORBIDDEN';
    }

    if (VALIDATION_NAMES.has(error.name ?? '')) {
        return 'BAD_USER_INPUT';
    }

    if (NOT_FOUND_NAMES.has(error.name ?? '')) {
        return 'NOT_FOUND';
    }

    if (typeof error.code === 'string' && error.code.length > 0) {
        return error.code;
    }

    return 'INTERNAL_SERVER_ERROR';
}
