import { describe, expect, it } from 'vitest';
import { callWithFallback, type GeminiResponse } from '../src/gas/gemini';

function run(responses: Record<string, number[]>) {
  const calls: string[] = [];
  const sleeps: number[] = [];
  const res = callWithFallback(
    ['custom', 'gemini-flash-latest', 'gemini-flash-lite-latest'],
    (model): GeminiResponse => {
      calls.push(model);
      const code = responses[model]?.shift() ?? 200;
      return { code, body: String(code) };
    },
    (ms) => sleeps.push(ms),
  );
  return { res, calls, sleeps };
}

describe('Geminiの再試行と切り替え', () => {
  it('混雑（503）は待って同じモデルで再試行する', () => {
    const r = run({ custom: [503] });
    expect(r.res.code).toBe(200);
    expect(r.calls).toEqual(['custom', 'custom']);
    expect(r.sleeps).toEqual([2000]);
  });

  it('再試行してもだめなら次のモデルへ', () => {
    const r = run({ custom: [503, 503, 503], 'gemini-flash-latest': [429, 429, 429] });
    expect(r.res.code).toBe(200);
    expect(r.calls).toEqual(['custom', 'custom', 'custom', 'gemini-flash-latest', 'gemini-flash-latest', 'gemini-flash-latest', 'gemini-flash-lite-latest']);
  });

  it('モデルが見つからない（404）ときは待たずに次へ', () => {
    const r = run({ custom: [404] });
    expect(r.calls).toEqual(['custom', 'gemini-flash-latest']);
    expect(r.sleeps).toEqual([]);
  });

  it('キー不正など（400/403）はモデルを変えずにそのまま返す', () => {
    const r = run({ custom: [403] });
    expect(r.res.code).toBe(403);
    expect(r.calls).toEqual(['custom']);
  });

  it('同じモデル名は1回だけ試す', () => {
    const calls: string[] = [];
    callWithFallback(['gemini-flash-latest', 'gemini-flash-latest', ''], (m) => (calls.push(m), { code: 404, body: '' }), () => {});
    expect(calls).toEqual(['gemini-flash-latest']);
  });
});
