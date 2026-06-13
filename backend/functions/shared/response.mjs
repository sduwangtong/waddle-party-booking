// JSON responses. CORS is handled by the API Gateway HTTP API CorsConfiguration
// (see template.yaml) — the Lambda must NOT also set Access-Control-* headers,
// or the browser sees duplicate values and rejects the response.
const headers = { 'Content-Type': 'application/json' };

export const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
export const ok = body => json(200, body);
export const badRequest = message => json(400, { error: message });
export const conflict = body => json(409, body);
export const serverError = message => json(500, { error: message || 'Internal error' });
