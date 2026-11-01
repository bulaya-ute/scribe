// Defect 1 (RUL-honest-errors, SST-error): every error names what failed, carries a
// support code, and includes the real cause text when there is one. Run: npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { fail, classify, CODE, ScribeError } from '../src/errors.js'

test('every failure code has a non-generic message and a support code', () => {
  for (const code of Object.values(CODE)) {
    const e = fail(code, { name: 'x.avi', seconds: 120, size: '2 GB' })
    assert.ok(e instanceof ScribeError)
    assert.equal(e.code, code)
    assert.ok(e.message.length > 40, `message too short for ${code}`)
    assert.doesNotMatch(e.message, /something went wrong/i)
  }
})

test('a model failure includes the real cause text, not only a generic line', () => {
  const e = classify(new Error('Unexpected token < in JSON at position 0'), 'model')
  assert.equal(e.code, CODE.MODEL_DOWNLOAD)
  assert.match(e.message, /Cause: Unexpected token < in JSON at position 0/)
})

test('a transcription failure names the stage-independent cause and a next step', () => {
  const e = classify(new Error('boom'), 'transcribe')
  assert.equal(e.code, CODE.UNKNOWN)
  assert.match(e.message, /Press Try again/)
  assert.match(e.message, /Cause: boom/)
})

test('a memory error maps to the OOM message', () => {
  const e = classify(new Error('Aborted(OOM)'), 'transcribe')
  assert.equal(e.code, CODE.OOM)
  assert.match(e.message, /ran out of memory/)
})

test('long causes are capped so the banner stays readable', () => {
  const e = classify(new Error('x'.repeat(500)), 'model')
  assert.ok(e.message.length < 400)
})
