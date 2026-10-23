import { timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

/** UUIDv7 primary key — time-ordered, so inserts stay index-local on big tables. */
export const pk = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const createdAt = () => ts('created_at').notNull().defaultNow();
export const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
