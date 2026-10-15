/** Shared browser/API boundary; never derive the allowed origin from proxy headers. */
export class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function assertTrustedMutation(request: Request): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const configured = process.env.APP_URL;
  if (!configured && process.env.NODE_ENV === 'production') {
    throw new RequestError('APP_URL не настроен', 503);
  }
  const allowed = new URL(configured || 'http://localhost:3000').origin;
  if (request.headers.get('origin') !== allowed
    || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new RequestError('Источник запроса не разрешён', 403);
  }
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (request.method !== 'DELETE' && !['application/json', 'multipart/form-data'].includes(type ?? '')) {
    // Empty-body actions (logout/report/re-extract) use fetch without content-type.
    if (type || request.headers.get('content-length') !== '0') {
      const action = new URL(request.url).pathname;
      if (!/\/(logout|report|extract)$/.test(action) || type) {
        throw new RequestError('Ожидается JSON или multipart/form-data', 415);
      }
    }
  }
}

/** Count bytes actually read: Content-Length is an optional early check only. */
export async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array> {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    throw new RequestError('Превышен допустимый размер запроса', 413);
  }
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new RequestError('Превышен допустимый размер запроса', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    throw new RequestError('Ожидается application/json', 415);
  }
  try { return JSON.parse(new TextDecoder().decode(await readBoundedBody(request, 1_048_576))); }
  catch (e) { if (e instanceof RequestError) throw e; throw new RequestError('Некорректный JSON', 400); }
}

export async function readUploadForm(request: Request, maxFileBytes: number): Promise<FormData> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    throw new RequestError('Ожидается multipart/form-data', 415);
  }
  const bytes = await readBoundedBody(request, maxFileBytes + 65_536);
  let form: FormData;
  try { form = await new Response(new Uint8Array(bytes), { headers: { 'content-type': contentType } }).formData(); }
  catch { throw new RequestError('Некорректная форма загрузки', 400); }
  const entries = [...form.entries()];
  if (entries.length > 8 || entries.filter(([, v]) => v instanceof File).length !== 1
    || entries.some(([k,v]) => k.length > 100 || (typeof v === 'string' && v.length > 4000))) {
    throw new RequestError('Превышены ограничения формы загрузки', 422);
  }
  return form;
}
