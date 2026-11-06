import { Composition } from "remotion";
import { CaptionsCheck, loadCaptions } from "./compositions/CaptionsCheck";
import { Smoke } from "./compositions/Smoke";
import { loadStoryClipRun, StoryClip } from "./formats/story-clip/StoryClip";
import { loadTalkingCloseupRun, TalkingCloseup } from "./formats/talking-closeup/TalkingCloseup";
import { REEL_FPS, REEL_HEIGHT, REEL_WIDTH } from "./reel";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Smoke"
        component={Smoke}
        durationInFrames={5 * REEL_FPS}
        fps={REEL_FPS}
        width={REEL_WIDTH}
        height={REEL_HEIGHT}
      />
      <Composition
        id="CaptionsCheck"
        component={CaptionsCheck}
        calculateMetadata={loadCaptions}
        defaultProps={{ audioFile: "audio/fragment.wav", wordsFile: "timing/words.json", words: [] }}
        durationInFrames={REEL_FPS}
        fps={REEL_FPS}
        width={REEL_WIDTH}
        height={REEL_HEIGHT}
      />
      <Composition
        id="TalkingCloseup"
        component={TalkingCloseup}
        calculateMetadata={loadTalkingCloseupRun}
        defaultProps={{ scenesFile: "scenes.json", run: null }}
        durationInFrames={REEL_FPS}
        fps={REEL_FPS}
        width={REEL_WIDTH}
        height={REEL_HEIGHT}
      />
      <Composition
        id="StoryClip"
        component={StoryClip}
        calculateMetadata={loadStoryClipRun}
        defaultProps={{ scenesFile: "scenes.json", run: null }}
        durationInFrames={REEL_FPS}
        fps={REEL_FPS}
        width={REEL_WIDTH}
        height={REEL_HEIGHT}
      />
    </>
  );
};
