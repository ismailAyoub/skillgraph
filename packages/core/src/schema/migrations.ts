import { SCHEMA_VERSION, type SkillFile, SkillFileSchema } from './graph';

type Migration = {
  from: number;
  to: number;
  run: (file: Record<string, unknown>) => Record<string, unknown>;
};

/** Ordered chain of pure migrations. Add `{from: 1, to: 2, run}` entries as the schema evolves. */
export const MIGRATIONS: Migration[] = [];

/** Bring any persisted SkillFile up to the current schema version and validate it. */
export function migrate(input: unknown): SkillFile {
  if (typeof input !== 'object' || input === null) {
    throw new Error('SkillFile must be an object');
  }
  let file = { ...(input as Record<string, unknown>) };
  if (typeof file.schemaVersion !== 'number') {
    file.schemaVersion = SCHEMA_VERSION;
  }
  while ((file.schemaVersion as number) < SCHEMA_VERSION) {
    const step = MIGRATIONS.find((m) => m.from === file.schemaVersion);
    if (!step) {
      throw new Error(`No migration from schema version ${file.schemaVersion}`);
    }
    file = step.run(file);
    file.schemaVersion = step.to;
  }
  return SkillFileSchema.parse(file);
}
