#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { importHasuraToZModel } from '../hasura-importer.js';

type CliOptions = {
    metadataDir?: string;
    databaseUrl?: string;
    sourceName?: string;
    out?: string;
    includeViews: boolean;
    schemaFilter: string[];
    stdout: boolean;
    report: boolean;
    help: boolean;
};

const HELP_TEXT = `Usage: zenstack-graphql-hasura-import --metadata-dir <dir> --database-url <url> [options]

Options:
  --metadata-dir <dir>     Path to a Hasura metadata export directory
  --database-url <url>     Postgres connection string for live introspection
  --source <name>          Hasura source name to import (default: default)
  --out <file>             Write the generated ZModel to a file
  --stdout                 Write the generated ZModel to stdout
  --report                 Write an import summary to stderr
  --include-views [bool]   Include tracked views (default: true)
  --schema-filter <list>   Comma-separated list of schemas to include
  -h, --help               Show this help text
`;

export function parseArgs(argv: string[]): CliOptions {
    const options: CliOptions = {
        includeViews: true,
        schemaFilter: [],
        stdout: false,
        report: false,
        help: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        const next = argv[index + 1];
        switch (arg) {
            case '--metadata-dir':
                options.metadataDir = next;
                index++;
                break;
            case '--database-url':
                options.databaseUrl = next;
                index++;
                break;
            case '--source':
                options.sourceName = next;
                index++;
                break;
            case '--out':
                options.out = next;
                index++;
                break;
            case '--include-views':
                options.includeViews = next === undefined || next !== 'false';
                if (next && !next.startsWith('--')) {
                    index++;
                }
                break;
            case '--schema-filter':
                if (next) {
                    options.schemaFilter.push(...next.split(',').map((entry) => entry.trim()).filter(Boolean));
                    index++;
                }
                break;
            case '--stdout':
                options.stdout = true;
                break;
            case '--report':
                options.report = true;
                break;
            case '--help':
            case '-h':
                options.help = true;
                break;
            default:
                if (arg.startsWith('--')) {
                    throw new Error(`Unknown argument: ${arg}`);
                }
                break;
        }
    }

    return options;
}

function renderReport(result: Awaited<ReturnType<typeof importHasuraToZModel>>['result']) {
    const lines = [
        `Imported source: ${result.sourceName}`,
        `Imported tables: ${result.summary.importedTables}`,
        `Imported views: ${result.summary.importedViews}`,
        `Commented view stubs: ${result.summary.commentedViewStubs}`,
        `Roles translated: ${result.summary.rolesTranslated}`,
        `Permissions translated: ${result.summary.permissionsTranslated}`,
        `Permissions with TODOs: ${result.summary.permissionsWithTodos}`,
        `Unsupported operators: ${
            Object.keys(result.summary.unsupportedOperators).length > 0
                ? JSON.stringify(result.summary.unsupportedOperators)
                : '{}'
        }`,
    ];

    if (result.warnings.length > 0) {
        lines.push('Warnings:');
        for (const warning of result.warnings) {
            lines.push(`- ${warning.scope}: ${warning.message}`);
        }
    }

    return lines.join('\n');
}

export async function runHasuraImportCli(argv: string[]) {
    const options = parseArgs(argv);
    if (options.help) {
        process.stdout.write(HELP_TEXT);
        return;
    }
    if (!options.metadataDir) {
        throw new Error('--metadata-dir is required');
    }
    if (!options.databaseUrl) {
        throw new Error('--database-url is required');
    }
    if (!options.stdout && !options.out) {
        throw new Error('--out is required unless --stdout is used');
    }

    const imported = await importHasuraToZModel({
        metadataDir: path.resolve(options.metadataDir),
        databaseUrl: options.databaseUrl,
        sourceName: options.sourceName,
        includeViews: options.includeViews,
        schemaFilter: options.schemaFilter,
    });

    if (options.stdout) {
        process.stdout.write(imported.zmodel);
    } else if (options.out) {
        await fs.writeFile(path.resolve(options.out), imported.zmodel, 'utf8');
    }

    if (options.report) {
        process.stderr.write(renderReport(imported.result) + '\n');
    }
}

function isExecutedDirectly() {
    const argvPath = process.argv[1];
    if (!argvPath) {
        return false;
    }

    try {
        return pathToFileURL(realpathSync(argvPath)).href === import.meta.url;
    } catch {
        return pathToFileURL(path.resolve(argvPath)).href === import.meta.url;
    }
}

if (isExecutedDirectly()) {
    runHasuraImportCli(process.argv.slice(2)).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`import-hasura-to-zmodel failed: ${message}\n`);
        process.exitCode = 1;
    });
}
