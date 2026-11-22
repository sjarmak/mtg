export function withArticle(name: string): string {
  return `${/^[aeiou]/iu.test(name) ? 'an' : 'a'} ${name}`;
}
