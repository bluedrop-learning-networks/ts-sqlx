import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPgFixture, type PgFixture } from '@ts-sqlx/test-utils';

describe('PgFixture', () => {
  let fixture: PgFixture;

  beforeAll(async () => {
    fixture = await createPgFixture();
    await fixture.setup();
  });

  afterAll(async () => {
    await fixture.teardown();
  });

  it('provides a connected adapter', () => {
    expect(fixture.adapter.isConnected()).toBe(true);
  });

  it('can describe queries against fixture schema', async () => {
    const info = await fixture.adapter.describeQuery(
      'SELECT id, email FROM users WHERE id = $1'
    );
    expect(info.columns).toHaveLength(2);
    expect(info.params).toHaveLength(1);
  });

  it('returns accurate nullability', async () => {
    const info = await fixture.adapter.describeQuery(
      'SELECT email, name FROM users'
    );
    const byName = Object.fromEntries(info.columns.map(c => [c.name, c]));
    expect(byName.email.nullable).toBe(false);  // NOT NULL
    expect(byName.name.nullable).toBe(true);     // nullable
  });
});
