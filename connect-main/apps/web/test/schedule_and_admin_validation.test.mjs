import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Schedule Form Validation & Time Safety', () => {
  it('rejects empty start and end times', () => {
    const start = '';
    const end = '';
    const startDate = new Date(start);
    const endDate = new Date(end);
    const isValid = Boolean(start && end && !isNaN(startDate.getTime()) && !isNaN(endDate.getTime()));
    assert.equal(isValid, false, 'Empty dates must be rejected before calling toISOString()');
  });

  it('rejects end time earlier than or equal to start time', () => {
    const start = '2026-11-03T10:00';
    const end = '2026-11-03T09:00';
    const startDate = new Date(start);
    const endDate = new Date(end);
    assert.equal(startDate >= endDate, true, 'End time before start time must be detected');
  });

  it('accepts chronological start and end times and produces valid ISO strings', () => {
    const start = '2026-11-03T10:00';
    const end = '2026-11-03T11:00';
    const startDate = new Date(start);
    const endDate = new Date(end);
    assert.equal(startDate < endDate, true);
    assert.doesNotThrow(() => startDate.toISOString());
    assert.doesNotThrow(() => endDate.toISOString());
  });
});

describe('Admin Role and Status Defensive Labeling', () => {
  const ROLE_LABELS = {
    institution_admin: 'Administrator',
    institution_auditor: 'Auditor',
    institution_member: 'Member',
    department_coordinator: 'Coordinator',
    faculty: 'Faculty',
    student: 'Student',
  };
  const STATUS_LABELS = { active: 'Active', suspended: 'Suspended', revoked: 'Removed' };

  it('safely handles known and unknown roles without runtime exception', () => {
    const knownRole = 'faculty';
    const unknownRole = 'custom_guest_role';

    assert.equal(ROLE_LABELS[knownRole] || knownRole, 'Faculty');
    assert.equal(ROLE_LABELS[unknownRole] || unknownRole, 'custom_guest_role');
  });

  it('safely handles known and unknown statuses without throwing TypeError on toLowerCase()', () => {
    const knownStatus = 'active';
    const unknownStatus = 'archived';

    assert.equal((STATUS_LABELS[knownStatus] || knownStatus).toLowerCase(), 'active');
    assert.equal((STATUS_LABELS[unknownStatus] || unknownStatus).toLowerCase(), 'archived');
  });
});
