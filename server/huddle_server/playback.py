"""A compact AAC copy of each meeting's audio for the browser player.

Browsers scrub a 16 kHz WAV by fetching byte ranges from the server; that works but every seek
is a round trip and the file is large. An AAC rendition is a fifth of the size, caches well and
seeks instantly. It is made once, in the background, the first time the audio is played."""
from __future__ import annotations

import logging
import threading
from pathlib import Path

log = logging.getLogger("huddle.server.playback")
NAME = "playback.m4a"
_busy: set[str] = set()
_lock = threading.Lock()


def transcode(src: Path, dst: Path) -> None:
    import av

    tmp = dst.with_name(dst.name + ".part")
    with av.open(str(src)) as inp, av.open(str(tmp), "w", format="mp4", options={"movflags": "faststart"}) as out:
        s_in = inp.streams.audio[0]
        layout = "stereo" if s_in.channels > 1 else "mono"
        rate = min(s_in.rate, 48000)
        s_out = out.add_stream("aac", rate=rate)
        s_out.layout = layout
        s_out.bit_rate = 64000 if layout == "stereo" else 40000
        resampler = av.AudioResampler(format="fltp", layout=layout, rate=rate)
        for frame in inp.decode(s_in):
            for f in resampler.resample(frame):
                out.mux(s_out.encode(f))
        out.mux(s_out.encode(None))
    tmp.replace(dst)


def path_for(source: str, meeting_id: str) -> Path:
    """The rendition for `source` (the engine's playback file), made in the background when missing."""
    src = Path(source)
    dst = src.with_name(NAME)
    if dst.exists():
        return dst
    with _lock:
        if meeting_id in _busy:
            return src
        _busy.add(meeting_id)

    def work() -> None:
        try:
            transcode(src, dst)
            log.info("playback rendition ready for %s (%d KB)", meeting_id, dst.stat().st_size // 1024)
        except Exception:
            log.exception("playback rendition failed for %s", meeting_id)
            dst.with_name(dst.name + ".part").unlink(missing_ok=True)
        finally:
            with _lock:
                _busy.discard(meeting_id)

    threading.Thread(target=work, name=f"playback-{meeting_id}", daemon=True).start()
    return src


def remove(source: str | None) -> None:
    if source:
        Path(source).with_name(NAME).unlink(missing_ok=True)
