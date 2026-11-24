# Kora Zol football notification recordings

The updated WAV cues are remixes of genuine, openly licensed field recordings.
No sound effects have been copied from commercial football apps.

## Source credits

- Goal crowd main and layer — Gregor Quendel, Free Crowd Cheering Sounds,
  https://opengameart.org/content/free-crowd-cheering-sounds ,
  licensed under Creative Commons Attribution 4.0 International,
  https://creativecommons.org/licenses/by/4.0/ .
  Two short snippets of this pack were layered, trimmed, faded and amplitude
  normalized, with a subtle ball impact to make the goal cue more immediate.
  Credit: Gregor Quendel. This adaptation does not imply their endorsement.
- Real referee whistle, original and short — SpliceSound,
  https://freesound.org/people/SpliceSound/sounds/218318/ , CC0 1.0.
  Master recordings distributed via GodotVR XR Tools and the Spread Out game.
- Real referee whistle, alternate short — Rosa-Orenes256,
  https://freesound.org/people/Rosa-Orenes256/sounds/538422/ , CC0 1.0.
- Stadium ambience — stomachache,
  https://freesound.org/people/stomachache/sounds/274516/ , CC0 1.0.
- Crowd disappointment reaction — mrrap4food,
  https://freesound.org/people/mrrap4food/sounds/619007/ , CC0 1.0.
- Ball impact — musita182,
  https://freesound.org/people/musita182/sounds/261267/ , CC0 1.0.

CC0: https://creativecommons.org/publicdomain/zero/1.0/

Each event uses real referee whistle sounds or real crowd/football
recordings, mixed at a reduced peak level with short fades for Android alerts.
Output is 16-kHz mono PCM WAV with no music, synthesized melody or dialogue.

Rebuild the original arrangements using Python 3 and ffmpeg:
python3 scripts/generate_notification_sounds.py

The new Android notification-channel IDs have _sound_v2 suffix to select these
new recordings while preserving users' existing _sound_v1 channel settings.
