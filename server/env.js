// Load .env from the project root if there is one (local development). Real environment
// variables win, so settings made on the host (e.g. Render's Environment tab) are never overridden.
// Imported first by server.js: ES modules run in import order, and server/auth.js reads the env when it loads.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(file)) process.loadEnvFile(file);
