/**
 * An employee as the screens name one, from a table alias of `employee`: the preferred name, or the first, and the last.
 * The same form the workspace shows the signed-in employee (identity/sessions.ts).
 */
export const employeeName = (alias: string): string => `coalesce(${alias}.preferred_name, ${alias}.first_name) || ' ' || ${alias}.last_name`;
