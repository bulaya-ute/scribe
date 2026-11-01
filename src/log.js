// NFR-obs: client failures produce one structured console error with stage and
// cause. No analytics, no telemetry: nothing leaves the tab.
export function logFailure(stage, err) {
  const record = {
    app: 'scribe',
    stage,
    code: err?.code ?? 'FLM-unknown',
    message: String(err?.message || err),
    cause: err?.cause ? String(err.cause?.message || err.cause) : undefined,
  }
  console.error(JSON.stringify(record))
}
