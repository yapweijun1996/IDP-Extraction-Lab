const MAX_MESSAGE_LENGTH = 500;

function safeString(value, max = MAX_MESSAGE_LENGTH) {
  return String(value ?? '')
    .replace(/data:[^\s,]+;base64,[A-Za-z0-9+/=]+/gi, '[image data redacted]')
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, 'AIza...[redacted]')
    .replace(/(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, '$1...[redacted]')
    .replace(/\b(authorization|api[_ -]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/[A-Za-z]:\\[^\r\n]+/g, '[local path redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, max);
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeList(value, max = 24) {
  return Array.isArray(value) ? value.slice(0, max).map((item) => safeString(item, 240)) : [];
}

function safeBbox(value) {
  if (!value || typeof value !== 'object') return null;
  const numbers = [value.x, value.y, value.width, value.height].map(Number);
  if (!numbers.every(Number.isFinite)) return null;
  const [x, y, width, height] = numbers;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) return null;
  return { x, y, width, height };
}

export function safeTraceEvent(event = {}) {
  const metrics = event.metrics && typeof event.metrics === 'object' ? {
    latency_ms: finite(event.metrics.latency_ms),
    input_tokens: finite(event.metrics.input_tokens),
    output_tokens: finite(event.metrics.output_tokens),
    total_tokens: finite(event.metrics.total_tokens),
    image_bytes: finite(event.metrics.image_bytes)
  } : null;
  const bbox = safeBbox(event.bbox);
  const decisions = Array.isArray(event.decisions) ? event.decisions.slice(0, 24).map((decision) => ({
    field_path: safeString(decision?.field_path, 240),
    decision: safeString(decision?.decision, 40),
    reason: safeString(decision?.reason, 160)
  })) : [];
  return {
    seq: finite(event.seq),
    at: safeString(event.at, 48),
    runId: safeString(event.runId, 80),
    phase: safeString(event.phase, 80),
    step: safeString(event.step, 100),
    status: safeString(event.status, 40),
    ...(finite(event.page) !== null ? { page: finite(event.page) } : {}),
    ...(event.call_id ? { call_id: safeString(event.call_id, 80) } : {}),
    ...(event.target_id ? { target_id: safeString(event.target_id, 240) } : {}),
    ...(event.inspection_id ? { inspection_id: safeString(event.inspection_id, 120) } : {}),
    ...(event.error_code ? { error_code: safeString(event.error_code, 100) } : {}),
    ...(event.rejection_reason ? { rejection_reason: safeString(event.rejection_reason, 120) } : {}),
    ...(event.localization_source ? { localization_source: safeString(event.localization_source, 80) } : {}),
    ...(safeList(event.target_ids).length ? { target_ids: safeList(event.target_ids) } : {}),
    ...(safeList(event.field_paths).length ? { field_paths: safeList(event.field_paths) } : {}),
    ...(safeList(event.issue_codes).length ? { issue_codes: safeList(event.issue_codes) } : {}),
    ...(bbox ? { bbox } : {}),
    ...(decisions.length ? { decisions } : {}),
    ...(metrics ? { metrics } : {}),
    message: safeString(event.message)
  };
}

export function safeTraceNdjson(events = []) {
  const list = Array.isArray(events) ? events : [];
  return list.map(safeTraceEvent).map((event) => JSON.stringify(event)).join('\n') + (list.length ? '\n' : '');
}

export function traceMetricsLabel(event = {}) {
  const parts = [];
  if (event.call_id) parts.push(event.call_id);
  if (Number.isFinite(Number(event.metrics?.latency_ms))) parts.push(`${Math.round(Number(event.metrics.latency_ms))} ms`);
  if (Number.isFinite(Number(event.metrics?.total_tokens))) parts.push(`${Number(event.metrics.total_tokens)} tokens`);
  if (event.error_code) parts.push(event.error_code);
  return parts.join(' · ');
}
