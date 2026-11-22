import { describe, expect, it } from 'vitest';
import {
  HELPER_ABSENT_CODE,
  HELPER_SERVERS,
  helperAbsentBody,
  helperServing,
  isHelperAbsent,
} from '../../src/net/helper-absent';

describe('which helper server a path belongs to', () => {
  it('names the helper for its prefix and for anything under it', () => {
    expect(helperServing('/design-api')).toBe('design');
    expect(helperServing('/design-api/brief/validate')).toBe('design');
    expect(helperServing('/deck-api/sets')).toBe('deck');
    expect(helperServing('/feedback-api/status')).toBe('feedback');
    expect(helperServing('/curation-api/state')).toBe('curation');
  });

  it('leaves the page, its files and the two proxied gateways alone', () => {
    for (const pathname of ['/', '/index.html', '/set.json', '/engine-api/sessions', '/api/health']) {
      expect(helperServing(pathname), pathname).toBeNull();
    }
  });

  it('is not taken in by a path that only starts like a prefix', () => {
    for (const { prefix } of HELPER_SERVERS) {
      expect(helperServing(`${prefix}-elsewhere`), prefix).toBeNull();
      expect(helperServing(`/nested${prefix}/x`), prefix).toBeNull();
    }
  });
});

describe('the answer that says a helper is absent', () => {
  it('is recognized by every client that reads it', () => {
    for (const { name } of HELPER_SERVERS) {
      const body: unknown = JSON.parse(JSON.stringify(helperAbsentBody(name)));
      expect(isHelperAbsent(body), name).toBe(true);
      expect(body).toMatchObject({ ok: false, error: { code: HELPER_ABSENT_CODE } });
    }
  });

  it('names the helper in a sentence', () => {
    expect(helperAbsentBody('design').error.message).toBe('this lab runs without the design server');
  });

  it('is not confused with a helper that answered', () => {
    const answered: readonly unknown[] = [
      null,
      undefined,
      'helper-absent',
      [],
      {},
      { ok: false },
      { ok: false, error: 'helper-absent' },
      { ok: false, error: { code: 'gateway-unavailable' } },
      { refused: 'this server was started for editing only, so it runs nothing' },
    ];
    for (const body of answered) expect(isHelperAbsent(body), JSON.stringify(body)).toBe(false);
  });
});
