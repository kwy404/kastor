import type { ColumnIR, Dialect } from '../../core/ir';
import { createSqlDialect, decodeValue, defineHooks, encodeValue, jsonPostgres, limitOffset, placeholderDollar, quoteDouble, type SqlHooks } from '../../core/sql';
import { pgDdl, type PgFlavor } from './ddl';
import { mapPgError } from './errors';
import { pgIntrospect } from './introspect';
import { JsonParam } from './values';

/** A Node Buffer is a Uint8Array subclass; hand out plain Uint8Array views. */
function plainBytes(value: unknown): unknown {
  if (value instanceof Uint8Array && value.constructor !== Uint8Array) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return value;
}

export function encodePg(value: unknown, column: ColumnIR | undefined): unknown {
  if (value === undefined || value === null) return null;
  // json goes as a marker so each driver can send it the way it expects.
  if (column?.type === 'json') return new JsonParam(JSON.stringify(value));
  return encodeValue(value, column, { boolean: 'native', datetime: 'date', bigint: 'string' });
}

export function decodePg(value: unknown, column: ColumnIR, source: 'row' | 'json'): unknown {
  return plainBytes(decodeValue(value, column.type, source, 'native'));
}

export function pgHooks(_flavor: PgFlavor): SqlHooks {
  return defineHooks({
    quoteIdent: quoteDouble,
    placeholder: placeholderDollar,
    paginate: limitOffset('ALL'),
    returning: 'returning',
    upsert: 'onConflict',
    json: jsonPostgres,
    caseInsensitive: 'ilike',
    nullsOrder: true,
    encode: encodePg,
    decode: decodePg,
    // The wire protocol numbers parameters with 16 bits.
    maxParams: 65535,
    maxInList: 10000,
    multiRowInsert: true,
    mutationSelfReference: true,
  });
}

export const postgresHooks: SqlHooks = pgHooks('postgres');
export const cockroachHooks: SqlHooks = pgHooks('cockroach');

function makeDialect(flavor: PgFlavor, hooks: SqlHooks): Dialect {
  return createSqlDialect({
    name: flavor,
    hooks,
    features: {
      namedEnums: true,
      // CockroachDB runs schema changes asynchronously and limits them inside transactions.
      transactionalDdl: flavor === 'postgres',
    },
    ddl: (op, schema) => pgDdl(flavor, op, schema),
    introspect: (exec) => pgIntrospect(flavor, exec),
    timestampType: 'TIMESTAMPTZ(3)',
    mapError: mapPgError,
  });
}

/** PostgreSQL 13+ (and anything that speaks it: Neon, Supabase, Vercel Postgres, Aurora). */
export const postgresDialect: Dialect = makeDialect('postgres', postgresHooks);

/** CockroachDB 23.1+. */
export const cockroachDialect: Dialect = makeDialect('cockroach', cockroachHooks);
