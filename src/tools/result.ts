export function errorResult(msg: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true };
}

export function okResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data ?? null, null, 2) }] };
}
