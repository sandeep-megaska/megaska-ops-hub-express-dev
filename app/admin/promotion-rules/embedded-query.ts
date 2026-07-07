const OAUTH_CALLBACK_ONLY_PARAMS = new Set(["code", "hmac", "signature", "state", "timestamp"]);

type SearchParamValue = string | string[] | undefined;
export type EmbeddedSearchParams = Record<string, SearchParamValue>;

function appendValue(params: URLSearchParams, key: string, value: SearchParamValue) {
  if (value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((entry) => params.append(key, entry));
    return;
  }
  params.set(key, value);
}

export function getEmbeddedContextParams(searchParams: EmbeddedSearchParams) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (OAUTH_CALLBACK_ONLY_PARAMS.has(key)) continue;
    appendValue(params, key, value);
  }
  return params;
}

export function withEmbeddedContext(pathname: string, searchParams: EmbeddedSearchParams, overrides: Record<string, string | null | undefined> = {}) {
  const params = getEmbeddedContextParams(searchParams);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null || value === undefined || value === "") params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

export function embeddedContextHiddenInputs(searchParams: EmbeddedSearchParams) {
  return Array.from(getEmbeddedContextParams(searchParams).entries());
}

export function embeddedContextFromFormData(formData: FormData) {
  const params = new URLSearchParams();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("embeddedContext:")) continue;
    const paramName = key.slice("embeddedContext:".length);
    if (!paramName || OAUTH_CALLBACK_ONLY_PARAMS.has(paramName)) continue;
    params.set(paramName, String(value));
  }
  return params;
}
