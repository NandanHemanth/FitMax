import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module shared with the server
import { extractJson } from '../../server/ai-core.mjs';

describe('extractJson repairs model output', () => {
  it('reads fenced JSON', () => expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 }));
  it('drops prose and trailing commas', () => expect(extractJson('Here: {"a":1,"b":[1,2,],} thanks')).toEqual({ a: 1, b: [1, 2] }));
  it('closes a reply cut off mid-recipe', () => {
    const r = extractJson('{"ingredients":["egg"],"recipes":[{"title":"Omelette","steps":["Whisk"]},{"title":"Panc');
    expect(r.ingredients).toEqual(['egg']);
    expect(r.recipes[0].title).toBe('Omelette');
  });
  it('throws when there is no JSON at all', () => expect(() => extractJson('sorry, I cannot see the image')).toThrow());
});
