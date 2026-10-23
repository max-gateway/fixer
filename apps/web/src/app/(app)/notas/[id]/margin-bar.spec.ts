import { describe, expect, it } from 'vitest';
import { marginLevel } from './margin-bar';

describe('marginLevel', () => {
  it('abaixo do mínimo é perda; entre o mínimo e a meta é atenção; na meta ou acima é ok', () => {
    expect(marginLevel(-5, 20, 30)).toBe('loss');
    expect(marginLevel(19.9, 20, 30)).toBe('loss');
    expect(marginLevel(20, 20, 30)).toBe('below');
    expect(marginLevel(29.9, 20, 30)).toBe('below');
    expect(marginLevel(30, 20, 30)).toBe('ok');
    expect(marginLevel(45, 20, 30)).toBe('ok');
  });

  it('sem meta (regra por markup), só o mínimo conta', () => {
    expect(marginLevel(10, 20, null)).toBe('loss');
    expect(marginLevel(25, 20, null)).toBe('ok');
  });
});
