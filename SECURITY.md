# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately
through [GitHub security advisories](https://github.com/kwy404/kastor/security/advisories/new)
with a description, the affected version, the database and driver involved and,
if you can, a minimal reproduction.

You will get an answer within 7 days. Once the issue is confirmed, a fix is
prepared and released as soon as possible, and you are credited in the release
notes unless you prefer otherwise.

## What counts

kastor sends every value as a bound parameter, including values interpolated
in `$sql`, `$execute` and `sql` templates. Reports are especially welcome for:

- any path where user input reaches the SQL text instead of a parameter
- identifiers or JSON paths that are not quoted correctly for a dialect
- the studio exposing data beyond the local machine
- migration files or `db pull` output that run unexpected statements

`sql.raw()` inserts text as is by design: never pass user input to it.
