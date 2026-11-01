// Unit tests for the pure logic (RUL-markdown-shape, RUL-chunking). Run: npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMarkdown, trimOverlap, titleOf, baseNameOf, fmtClock } from '../src/markdown.js'
import { fail, CODE, classify, ScribeError } from '../src/errors.js'

test('fmtClock', () => {
  assert.equal(fmtClock(6), '0:06')
  assert.equal(fmtClock(75), '1:15')
  assert.equal(fmtClock(3725), '1:02:05')
})

test('file names: title and download base', () => {
  assert.equal(titleOf('/x/My_talk-final.mp4'), 'My talk final')
  assert.equal(baseNameOf('C:\\videos\\clip.name.webm'), 'clip.name')
  assert.equal(baseNameOf(''), 'transcript')
})

test('trimOverlap drops the repeated seam words', () => {
  const prev = 'and then we walked home through the old market'
  const next = 'through the old market and the rain began'
  assert.equal(trimOverlap(prev, next), 'and the rain began')
})

test('trimOverlap keeps text that does not repeat', () => {
  assert.equal(trimOverlap('hello there', 'completely different words here'), 'completely different words here')
})

test('markdown shape with timestamps: H1, meta quote, H2, one paragraph per chunk', () => {
  const md = buildMarkdown({
    sourceName: 'Demo_clip.mp4',
    duration: 61,
    language: 'fr',
    withTimestamps: true,
    chunks: [
      { start: 0, text: 'Bonjour à tous.' },
      { start: 30, text: 'Merci.' },
    ],
  })
  assert.match(md, /^# Demo clip\n/)
  assert.match(md, /> Transcribed on-device · 1:01 · whisper-base \(q8\) · language: French \(fr\)/)
  assert.match(md, /## Transcript\n\n\*\*\[0:00\]\*\* Bonjour à tous\.\n\n\*\*\[0:30\]\*\* Merci\.\n$/)
})

test('markdown shape without timestamps: one flowing paragraph; auto language reads as detected', () => {
  const md = buildMarkdown({
    sourceName: 'a.wav',
    duration: 5,
    language: 'auto',
    withTimestamps: false,
    chunks: [{ start: 0, text: 'One.' }, { start: 30, text: 'Two.' }],
  })
  assert.match(md, /language: auto-detected/)
  assert.match(md, /## Transcript\n\nOne\. Two\.\n$/)
  assert.doesNotMatch(md, /\*\*\[/)
})

test('empty transcript says so instead of printing a blank section', () => {
  const md = buildMarkdown({ sourceName: 'silence.wav', duration: 3, language: 'en', withTimestamps: true, chunks: [{ start: 0, text: '  ' }] })
  assert.match(md, /_No speech was recognised in this file\._/)
})

test('failure messages name the cause and the next action', () => {
  const e = fail(CODE.DECODE, { name: 'x.avi' })
  assert.ok(e instanceof ScribeError)
  assert.equal(e.code, 'FLM-decode')
  assert.match(e.message, /Accepted formats: MP4/)
  const oom = classify(new Error('Aborted(OOM)'), 'transcribe')
  assert.equal(oom.code, 'FLM-oom')
  assert.match(oom.message, /ran out of memory/)
  const mdl = classify(new Error('network down'), 'model')
  assert.equal(mdl.code, 'FLM-model-download')
  assert.doesNotMatch(mdl.message, /something went wrong/i)
})
