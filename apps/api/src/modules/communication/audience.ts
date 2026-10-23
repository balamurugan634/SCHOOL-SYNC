import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { AudienceTargetType } from '@school-sync/shared';
import type { Principal } from '../../core/rbac/principal';
import type { Executor } from '../../core/tenancy/pools';

/**
 * Audience model shared by announcements and events (`audience_targets`).
 *
 *   all                every eligible person
 *   user_type          'student' | 'parent' | 'staff'
 *   role               a role key (system or custom)
 *   grade / section    the students of that grade/section AND their verified guardians
 *
 * "Eligible" means: an active account, and for students an active, non-archived student; for parents at least one
 * *verified* link to an active student (an unverified guardian is never part of any audience); for staff an active
 * staff record. The same semantics are implemented twice, and kept in lock-step by tests:
 *   - `audienceMatchesPrincipal`  – "does this caller belong to the audience of row X?" (feeds, detail reads)
 *   - `audienceUsersSql`          – "which users belong to the audience of rows X?" (fan-out, delivery stats)
 */

export type OwnerType = 'announcement' | 'event';

export interface AudienceTargetInput {
  type: AudienceTargetType;
  id?: string | null;
}

const join = (parts: SQL[], sep: SQL) => sql.join(parts, sep);
const list = (values: string[]) => join(values.map((v) => sql`${v}`), sql`, `);

/** Children whose grade/section can put this caller in an audience (own record for students, verified children for parents). */
function learnerIds(p: Principal): string[] {
  if (p.userType === 'student') return p.studentId ? [p.studentId] : [];
  if (p.userType === 'parent') return p.linkedStudentIds;
  return [];
}

/**
 * SQL predicate over an owner id column: true when the caller belongs to at least one audience target of that owner.
 * `staffBySection` (events only) additionally lets staff match section/grade targets of the sections they lead or teach.
 */
export function audienceMatchesPrincipal(p: Principal, ownerType: OwnerType, ownerId: AnyColumn | SQL, opts: { staffBySection?: boolean } = {}): SQL {
  const ids = learnerIds(p);
  // a parent with no verified child belongs to no audience at all
  if (p.userType === 'parent' && !ids.length) return sql`false`;

  const conds: SQL[] = [sql`t.target_type = 'all'`, sql`(t.target_type = 'user_type' and t.target_id = ${p.userType})`];
  if (p.roles.length) conds.push(sql`(t.target_type = 'role' and t.target_id in (${list(p.roles)}))`);
  if (ids.length) {
    conds.push(sql`(t.target_type = 'grade' and t.target_id in (select s.current_grade_id::text from students s where s.id in (${list(ids)})))`);
    conds.push(sql`(t.target_type = 'section' and t.target_id in (select s.current_section_id::text from students s where s.id in (${list(ids)})))`);
  } else if (opts.staffBySection && p.assignedSectionIds.length) {
    conds.push(sql`(t.target_type = 'section' and t.target_id in (${list(p.assignedSectionIds)}))`);
    conds.push(sql`(t.target_type = 'grade' and t.target_id in (select sec.grade_id::text from sections sec where sec.id in (${list(p.assignedSectionIds)})))`);
  }
  return sql`exists (select 1 from audience_targets t where t.owner_type = ${ownerType} and t.owner_id = ${ownerId} and (${join(conds, sql` or `)}))`;
}

/**
 * `select distinct owner_id, uid` — every user in the audience of the given owners. `ownerFilter` is a SQL condition over
 * `t.owner_id` (e.g. `t.owner_id = $1` or `t.owner_id in (...)`).
 */
export function audienceUsersSql(ownerType: OwnerType, ownerFilter: SQL): SQL {
  return sql`
    select distinct t.owner_id as owner_id, e.uid as uid
    from audience_targets t
    join (
      select s.user_id as uid, 'student' as utype, s.current_grade_id as gid, s.current_section_id as sid
        from students s where s.user_id is not null and s.status = 'active' and s.archived_at is null
      union all
      select g.user_id, 'parent', s.current_grade_id, s.current_section_id
        from student_guardians sg
        join students s on s.id = sg.student_id and s.status = 'active' and s.archived_at is null
        join guardians g on g.id = sg.guardian_id and g.user_id is not null
        where sg.verified_at is not null
      union all
      select st.user_id, 'staff', null::uuid, null::uuid from staff st where st.user_id is not null and st.status in ('active', 'on_leave')
    ) e on (
      t.target_type = 'all'
      or (t.target_type = 'user_type' and e.utype = t.target_id)
      or (t.target_type = 'grade' and e.gid::text = t.target_id)
      or (t.target_type = 'section' and e.sid::text = t.target_id)
      or (t.target_type = 'role' and exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = e.uid and r.key = t.target_id))
    )
    join users u on u.id = e.uid and u.status = 'active'
    where t.owner_type = ${ownerType} and ${ownerFilter}`;
}

/** Users who belong to the audience of one owner. */
export async function resolveAudienceUserIds(db: Executor, ownerType: OwnerType, ownerId: string): Promise<string[]> {
  const res = await db.execute<{ uid: string }>(audienceUsersSql(ownerType, sql`t.owner_id = ${ownerId}`));
  return res.rows.map((r) => r.uid);
}

/** Students (not users) an event's audience covers — the denominator for registration/consent counts. */
export function audienceStudentsSql(eventId: SQL | string): SQL {
  return sql`
    select s.id as student_id
    from students s
    where s.status = 'active' and s.archived_at is null and exists (
      select 1 from audience_targets t
      where t.owner_type = 'event' and t.owner_id = ${eventId} and (
        t.target_type = 'all'
        or (t.target_type = 'user_type' and t.target_id in ('student', 'parent'))
        or (t.target_type = 'role' and t.target_id in ('student', 'parent'))
        or (t.target_type = 'grade' and t.target_id = s.current_grade_id::text)
        or (t.target_type = 'section' and t.target_id = s.current_section_id::text)
      )
    )`;
}
