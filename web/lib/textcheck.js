/**
 * Text analysis: plagiarism overlap and AI-generation indicators.
 *
 * A direct port of backend/textcheck.py. The tuning constants, the six
 * weighted signals and the verdict bands are unchanged, so a given document
 * scores the same here as it did under Python.
 *
 * Two very different problems, deliberately kept apart because their evidence
 * is of completely different quality:
 *
 * * **Plagiarism** is *measurable*. Given a reference text, the shared-n-gram
 *   overlap between two documents is an exact quantity, and the matching
 *   passages can be pointed at. The percentage means something precise.
 *
 * * **AI-generated text** is *not* reliably measurable. There is no signal
 *   that separates machine from human prose the way a face-swap artefact
 *   separates a forgery from a photograph. What is computable is a set of
 *   stylistic statistics that skew differently on average - sentence-length
 *   variance, vocabulary diversity, repetition, and phrasing that current
 *   models overuse. Those are indicators, not proof, and the output says so.
 *
 * The honest framing matters here: published AI-text detectors routinely
 * misclassify human writing, and the consequences (accusing a student of
 * cheating) are serious. This module reports the individual signals alongside
 * the score so a reader can judge them, and it never returns a bare verdict.
 */

import { pyRound, pyFixed, round1, clamp01 } from './num.js'

// --------------------------------------------------------------------- tuning
export const MIN_WORDS = 40   // below this, every statistic is noise
export const NGRAM = 5        // shingle size for overlap; long enough that a match
                              // is unlikely to be coincidental

// Phrases current large language models produce far more often than people do.
// Presence is weak evidence on its own, which is why it is one signal of six.
const LLM_PHRASES = [
  'delve into', 'it is important to note', "it's important to note",
  'in conclusion', 'furthermore', 'moreover', "in today's world",
  'navigate the complexities', 'rich tapestry', 'a testament to',
  'plays a crucial role', 'it is worth noting', 'in the realm of',
  'underscores the importance', 'multifaceted', 'ever-evolving',
  'shed light on', 'at the end of the day', 'when it comes to',
  'the landscape of', 'paves the way', 'cannot be overstated',
]

// Built fresh per use: a /g regex carries mutable lastIndex, so a shared
// instance would produce different results depending on what ran before it.
const WORD = () => /[a-z0-9']+/g
const SENTENCE = () => /[^.!?]+[.!?]*/g


function words(text) {
  return text.toLowerCase().match(WORD()) ?? []
}

function sentences(text) {
  return (text.match(SENTENCE()) ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Sentences with character offsets into the original text.
 *
 * Offsets rather than substrings, so the UI can mark a passage in place with
 * its original capitalisation and punctuation intact.
 */
function sentenceSpans(text) {
  const spans = []
  for (const m of text.matchAll(SENTENCE())) {
    const raw = m[0]
    const stripped = raw.trim()
    if (!stripped) continue
    const lead = raw.length - raw.trimStart().length
    const start = m.index + lead
    spans.push({ start, end: start + stripped.length, text: stripped })
  }
  return spans
}

/**
 * Word n-grams, keyed as strings.
 *
 * Python used tuples, which are hashable; JavaScript has no tuple key, so the
 * words are joined on NUL. The tokenizer only ever emits [a-z0-9'] so NUL
 * cannot occur inside a word and the join is unambiguous.
 */
function shingles(ws, n = NGRAM) {
  const out = []
  for (let i = 0; i < Math.max(0, ws.length - n + 1); i++) {
    out.push(ws.slice(i, i + n).join('\u0000'))
  }
  return out
}

function counter(items) {
  const m = new Map()
  for (const it of items) m.set(it, (m.get(it) ?? 0) + 1)
  return m
}


// ----------------------------------------------------------------- plagiarism
/**
 * Exact n-gram overlap between a document and a reference.
 *
 * Uses word 5-grams: long enough that a shared run is very unlikely to be
 * coincidental, short enough to survive light paraphrasing of the surrounding
 * sentence.
 *
 * The percentage is the share of the submitted text's 5-grams that also appear
 * in the reference - a real measurement, not an estimate.
 */
export function checkPlagiarism(text, reference) {
  const ws = words(text)
  const refWords = words(reference || '')

  if (ws.length < NGRAM) {
    return { available: false, reason: `Need at least ${NGRAM} words to compare.` }
  }
  if (refWords.length < NGRAM) {
    return {
      available: false,
      reason: 'Paste a reference text to compare against. Without one there is '
            + 'nothing to measure overlap with - this compares two documents, it '
            + 'does not search the web.',
    }
  }

  const doc = shingles(ws)
  const ref = new Set(shingles(refWords))

  const matchedFlags = doc.map((s) => ref.has(s))
  const matched = matchedFlags.filter(Boolean).length
  const overlap = doc.length ? matched / doc.length : 0.0

  // Which word positions fall inside a matching run. A shingle at index i
  // covers words i..i+NGRAM-1, so a hit marks all of them.
  const flagged = new Array(ws.length).fill(false)
  matchedFlags.forEach((hit, i) => {
    if (!hit) return
    for (let j = i; j < Math.min(i + NGRAM, ws.length); j++) flagged[j] = true
  })

  // Character offsets into the ORIGINAL text, so the UI can highlight the
  // passage in place rather than showing a reconstructed lowercase copy.
  // Walking the original with the same tokenizer keeps the two in step.
  const spans = []
  const positions = [...text.toLowerCase().matchAll(WORD())]
    .map((m) => [m.index, m.index + m[0].length])

  let runStart = null
  for (let i = 0; i <= ws.length; i++) {
    const inside = i < ws.length && flagged[i]
    if (inside && runStart === null) {
      runStart = i
    } else if (!inside && runStart !== null) {
      const startChar = positions[runStart][0]
      const endChar = positions[i - 1][1]
      spans.push({
        start: startChar,
        end: endChar,
        words: i - runStart,
        text: text.slice(startChar, endChar),
      })
      runStart = null
    }
  }

  const passages = spans.map((s) => s.text).sort((a, b) => b.length - a.length)

  return {
    available: true,
    overlap_percent: round1(overlap * 100),
    matched_ngrams: matched,
    total_ngrams: doc.length,
    ngram_size: NGRAM,
    matched_passages: passages.slice(0, 12),
    // Character ranges, in document order, for inline highlighting.
    matched_spans: [...spans].sort((a, b) => a.start - b.start),
    flagged_words: flagged.filter(Boolean).length,
    total_words: ws.length,
    longest_match_words: spans.length ? Math.max(...spans.map((s) => s.words)) : 0,
    verdict:
      overlap >= 0.25 ? 'HIGH'
      : overlap >= 0.10 ? 'MODERATE'
      : overlap >= 0.03 ? 'LOW'
      : 'MINIMAL',
    note: "Share of this text's 5-word sequences that also appear in the reference. "
        + 'This is an exact measurement against the text you provided; it does not '
        + 'search the internet.',
  }
}

// ------------------------------------------------------------- AI indicators
/**
 * Coefficient of variation of sentence length.
 *
 * Human prose mixes long and short sentences; generated prose tends toward a
 * uniform rhythm. Higher means more human-like variation.
 */
function burstiness(sents) {
  const lengths = sents.map((s) => words(s).length).filter((n) => n > 0)
  if (lengths.length < 3) return 0.0
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length
  if (mean === 0) return 0.0
  const varr = lengths.reduce((a, x) => a + (x - mean) ** 2, 0) / lengths.length
  return Math.sqrt(varr) / mean
}

/**
 * Stylistic indicators associated with machine-generated prose.
 *
 * Deliberately returns the component signals as well as a combined score. None
 * of these is decisive, and the combination is not a detector - it is a summary
 * of how the writing compares to typical human prose on measurable axes.
 */
export function checkAiText(text) {
  const ws = words(text)
  const sents = sentences(text)

  if (ws.length < MIN_WORDS) {
    return {
      available: false,
      reason: `Need at least ${MIN_WORDS} words; got ${ws.length}. `
            + 'Short samples cannot support any of these statistics.',
    }
  }

  const lowered = text.toLowerCase()

  // 1. Burstiness - low variation leans machine.
  const burst = burstiness(sents)
  const burstSignal = clamp01((0.55 - burst) / 0.45)

  // 2. Vocabulary diversity, length-normalised so long texts are not punished.
  const unique = new Set(ws).size
  const ttr = unique / ws.length
  const expectedTtr = Math.max(0.28, 0.85 - 0.06 * Math.log(Math.max(ws.length, 2)))
  const diversitySignal = clamp01((expectedTtr - ttr) / Math.max(expectedTtr, 1e-6))

  // 3. Repeated 5-grams within the text itself.
  const sh = shingles(ws)
  const shingleCounts = counter(sh)
  let repeats = 0
  for (const c of shingleCounts.values()) if (c > 1) repeats += c - 1
  const repeatRatio = sh.length ? repeats / sh.length : 0.0
  const repeatSignal = Math.min(1.0, repeatRatio * 12)

  // 4. Phrases current models overuse.
  const foundPhrases = LLM_PHRASES.filter((p) => lowered.includes(p))
  const phraseSignal = Math.min(1.0, foundPhrases.length / 4)

  // 5. Sentence-length uniformity in absolute terms.
  const lengths = sents.map((s) => words(s).length).filter((n) => n > 0)
  const avgLen = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0
  const uniformSignal = avgLen ? clamp01((avgLen - 14) / 16) : 0.0

  // 6. Punctuation variety - generated prose leans on commas and full stops.
  const marks = counter([...text].filter((c) => ',;:-()"\'?!'.includes(c)))
  const variety = marks.size / 10
  const punctSignal = clamp01(1 - variety)

  const signals = [
    ['Sentence-length variation', burstSignal, 0.28,
      `coefficient of variation ${pyFixed(burst, 2)}`,
      'Human writing mixes long and short sentences more than generated text.'],
    ['Vocabulary diversity', diversitySignal, 0.20,
      `${unique} unique of ${ws.length} words (${pyFixed(ttr, 2)})`,
      'Lower-than-expected diversity for this length.'],
    ['Internal repetition', repeatSignal, 0.16,
      `${repeats} repeated 5-grams`,
      'Repeated phrasing within the same passage.'],
    ['Model-typical phrasing', phraseSignal, 0.16,
      foundPhrases.length ? foundPhrases.slice(0, 5).join(', ') : 'none found',
      'Phrases current language models overuse.'],
    ['Sentence length', uniformSignal, 0.10,
      `${pyFixed(avgLen, 1)} words average`,
      'Consistently long sentences are more common in generated prose.'],
    ['Punctuation variety', punctSignal, 0.10,
      `${marks.size} distinct marks`,
      'Narrow punctuation range.'],
  ]

  const score = signals.reduce((acc, [, value, weight]) => acc + value * weight, 0)

  // ---------------------------------------------------------------- regions
  // Which sentences look most machine-like, so the result can point at
  // passages rather than only scoring the document as a whole.
  //
  // Only signals that are meaningful for a single sentence are used here.
  // Burstiness and length-normalised vocabulary diversity are properties of a
  // document and say nothing about one sentence, so including them would
  // invent precision that is not there.
  const repeated = new Set(
    [...shingleCounts.entries()].filter(([, c]) => c > 1).map(([s]) => s),
  )

  const flaggedSentences = []
  for (const span of sentenceSpans(text)) {
    const sWords = words(span.text)
    if (sWords.length < 6) continue

    const sLower = span.text.toLowerCase()
    const reasons = []
    let sScore = 0.0

    const hits = LLM_PHRASES.filter((p) => sLower.includes(p))
    if (hits.length) {
      sScore += Math.min(1.0, hits.length / 2) * 0.55
      reasons.push('model-typical phrasing: ' + hits.slice(0, 3).join(', '))
    }

    // Long sentences relative to this document, not an absolute threshold.
    if (avgLen && sWords.length > avgLen * 1.35 && sWords.length > 20) {
      sScore += 0.2
      reasons.push(`${sWords.length} words, well above this document's average`)
    }

    const sShingles = shingles(sWords)
    if (sShingles.length) {
      const repHere = sShingles.filter((s) => repeated.has(s)).length
      if (repHere) {
        sScore += Math.min(1.0, repHere / sShingles.length) * 0.25
        reasons.push('phrasing repeated elsewhere in the text')
      }
    }

    const sUnique = new Set(sWords).size
    if (sWords.length >= 12 && sUnique / sWords.length < 0.6) {
      sScore += 0.15
      reasons.push('low word variety within the sentence')
    }

    if (sScore >= 0.3 && reasons.length) {
      flaggedSentences.push({
        start: span.start,
        end: span.end,
        strength: round1(Math.min(1.0, sScore) * 100),
        reasons,
        words: sWords.length,
      })
    }
  }

  const flaggedWords = flaggedSentences.reduce((a, f) => a + f.words, 0)

  return {
    available: true,
    ai_likelihood_percent: round1(score * 100),
    // Character ranges for inline marking, in document order.
    flagged_sentences: flaggedSentences,
    flagged_word_count: flaggedWords,
    total_word_count: ws.length,
    confidence: 'low',          // deliberate: see the module docstring
    verdict:
      score >= 0.65 ? 'STRONG INDICATORS'
      : score >= 0.45 ? 'SOME INDICATORS'
      : score >= 0.25 ? 'FEW INDICATORS'
      : 'MINIMAL INDICATORS',
    word_count: ws.length,
    sentence_count: sents.length,
    signals: signals.map(([name, value, weight, detail, meaning]) => ({
      name,
      strength: round1(value * 100),
      weight: pyRound(weight * 100),
      detail,
      meaning,
    })),
    note: 'These are stylistic statistics, not a detector. Published AI-text '
        + 'detectors misclassify human writing regularly, and no signal here is '
        + 'decisive. Treat a high score as a reason to look closer - never as '
        + 'evidence on its own.',
  }
}

/** Run whichever checks were requested. */
export function analyze(text, reference = '', wantPlagiarism = true, wantAi = true) {
  const t = (text || '').trim()
  if (!t) throw new Error('No text provided.')

  const result = {
    word_count: words(t).length,
    character_count: t.length,
    sentence_count: sentences(t).length,
    checks_run: [],
  }

  if (wantPlagiarism) {
    result.plagiarism = checkPlagiarism(t, reference)
    result.checks_run.push('plagiarism')
  }
  if (wantAi) {
    result.ai_text = checkAiText(t)
    result.checks_run.push('ai_text')
  }

  if (!result.checks_run.length) throw new Error('Select at least one check.')

  return result
}
