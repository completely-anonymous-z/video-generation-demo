# Annotation pipeline and screenplay format

[Supplementary results](https://completely-anonymous-z.github.io/video-generation-demo/rebuttal/) · [Original demos](https://completely-anonymous-z.github.io/video-generation-demo/)

This document contains the operational details and full serialization example accompanying the paper's annotation protocol.

## Complete screenplay example

[Open the complete serialized screenplay](screenplay_example.txt).

The example pairs a woman on the left with a man in a dark coat and scarf on the right. The man says "I'm sorry." The woman then exits frame-left while the man turns his head to his own left. The paper includes the conditioning image and explains the character bindings.

The six outer sections are `SCENE`, `VISIBLE_MAIN_CHARACTER`, `EVENT_SEQUENCE`, `AUDIO_CAPTION`, `SUBJECT`, and `ATMOSPHERE`. Cast entries use ordinal tags. A persistent `speaker_n` ID identifies a recurring voice; the identity phrase connects that voice to a visible cast entry, independently of cast order. Dialogue fields appear in the order `<voice>`, `<character_id>`, `<words: LANGUAGE>`.

## Visual-prior service

Kwai Keye-VL-2.0-30B-A3B uses the audited v3.2 visual prompt. Video sampling is 2 fps. Each frame receives between 128 × 28² and 512 × 28² input pixels, with a clip-level budget of 180 × 1024 × 28² pixels. Decoding uses temperature 0.1, top-p 0.001, top-k 1, and at most 6,144 output tokens.

The deployment uses one service per H200 with tensor-parallel size 1, eight services per node, and six nodes. These deployment choices determine throughput.

The prompt prohibits audio, dialogue, subtitle transcription, mouth-motion descriptions, and chain-of-thought output. It requests a visible-character block with count, appearance, posture, frame position and actions, followed by a chronological event-sequence block. Events name concrete actors. Frame-left/right describes frame position; body-side labels are anatomical, and turns preferably name a visible target.

The parser removes leaked thinking text, normalizes common angle-tag spacing errors, and extracts the supported blocks. The v3.2 gate requires both blocks and their canonical closing tags, nonempty bodies, a positive character count, at least one appearance/ordinal field, balanced critical angle tags, and no truncated tail.

A failed item is retried once on another endpoint. Valid outputs are deduplicated by absolute video path and exported with the keys `video` and `keye_event_auxiliary`. A later successful retry takes precedence.

## Audio records and joining

The input manifest stores the transcript under `qwenasr`, together with a detected language label. TV and movie manifests use Qwen3-ASR; other sources use the corresponding Qwen ASR annotations in their manifests.

An empty transcript means ASR returned no spoken text and is distinct from missing annotation metadata. Auxiliary records are joined only by canonicalized absolute video path. Basename matching is disabled because independent datasets can reuse filenames.

## Gemini fusion

Gemini receives the original clip at 5 fps, with text before the video payload. The text includes the audio prior and, when available, the visual prior. Multi-person, movie and TV subsets use Gemini 3.5 Flash; the remaining subsets use Gemini 3 Flash. Exact served model identifiers and access dates are recorded in the internal annotation logs.

Decoding uses temperature 0, top-p 1, top-k 1 and high reasoning effort. Service-side decoding need not be bit-exact.

The prompt preserves the words and language in the audio prior. Visual descriptions are candidate observations checked against the clip; unsupported actions are discarded. A two-pass audio check precedes speaker assignment. Each voice description includes a gender cue, an optional age class and a tone/emotion phrase. Audio determines acoustic fields, while visible evidence determines scene and event fields. An unavailable visual prior is a soft failure. SyncNet and legacy human-face-count priors are not supplied.

## Validation, retries and storage

The final gate accepts structured-description-only output with all six outer sections, stable speaker IDs and at least one event. It checks tag closure, event/dialogue nesting, required voice/character/words fields, language labels and coarse voice-identity compatibility. It rejects bare speech, words unsupported by the audio prior, inconsistent language labels, Latin words introduced into Chinese speech and repeated Chinese characters beyond their transcript counts.

Invalid records receive one fresh generation. Records that still fail are excluded from training and recorded as failures. The pipeline does not truncate an invalid record to make it pass, since removing a late event would change the supervision. Text checks complement the preceding multimodal verification of actions and speaker binding.

An append-only JSONL output and SQLite database in write-ahead logging (WAL) mode track successful items. Resumption uses successful-item keys to avoid duplicate API work.

## Evaluation input conventions

Verse-Bench scoring extracts mono PCM audio from each generated video. The benchmark's reference speech text is stored in `speech_prompt.text`; SenseVoice transcriptions are compared with this reference for WER. The paper retains metric definitions, eligibility rules and aggregation procedures.
