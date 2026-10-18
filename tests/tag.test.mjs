import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTag, formatTag, exportName, fromISODate, toISODate } from '../src/tag.js';

const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi);

test('day shift boundaries', () => {
  assert.equal(makeTag(at(2026, 10, 16, 6, 0)), '10/16D');
  assert.equal(makeTag(at(2026, 10, 16, 17, 59)), '10/16D');
});

test('night shift boundaries', () => {
  assert.equal(makeTag(at(2026, 10, 16, 18, 0)), '10/16N');
  assert.equal(makeTag(at(2026, 10, 16, 23, 59)), '10/16N');
  assert.equal(makeTag(at(2026, 10, 17, 0, 0)), '10/16N');
  assert.equal(makeTag(at(2026, 10, 17, 5, 59)), '10/16N');
});

test('month and year rollover after midnight', () => {
  assert.equal(makeTag(at(2026, 11, 1, 3)), '10/31N');
  assert.equal(makeTag(at(2027, 1, 1, 3)), '12/31N');
  assert.equal(makeTag(at(2028, 3, 1, 3)), '2/29N');
});

test('no leading zeros', () => {
  assert.equal(makeTag(at(2026, 3, 6, 9)), '3/6D');
  assert.equal(formatTag(fromISODate('2026-01-05'), 'N'), '1/5N');
});

test('ISO date round trip', () => {
  assert.equal(toISODate(fromISODate('2026-02-09')), '2026-02-09');
});

test('export name uses shift date and wall clock', () => {
  assert.equal(exportName(at(2026, 10, 17, 22, 14)), 'Handoff 10-17N 2214.docx');
  assert.equal(exportName(at(2026, 11, 1, 3, 5)), 'Handoff 10-31N 0305.docx');
});
