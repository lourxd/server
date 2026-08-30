/** @type {import('drizzle-kit').Config} */
export default {
  schema: './src/lib/server/store/schema.js',
  out: './src/lib/server/store/migrations',
  dialect: 'sqlite',
  dbCredentials: { url: './data/panel.db' },
};
