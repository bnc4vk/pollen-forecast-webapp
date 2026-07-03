# Video Feedback to Codex Experiment

## Objective

Evaluate whether Codex can use attached desktop screen recordings as bug-fix instructions for a visually observed pollen-map bug.

The experiment compared four instruction paths:

- transcript provided directly in the prompt;
- video-only input where Codex extracted/transcribed the narration;
- video-only input where audio transcription failed and Codex relied on frames;
- a second video-only, no-transcription run to check repeatability.

## Bug Description

The core bug involved the pollen forecast map briefly showing an incorrect stale, lower-granularity, or region-level tile overlay during interactions between forecast playback, timelapse state, pollen category selection, and map granularity.

The visible failure mode was a short-lived display of the wrong spatial overlay before the intended finer-grained map state appeared.

## Experimental Setup

Each run started from the same project context and attempted to fix the same visually observed map-overlay bug on a separate local branch. The input artifact was a desktop screen recording of the bug, with narration available in the recording. Depending on the run, Codex either received a transcript directly, successfully extracted narration from the video, or failed to transcribe the audio and used sampled video frames as the bug-fix instruction.

The experiment assessed whether Codex could:

- access an attached `.mov` file as a local artifact;
- sample or extract frames from the video;
- infer the bug from visual evidence;
- extract/transcribe audio narration reliably;
- produce a successful bug fix from transcript plus video, transcribed audio plus video, or video-only instruction.

## Runs

| Run | Branch | Input type | Audio transcription succeeded | Video frames only | Actual bug fixed | Verification / validation | Notes / caveats |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `codex/fix-map-grid-provided-transcription` | Transcript provided directly in prompt, with video context available | Not applicable; transcript was provided | No | Yes | Browser validation of the original forecast/category/granularity interaction. Branch commit: `fix tile bug with prompt transcript`. | Introduced a new bug during any zoom change where the map temporarily shows regional granularity. |
| 2 | `codex/fix-map-grid-auto-transcribed` | Video-only input; Codex extracted/transcribed audio narration and used it as instruction | Yes | No | Yes | Browser validation of the original interaction after Codex audio extraction. Branch commit: `fix with auto-transcription from codex whisper usage`. | Introduced new behavior where forecast auto-plays on a newly selected tile after pollen data loads; pausing that auto-play temporarily shows region-level granularity. |
| 3 | `codex/fix-map-grid-no-transcription` | Video-only input; audio transcription failed | No | Yes | Yes | Browser validation using visual behavior from sampled frames. Branch commit: `test without transcription`. | Introduced the same auto-play behavior and pause bug as run 2, plus a new bug where initial pollen category tile selection temporarily shows regional granularity. |
| 4 | `codex/fix-map-grid-no-transcription-2` | Video-only input; audio transcription failed | No | Yes | Yes | Browser validation using visual behavior from sampled frames. Branch commit: `grid fix w/o transcription 2`. | Same results as run 3, plus two more zoom-change regressions: temporary display of regional granularity and pollen category tiles disappearing. |

## Overall Conclusions

- Codex can access attached `.mov` files as local artifacts.
- Codex can sample or extract frames from attached video files and reason from the visual state shown in those frames.
- Audio transcription is possible, but it is unreliable unless explicitly required and suitable transcription tooling is available.
- For this bug, video-only visual inspection was sufficient in some runs to identify and fix the original issue, but that result should not be generalized too broadly.
- If narration matters, transcript generation should be treated as a deterministic preprocessing step or as a hard-gated Codex task before implementation begins.
- All four runs fixed the target bug, but each branch introduced some regression risk. The branches should be preserved as experiment artifacts, not treated as production-ready fixes without further review.

