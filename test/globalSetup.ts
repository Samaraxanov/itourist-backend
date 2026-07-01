import { execSync } from 'node:child_process';

// Runs once before the whole test run: ensure the test database schema is current.
export default function setup() {
  const url =
    process.env.TEST_DATABASE_URL ??
    `postgresql://${process.env.USER}@localhost:5432/tour_marketplace_test?schema=public`;
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
