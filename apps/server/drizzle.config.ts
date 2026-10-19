import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',   // créé avec la tâche 4
  out: './drizzle',
});
